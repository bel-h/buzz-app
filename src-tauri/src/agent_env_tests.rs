use super::*;
use std::sync::Mutex as StdMutex;

#[derive(Default)]
struct FakeStore {
    text: StdMutex<Option<String>>,
    unreadable: StdMutex<bool>,
    unwritable: StdMutex<bool>,
}
impl KeyStore for Arc<FakeStore> {
    fn read(&self) -> Result<Option<Zeroizing<String>>, String> {
        if *self.unreadable.lock().unwrap() {
            return Err("locked".into());
        }
        Ok(self.text.lock().unwrap().clone().map(Zeroizing::new))
    }
    fn replace(&self, text: &str) -> Result<(), String> {
        if *self.unwritable.lock().unwrap() {
            return Err("locked".into());
        }
        *self.text.lock().unwrap() = Some(text.into());
        Ok(())
    }
    fn delete(&self) -> Result<(), String> {
        unreachable!()
    }
}

fn set(name: &str, value: &str) -> Row {
    Row {
        name: name.into(),
        value: Some(value.into()),
    }
}
fn keep(name: &str) -> Row {
    Row {
        name: name.into(),
        value: None,
    }
}
fn env(store: &Arc<FakeStore>) -> AgentEnv {
    AgentEnv::with(Box::new(store.clone()))
}
async fn given(
    env: &AgentEnv,
    plugin: &str,
    process: &str,
    protected: bool,
) -> Vec<(String, String)> {
    env.for_process(plugin, process, protected)
        .await
        .into_iter()
        .map(|(n, v)| (n.into_string().unwrap(), v.into_string().unwrap()))
        .collect()
}

#[tokio::test]
async fn only_local_agent_processes_get_the_list() {
    let store = Arc::new(FakeStore::default());
    let env = env(&store);
    env.set(vec![set("FOO", "bar")]).await.unwrap();
    let foo = vec![("FOO".to_string(), "bar".to_string())];
    for (plugin, process) in [
        ("buzz.claude-code", "claude-sh"),
        ("buzz.codex", "codex-sh"),
        ("buzz.goose", "goose"),
        ("buzz.pi", "pi-sh"),
        ("buzz.pi", "node"),
    ] {
        assert_eq!(
            given(&env, plugin, process, false).await,
            foo,
            "{plugin} {process}"
        );
        assert!(
            given(&env, plugin, process, true).await.is_empty(),
            "protected {plugin}"
        );
    }
    for (plugin, process) in [
        ("buzz.claude-code", "claude-protected-arm64"),
        ("buzz.claude-code", "read"),
        ("buzz.pi", "pi-protected-sh"),
        ("other.plugin", "claude-sh"),
    ] {
        assert!(
            given(&env, plugin, process, false).await.is_empty(),
            "{plugin} {process}"
        );
    }
}

#[tokio::test]
async fn an_unreadable_store_starts_agents_without_the_list() {
    let store = Arc::new(FakeStore::default());
    *store.unreadable.lock().unwrap() = true;
    assert!(given(&env(&store), "buzz.goose", "goose", false)
        .await
        .is_empty());
}

#[tokio::test]
async fn rows_keep_replace_or_delete_saved_values() {
    let store = Arc::new(FakeStore::default());
    env(&store)
        .set(vec![set("A", "1"), set("B", "2"), set("C", "3")])
        .await
        .unwrap();
    // As after a relaunch: values are read back from the store.
    let env = env(&store);
    assert_eq!(
        env.status().await.unwrap(),
        Status {
            names: vec!["A".into(), "B".into(), "C".into()],
            saved: false
        }
    );
    env.set(vec![keep("A"), set("B", "two"), set("D", "4")])
        .await
        .unwrap();
    assert_eq!(
        given(&env, "buzz.goose", "goose", false).await,
        [("A", "1"), ("B", "two"), ("D", "4")].map(|(n, v)| (n.to_string(), v.to_string()))
    );
    assert!(env.status().await.unwrap().saved);
    assert!(env.set(vec![keep("MISSING")]).await.is_err());
}

#[tokio::test]
async fn a_failed_save_changes_nothing() {
    let store = Arc::new(FakeStore::default());
    let env = env(&store);
    env.set(vec![set("A", "1")]).await.unwrap();
    let env = AgentEnv::with(Box::new(store.clone()));
    *store.unwritable.lock().unwrap() = true;
    assert!(env.set(vec![set("A", "2")]).await.is_err());
    assert!(env.set(vec![set("PATH", "/x")]).await.is_err());
    assert!(!env.status().await.unwrap().saved);
    assert_eq!(
        given(&env, "buzz.goose", "goose", false).await,
        vec![("A".into(), "1".into())]
    );
}

#[tokio::test]
async fn every_blocked_name_is_rejected_in_any_case() {
    let env = env(&Arc::new(FakeStore::default()));
    for name in BLOCKED
        .iter()
        .copied()
        .chain(["BUZZ_AGENT", "NOSTR_KEY", "path"])
        // Named here too, so dropping one from `BLOCKED` fails.
        .chain([
            "OPENAI_BASE_PATH",
            "LITELLM_BASE_PATH",
            "AZURE_OPENAI_DEPLOYMENT_NAME_MAP",
            "AZURE_OPENAI_RESOURCE_NAME",
            "KIMI_CODE_OAUTH_HOST",
            "KIMI_OAUTH_HOST",
            "ANTHROPIC_FOUNDRY_RESOURCE",
            "CODEX_AGENT_IDENTITY_AUTHAPI_BASE_URL",
            "CODEX_AGENT_IDENTITY_JWKS_BASE_URL",
        ])
    {
        let mixed: String = name
            .chars()
            .enumerate()
            .map(|(i, c)| {
                if i % 2 == 0 {
                    c.to_ascii_lowercase()
                } else {
                    c
                }
            })
            .collect();
        for name in [name.to_string(), name.to_ascii_lowercase(), mixed] {
            assert!(
                env.set(vec![set(&name, "x")]).await.is_err(),
                "{name} was allowed"
            );
        }
    }
    for name in [
        "ANTHROPIC_API_KEY",
        "AWS_REGION",
        "GITHUB_TOKEN",
        "DATABRICKS_TOKEN",
        "_X1",
    ] {
        env.set(vec![set(name, "x")]).await.unwrap();
    }
}

#[tokio::test]
async fn invalid_names_values_and_duplicates_are_rejected() {
    let env = env(&Arc::new(FakeStore::default()));
    for name in ["", "1A", "A-B", "A B", "A=B", "É", &"A".repeat(129)] {
        assert!(env.set(vec![set(name, "x")]).await.is_err(), "{name:?}");
    }
    assert!(env.set(vec![set("A", "x\0y")]).await.is_err());
    assert!(env
        .set(vec![set("Foo", "1"), set("FOO", "2")])
        .await
        .is_err());
}

#[tokio::test]
async fn the_list_fits_windows_utf16_limit() {
    let env = env(&Arc::new(FakeStore::default()));
    // `{"A":"…"}` is 8 characters around the value; 1280 UTF-16 units fit.
    env.set(vec![set("A", &"x".repeat(1272))]).await.unwrap();
    assert!(env.set(vec![set("A", &"x".repeat(1273))]).await.is_err());
    // A character outside the BMP is two UTF-16 units.
    env.set(vec![set("A", &"😀".repeat(636))]).await.unwrap();
    assert!(env.set(vec![set("A", &"😀".repeat(637))]).await.is_err());
}
