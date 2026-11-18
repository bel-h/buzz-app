//! Sensitive kinds a paired tool asks to have signed (block/buzz
//! `docs/local-credential-provider.md`, Sensitive operations): the human
//! approves each in Buzz, once, or for that kind from that tool for
//! [`WINDOW`] seconds, shown with each paired tool until it lapses or is
//! stopped.
use super::{Notice, Pairings, Record, APPROVAL};
use crate::credential_service::{unix_now, Failure};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::sync::oneshot;
use tokio::time::Instant;

/// How long allowing a kind lasts.
pub(crate) const WINDOW: u64 = 5 * 60;
/// Signatures that may be asked for per [`ASK_WINDOW`].
const ASKS: usize = 20;
const ASK_WINDOW: Duration = Duration::from_secs(10 * 60);
/// When a caller turned away by another open request retries.
const BUSY_RETRY: u64 = 5;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Answer {
    Deny,
    Once,
    /// Once, and the same kind from the same pairing until [`WINDOW`] ends.
    Window,
}

/// What the page is told.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SignRequest {
    pub(crate) id: String,
    pub(crate) pairing: String,
    pub(crate) client: String,
    pub(crate) relay: String,
    pub(crate) kind: u16,
    pub(crate) tags: Vec<Vec<String>>,
    pub(crate) expires_in: u64,
    pub(crate) window_seconds: u64,
}

pub(super) struct Pending {
    id: String,
    pairing: String,
    pub(super) relay: String,
    send: oneshot::Sender<Answer>,
}

pub(super) struct Window {
    pairing: String,
    kind: u16,
    /// Unix seconds.
    until: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Listed {
    kind: u16,
    until: u64,
}

impl Pairings {
    /// Returns once the human lets `record`, admitted under `generation`,
    /// have an event of `kind` with `tags` signed: at once while its kind is
    /// allowed, otherwise after asking in Buzz.
    pub(crate) async fn approve(
        &self,
        record: &Record,
        generation: u64,
        kind: u16,
        tags: &[Vec<String>],
    ) -> Result<(), Failure> {
        let now = unix_now()?;
        let id = uuid::Uuid::new_v4().to_string();
        let answer = {
            let mut state = self.state();
            if state.owed || state.generation != generation {
                return Err(Failure::revoked());
            }
            state.windows.retain(|window| window.until > now);
            if state
                .windows
                .iter()
                .any(|window| window.pairing == record.id && window.kind == kind)
            {
                return Ok(());
            }
            // Before the rate limit: a request nobody could see spends no slot.
            if state.sign_prompts == 0 {
                return Err(Failure::new(
                    "unavailable",
                    "Buzz can't ask you yet; open Buzz, then try again",
                ));
            }
            let at = Instant::now();
            while state
                .sign_asked
                .front()
                .is_some_and(|asked| at.duration_since(*asked) >= ASK_WINDOW)
            {
                state.sign_asked.pop_front();
            }
            let wait = if state.signing.is_some() {
                Some(BUSY_RETRY)
            } else if state.sign_asked.len() >= ASKS {
                state
                    .sign_asked
                    .front()
                    .map(|asked| (ASK_WINDOW - at.duration_since(*asked)).as_secs().max(1))
            } else {
                None
            };
            if let Some(wait) = wait {
                return Err(Failure {
                    code: "rate_limited",
                    message: "Another request is waiting in Buzz, or too many were made".into(),
                    retry_after: Some(wait),
                });
            }
            let (send, answer) = oneshot::channel();
            state.signing = Some(Pending {
                id: id.clone(),
                pairing: record.id.clone(),
                relay: record.relay.clone(),
                send,
            });
            state.sign_asked.push_back(at);
            // Asked under the lock a revoke takes, so no revoke falls between
            // the request being pending and the page hearing of it.
            (self.notify)(Notice::SignAsk(SignRequest {
                id: id.clone(),
                pairing: record.id.clone(),
                client: record.client.clone(),
                relay: record.relay.clone(),
                kind,
                tags: tags.to_vec(),
                expires_in: APPROVAL.as_secs(),
                window_seconds: WINDOW,
            }));
            answer
        };
        // Whatever ends the wait, even the caller hanging up, closes the prompt.
        let _closing = SignClosing(self, id);
        match tokio::time::timeout(APPROVAL, answer).await {
            Ok(Ok(Answer::Once)) => Ok(()),
            Ok(Ok(Answer::Window)) => {
                let until = unix_now()? + WINDOW;
                let mut state = self.state();
                // A revoke since asking ended this pairing's windows: none begins.
                if state.owed || state.generation != generation {
                    return Err(Failure::revoked());
                }
                state.windows.push(Window {
                    pairing: record.id.clone(),
                    kind,
                    until,
                });
                drop(state);
                (self.notify)(Notice::Changed);
                Ok(())
            }
            Ok(_) => Err(Failure::new("denied", "Declined in Buzz")),
            Err(_) => Err(Failure::new(
                "approval_required",
                "Nobody approved this in Buzz in time",
            )),
        }
    }

    /// The human's answer to signature request `id`; a stale id does nothing.
    pub(crate) fn answer_signature(&self, id: &str, answer: Answer) {
        let pending = {
            let mut state = self.state();
            match &state.signing {
                Some(pending) if pending.id == id => state.signing.take(),
                _ => None,
            }
        };
        if let Some(pending) = pending {
            let _ = pending.send.send(answer);
        }
    }

    /// The page mounted (`true`) or unmounted a prompt that asks the human
    /// to approve signatures.
    pub(crate) fn sign_prompt(&self, mounted: bool) {
        let mut state = self.state();
        state.sign_prompts = if mounted {
            state.sign_prompts + 1
        } else {
            state.sign_prompts.saturating_sub(1)
        };
    }

    /// Ends pairing `id`'s window for `kind`.
    pub(crate) fn stop_window(&self, id: &str, kind: u16) {
        let mut state = self.state();
        let before = state.windows.len();
        state
            .windows
            .retain(|window| !(window.pairing == id && window.kind == kind));
        let stopped = state.windows.len() != before;
        drop(state);
        if stopped {
            (self.notify)(Notice::Changed);
        }
    }

    /// Ends pairing `id`'s windows and declines a signature it waits on.
    pub(super) fn forget(&self, id: &str) {
        let mut state = self.state();
        state.windows.retain(|window| window.pairing != id);
        if state
            .signing
            .as_ref()
            .is_some_and(|pending| pending.pairing == id)
        {
            state.signing = None;
        }
    }

    pub(crate) fn windows_of(&self, id: &str, now: u64) -> Vec<Listed> {
        self.state()
            .windows
            .iter()
            .filter(|window| window.pairing == id && window.until > now)
            .map(|window| Listed {
                kind: window.kind,
                until: window.until,
            })
            .collect()
    }
}

/// Ends signature request `.1` and closes its prompt.
struct SignClosing<'a>(&'a Pairings, String);
impl Drop for SignClosing<'_> {
    fn drop(&mut self) {
        let mut state = self.0.state();
        if state
            .signing
            .as_ref()
            .is_some_and(|pending| pending.id == self.1)
        {
            state.signing = None;
        }
        drop(state);
        (self.0.notify)(Notice::SignClosed(self.1.clone()));
    }
}
