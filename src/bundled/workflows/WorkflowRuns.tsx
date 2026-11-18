import { useCallback } from "react";
import type {
  WorkflowCapability,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowReference,
} from "../../features/workflows/types";
import {
  formatFullTimestamp,
  formatItemTimestamp,
} from "../../shared/datetime";
import { useClockFormat } from "../../shared/clock-preference";
import { Button } from "../../shared/design-system/ui/Button";
import { useWorkflowView } from "./useWorkflowView";
import { LoadingRegion } from "../../shared/design-system/ui/LoadingRegion";
import { useWorkflowRunList } from "./useWorkflowRunList";

export function WorkflowRuns({
  capability,
  workflow,
  heading = true,
}: {
  capability: WorkflowCapability;
  workflow: WorkflowDefinition;
  heading?: boolean;
}) {
  if (!capability.availability.history)
    return (
      <p className="text-secondary">
        Run history is unavailable from this host.
      </p>
    );
  return (
    <RunList capability={capability} workflow={workflow} heading={heading} />
  );
}
/** One list, newest first, that keeps itself current while it is on screen. */
function RunList({
  capability,
  workflow,
  heading,
}: {
  capability: WorkflowCapability;
  workflow: WorkflowReference;
  heading: boolean;
}) {
  useClockFormat();
  const { snapshot, refresh } = useWorkflowView(
    useCallback(() => capability.runs(workflow), [capability, workflow]),
  );
  const list = useWorkflowRunList({
    capability,
    workflow,
    newest: snapshot,
    refresh,
  });
  if (!snapshot) return <p role="status">Reading runs…</p>;
  const needsRefresh =
    snapshot.status === "idle" || snapshot.status === "error";
  return (
    <section
      ref={list.section}
      aria-label="Workflow runs"
      className="workflow-runs"
    >
      {(heading || needsRefresh) && (
        <div className="workflow-toolbar">
          {heading && <h3 className="text-heading">Runs</h3>}
          {/* The list rereads itself; only these states wait for a person. */}
          {needsRefresh && (
            <Button onClick={() => void refresh()}>Refresh runs</Button>
          )}
        </div>
      )}
      {snapshot.status === "loading" && !list.loaded && (
        <p role="status">Reading runs…</p>
      )}
      {snapshot.status === "unavailable" && (
        <p role="status">
          Run history is unavailable. This does not mean the workflow was
          deleted.
        </p>
      )}
      {snapshot.status === "idle" && (
        <p role="status">History cleared. Refresh to read it again.</p>
      )}
      {snapshot.status === "error" && (
        <p role="alert" className="text-danger">
          {snapshot.error ??
            "Run history could not be read. Retry with Refresh runs."}
        </p>
      )}
      {(snapshot.status === "ready" || snapshot.status === "loading") &&
        list.loaded &&
        !list.runs.length && <p>No runs yet.</p>}
      {list.runs.map((run) => (
        <article key={run.id} className="workflow-step">
          <p className="text-body">
            <strong>{RUN_STATUS_LABELS[run.status]}</strong> ·{" "}
            <time
              dateTime={new Date(run.createdAt * 1000).toISOString()}
              title={formatFullTimestamp(run.createdAt)}
            >
              {formatItemTimestamp(run.createdAt, { withTime: true })}
            </time>
          </p>
          {run.status === "waiting_approval" ? (
            <p className="text-body text-secondary">
              Current step: {run.currentStep + 1}
            </p>
          ) : run.status === "failed" && run.startedAt !== null ? (
            // A run that failed without starting never reached a step.
            <p className="text-body text-secondary">
              Step {run.currentStep + 1}
            </p>
          ) : null}
          {(run.errorCode || run.errorMessage) && (
            <p className="text-danger">
              {run.errorCode}: {run.errorMessage}
            </p>
          )}
          <details>
            <summary>Run details and trace</summary>
            <p className="text-mono-sm workflow-key">Run ID: {run.id}</p>
            <pre className="text-mono workflow-trace">
              {JSON.stringify(run.trace, null, 2)}
            </pre>
          </details>
        </article>
      ))}
      {list.more && (
        // Reaching this loads the next page; the button is the same action
        // for a keyboard or screen reader, and stays put while a page is read.
        <div ref={list.end}>
          <LoadingRegion
            pending={list.older === "loading"}
            label="Reading older runs…"
            feedback={
              list.older === "failed" ? (
                <p role="alert" className="text-danger">
                  Older runs could not be read. Retry with Load older runs.
                </p>
              ) : undefined
            }
          >
            <Button onClick={() => void list.loadOlder()}>
              Load older runs
            </Button>
          </LoadingRegion>
        </div>
      )}
    </section>
  );
}

const RUN_STATUS_LABELS: Record<WorkflowRun["status"], string> = {
  pending: "Pending",
  running: "Running",
  waiting_approval: "Waiting for approval",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};
