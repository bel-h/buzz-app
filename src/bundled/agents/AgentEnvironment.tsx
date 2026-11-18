import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { PlusIcon, TrashIcon } from "../../shared/design-system/icons";
import { AlertDialog } from "../../shared/design-system/ui/AlertDialog";
import { Button } from "../../shared/design-system/ui/Button";
import { InlineHeader } from "../../shared/design-system/ui/Header";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import { Input } from "../../shared/design-system/ui/Input";
import { PreferenceRow } from "../../shared/design-system/ui/PreferenceRow";
import { SettingsGroup } from "../../shared/design-system/ui/SettingsGroup";

/** A row being edited. A saved row's value stays native: an empty `value`
 * keeps it, anything typed replaces it. */
type Row = { key: number; name: string; value: string; saved: boolean };
type Status = { names: string[]; saved: boolean };

/** Variables every local agent on this device starts with, held natively in
 * the OS credential store. Values are never read back. */
export function AgentEnvironment() {
  const [rows, setRows] = useState<Row[] | undefined>();
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const restart = useRef<HTMLButtonElement>(null);
  const next = useRef(0);
  const load = useCallback((status: Status) => {
    setRows(
      status.names.map((name) => ({
        key: next.current++,
        name,
        value: "",
        saved: true,
      })),
    );
    setSaved(status.saved);
    setDirty(false);
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    // Hosts without the native list (test fixtures) answer nothing.
    invoke<Status | null>("agent_env_status").then(
      (status) => status && load(status),
      (reason: unknown) => setError(String(reason)),
    );
  }, [load]);
  if (!rows) return error ? <p role="alert">{error}</p> : null;
  const edit = (key: number, change: Partial<Row>) => {
    setRows(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
    setDirty(true);
  };
  const save = async () => {
    setPending(true);
    setError(undefined);
    try {
      await invoke("agent_env_set", {
        rows: rows.map((row) => ({
          name: row.name.trim(),
          value: row.saved && !row.value ? null : row.value,
        })),
      });
      load(await invoke<Status>("agent_env_status"));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="mt-section-gap">
      <InlineHeader title="Environment variables" />
      <p className="m-0 mb-2 text-body-sm text-subtle">
        Every local agent on this device starts with these. Protected and hosted
        agents don’t get them, and a harness’s own settings win. Models,
        providers and endpoints are set above, not here.
      </p>
      <SettingsGroup>
        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-2 p-2">
            <Input
              aria-label="Variable name"
              placeholder="NAME"
              value={row.name}
              disabled={row.saved}
              autoCapitalize="off"
              spellCheck={false}
              onValueChange={(name) => edit(row.key, { name })}
            />
            <Input
              aria-label={`Value of ${row.name || "new variable"}`}
              type="password"
              placeholder={row.saved ? "Saved — type to replace" : "Value"}
              value={row.value}
              onValueChange={(value) => edit(row.key, { value })}
            />
            <IconButton
              aria-label={`Remove ${row.name || "variable"}`}
              icon={<TrashIcon size={17} />}
              onClick={() => {
                setRows(rows.filter((other) => other.key !== row.key));
                setDirty(true);
              }}
            />
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 p-2">
          <Button
            size="sm"
            onClick={() => {
              setRows([
                ...rows,
                { key: next.current++, name: "", value: "", saved: false },
              ]);
              setDirty(true);
            }}
          >
            <PlusIcon size={17} aria-hidden="true" />
            Add variable
          </Button>
          <Button
            size="sm"
            variant="prominent"
            disabled={!dirty || pending}
            aria-busy={pending || undefined}
            onClick={() => void save()}
          >
            Save
          </Button>
        </div>
        {error && (
          <p role="alert" className="m-0 p-2 text-body-sm">
            {error}
          </p>
        )}
        {saved && (
          <PreferenceRow
            title="Agents already running still use the old list"
            subtitle="New agent processes use the saved list. Restart Buzz to apply it to all of them."
            trailing={
              <Button ref={restart} size="sm" onClick={() => setConfirm(true)}>
                Restart Buzz
              </Button>
            }
          />
        )}
      </SettingsGroup>
      {confirm && (
        <AlertDialog
          title="Restart Buzz?"
          description="Agents stop any work in progress and start again with the saved environment variables."
          finalFocus={restart}
          onClose={() => setConfirm(false)}
          actions={
            <>
              <Button onClick={() => setConfirm(false)}>Cancel</Button>
              <Button
                variant="prominent"
                onClick={() => {
                  setConfirm(false);
                  void invoke("update_restart");
                }}
              >
                Restart
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}
