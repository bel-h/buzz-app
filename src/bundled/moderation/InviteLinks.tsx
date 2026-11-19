import { useCallback, useEffect, useRef, useState } from "react";
import { AlertDialog } from "../../shared/design-system/ui/AlertDialog";
import { Button } from "../../shared/design-system/ui/Button";
import { Input } from "../../shared/design-system/ui/Input";
import { InputGroup } from "../../shared/design-system/ui/InputGroup";
import {
  listInvites,
  pastedInviteCode,
  revokeInvite,
  type InviteSummary,
} from "./api";
import styles from "./CommunityAdmin.module.css";

const message = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);
const STATUS: Record<InviteSummary["status"], string> = {
  active: "Active",
  revoked: "Revoked",
  expired: "Expired",
  exhausted: "Used up",
};

/** How a link's expiry reads wherever it is shown. */
export function inviteExpiry(expiresAt: number | null) {
  if (expiresAt === null) return "Never expires";
  const date = new Date(expiresAt * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return expiresAt * 1000 <= Date.now() ? `Expired ${date}` : `Expires ${date}`;
}

const created = (at: number) =>
  new Date(at * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

const uses = (invite: InviteSummary) =>
  invite.max_uses === null
    ? `${invite.use_count} ${invite.use_count === 1 ? "use" : "uses"}`
    : `${invite.use_count} of ${invite.max_uses} uses`;

/** The community's invite links, with revoking by row or by pasted link. */
export function InviteLinks({
  community,
  name,
  locked,
  active,
}: {
  community: string;
  name(pubkey: string): string;
  locked: boolean;
  active(): boolean;
}) {
  const [invites, setInvites] = useState<InviteSummary[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pasted, setPasted] = useState("");
  const [pending, setPending] = useState<
    { id: string; label: string } | { code: string; label: string } | null
  >(null);
  const [revoking, setRevoking] = useState(false);
  const reads = useRef(0);

  const load = useCallback(
    async (before?: string) => {
      const read = ++reads.current;
      setLoading(true);
      setError("");
      try {
        const page = await listInvites(community, before);
        if (read !== reads.current) return;
        setInvites((shown) =>
          before ? [...(shown ?? []), ...page.invites] : page.invites,
        );
        setNext(page.next_before);
      } catch (reason) {
        if (read === reads.current) setError(message(reason));
      } finally {
        if (read === reads.current) setLoading(false);
      }
    },
    [community],
  );
  useEffect(() => {
    void load();
    return () => {
      ++reads.current;
    };
  }, [load]);

  const pastedCode = pasted.trim() ? pastedInviteCode(community, pasted) : null;
  const pastedError =
    pastedCode && "error" in pastedCode ? pastedCode.error : "";

  async function revoke() {
    if (!pending || !active() || locked || revoking) return;
    setRevoking(true);
    setError("");
    setNotice("");
    try {
      await revokeInvite(
        community,
        "id" in pending ? { id: pending.id } : { code: pending.code },
      );
      if ("code" in pending) setPasted("");
      setNotice("Invite link revoked. People who already joined stay in.");
      await load();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setRevoking(false);
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (pastedCode && "code" in pastedCode)
            setPending({ code: pastedCode.code, label: "this link" });
        }}
      >
        <label htmlFor="invite-revoke-link" className="text-body-sm">
          Revoke a link
        </label>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <InputGroup>
              <Input
                id="invite-revoke-link"
                aria-invalid={pastedError ? true : undefined}
                aria-describedby={
                  pastedError ? "invite-revoke-link-error" : undefined
                }
                placeholder="Paste an invite link"
                value={pasted}
                onChange={(event) => setPasted(event.currentTarget.value)}
                autoComplete="off"
                spellCheck={false}
                disabled={revoking}
              />
            </InputGroup>
            {pastedError && (
              <p
                id="invite-revoke-link-error"
                role="alert"
                className="mt-2 mb-0 text-body-sm"
              >
                {pastedError}
              </p>
            )}
          </div>
          <Button
            type="submit"
            variant="destructive"
            disabled={
              locked || revoking || !pastedCode || !("code" in pastedCode)
            }
          >
            Revoke
          </Button>
        </div>
      </form>
      <div>
        <h3 className="m-0 pb-2 text-caption text-subtle">Invite links</h3>
        {invites === null ? (
          !error && <p role="status">Loading invite links…</p>
        ) : invites.length === 0 ? (
          <p role="status" className="text-body-sm text-muted">
            No invite links yet.
          </p>
        ) : (
          <ul className={styles.members} aria-label="Invite links">
            {invites.map((invite) => {
              // Creation time and a short id tell one creator's links apart.
              const label = `Link ${invite.id.slice(0, 8)} by ${name(invite.created_by)}, created ${created(invite.created_at)}`;
              return (
                <li key={invite.id} className={styles.member}>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 truncate text-body-sm">{label}</p>
                    <p className="m-0 truncate text-caption text-subtle">
                      {STATUS[invite.status]} · {uses(invite)} ·{" "}
                      {inviteExpiry(invite.expires_at)}
                    </p>
                  </div>
                  {invite.status !== "revoked" && (
                    <Button
                      size="sm"
                      variant="subtle"
                      aria-label={`Revoke ${label}`}
                      disabled={locked || revoking}
                      onClick={() => setPending({ id: invite.id, label })}
                    >
                      Revoke
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {next && (
          <div className="mt-2">
            <Button
              size="sm"
              loading={loading}
              disabled={loading}
              onClick={() => void load(next)}
            >
              Show more
            </Button>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2 empty:hidden">
        {error && (
          <div className="flex items-center justify-between gap-3">
            <p role="alert" className="m-0 text-body-sm">
              {error}
            </p>
            {invites === null && (
              <Button size="sm" loading={loading} onClick={() => void load()}>
                Retry
              </Button>
            )}
          </div>
        )}
        {notice && (
          <p role="status" className="m-0 text-body-sm">
            {notice}
          </p>
        )}
      </div>
      {pending && (
        <AlertDialog
          title={`Revoke ${pending.label}?`}
          description="Nobody new can join with it. People who already joined stay in."
          pending={revoking}
          onClose={() => setPending(null)}
          actions={
            <>
              <Button disabled={revoking} onClick={() => setPending(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                loading={revoking}
                disabled={revoking || locked}
                onClick={() => void revoke()}
              >
                Revoke
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}
