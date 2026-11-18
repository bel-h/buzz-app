// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  WorkflowRun,
  WorkflowRunCursor,
  WorkflowRunPage,
} from "../../features/workflows/types";
import { WorkflowRuns } from "./WorkflowRuns";
import {
  createWorkflowFixture,
  fixtureDefinition,
  fixtureRun,
  fixtureView,
} from "./fixtures";
import {
  RUNS_ACTIVE_POLL_MS,
  RUNS_FAILED_POLL_MS,
  RUNS_SETTLED_POLL_MS,
} from "./useWorkflowRunList";

const run = (
  name: string,
  status: WorkflowRun["status"] = "completed",
): WorkflowRun => ({
  ...fixtureRun,
  id: `${fixtureRun.id.slice(0, -1)}${name}`,
  status,
});
const NEWEST = "newest";
/** A relay holding `runs`, newest first, in pages of two. Reassign `runs` to
 * change what the next read returns; `reads` names each page read by the run
 * it follows. */
function relayOf(runs: WorkflowRun[]) {
  const fixture = createWorkflowFixture();
  const relay = {
    runs,
    reads: [] as string[],
    views: [] as ReturnType<typeof fixtureView<WorkflowRunPage>>[],
    fails: (_page: string) => false,
    /** Resolves when a read of this page may answer. */
    holds: (_page: string): Promise<void> | void => {},
    capability: fixture.capability,
  };
  const page = (cursor?: WorkflowRunCursor): WorkflowRunPage => {
    const start = cursor
      ? relay.runs.findIndex(({ id }) => id === cursor.beforeId) + 1
      : 0;
    const rows = relay.runs.slice(start, start + 2);
    const last = rows.at(-1);
    return {
      runs: rows,
      next:
        last && relay.runs.length > start + 2
          ? { before: "2026-09-12T12:00:00.123456Z", beforeId: last.id }
          : null,
    };
  };
  const empty: WorkflowRunPage = { runs: [], next: null };
  relay.capability = {
    ...fixture.capability,
    runs(_workflow, cursor) {
      const name = cursor ? cursor.beforeId.slice(-1) : NEWEST;
      const owned = fixtureView(empty);
      relay.views.push(owned);
      return {
        ...owned.view,
        // Like the session's views: data stays while loading, and a failed
        // read leaves none.
        async refresh() {
          relay.reads.push(name);
          owned.update({ ...owned.view.snapshot(), status: "loading" });
          await relay.holds(name);
          if (owned.disposed()) return;
          owned.update(
            relay.fails(name)
              ? { status: "error", data: empty, error: "Read failed" }
              : { status: "ready", data: page(cursor) },
          );
        },
      };
    },
  };
  return relay;
}
const show = (relay: ReturnType<typeof relayOf>) =>
  render(
    <WorkflowRuns capability={relay.capability} workflow={fixtureDefinition} />,
  );
/** Each row as its status and the name its run was made with. */
const rows = () =>
  screen
    .queryAllByRole("article")
    .map(
      (row) =>
        `${row.querySelector("strong")?.textContent} ${row.querySelector(".workflow-key")?.textContent?.slice(-1)}`,
    );
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const olderButton = () =>
  screen.getByRole("button", { name: "Load older runs" });
function setDocumentVisible(visible: boolean) {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(
    visible ? "visible" : "hidden",
  );
  fireEvent(document, new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  // No spread on the poll interval, so a test can stand on either side of it.
  vi.spyOn(Math, "random").mockReturnValue(0);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("shows a new run on top by itself and keeps an open run's details open", async () => {
  const relay = relayOf([run("b"), run("a")]);
  show(relay);
  await advance(0);
  expect(rows()).toEqual(["Completed b", "Completed a"]);
  expect(screen.queryByRole("button", { name: "Refresh runs" })).toBeNull();
  const details = screen.getAllByRole("group")[1] as HTMLDetailsElement;
  details.open = true;

  relay.runs = [run("c", "running"), ...relay.runs];
  await advance(RUNS_SETTLED_POLL_MS - 1);
  expect(relay.reads).toEqual([NEWEST]);
  await advance(1);
  // "a" left the newest page of two and is still shown, in the same element.
  expect(rows()).toEqual(["Running c", "Completed b", "Completed a"]);
  expect(screen.getAllByRole("group")[2]).toBe(details);
  expect(details.open).toBe(true);

  // An active run brings the next read sooner, and it changes in place.
  relay.runs = [run("c", "failed"), ...relay.runs.slice(1)];
  await advance(RUNS_ACTIVE_POLL_MS);
  expect(rows()).toEqual(["Failed c", "Completed b", "Completed a"]);
  expect(relay.reads).toEqual([NEWEST, NEWEST, NEWEST]);
  // Nothing is active any more, so the quick interval ends.
  await advance(RUNS_ACTIVE_POLL_MS);
  expect(relay.reads).toHaveLength(3);
});

it("appends older runs and updates an active run on a later page in place", async () => {
  const relay = relayOf([
    run("d"),
    run("c"),
    run("b", "waiting_approval"),
    run("a", "running"),
  ]);
  show(relay);
  await advance(0);
  expect(rows()).toEqual(["Completed d", "Completed c"]);

  let release = () => {};
  relay.holds = (page) =>
    page === "c"
      ? new Promise<void>((resolve) => (release = resolve))
      : undefined;
  olderButton().focus();
  fireEvent.click(olderButton());
  // Activating it again while the page is read starts no second read.
  fireEvent.click(olderButton());
  await advance(999);
  expect(screen.queryByText("Reading older runs…")).toBeNull();
  // The loading line waits a second, and the control keeps focus meanwhile.
  await advance(1);
  expect(screen.getByRole("status")).toHaveTextContent("Reading older runs…");
  expect(olderButton()).toHaveFocus();
  expect(rows()).toEqual(["Completed d", "Completed c"]);
  release();
  relay.holds = () => {};
  await advance(0);
  expect(rows()).toEqual([
    "Completed d",
    "Completed c",
    "Waiting for approval b",
    "Running a",
  ]);
  // The oldest run is shown: no control and no end-of-list message.
  expect(screen.queryByRole("button", { name: "Load older runs" })).toBeNull();
  expect(screen.queryByText("Reading older runs…")).toBeNull();
  expect(relay.reads).toEqual([NEWEST, "c"]);

  relay.runs = [run("d"), run("c"), run("b", "running"), run("a", "completed")];
  await advance(RUNS_ACTIVE_POLL_MS);
  expect(rows()).toEqual([
    "Completed d",
    "Completed c",
    "Running b",
    "Completed a",
  ]);
  // One read of the newest page and one of the page that holds both runs.
  expect(relay.reads.slice(2).sort()).toEqual(["c", NEWEST].sort());
  // Every view but the newest page's was a single read.
  expect(relay.views.map((view) => view.disposed())).toEqual([
    false,
    true,
    true,
  ]);
});

it("reads nothing while hidden and catches up at once when shown again", async () => {
  const relay = relayOf([run("b", "running"), run("a")]);
  show(relay);
  await advance(0);
  setDocumentVisible(false);
  relay.runs = [run("c"), run("b", "completed"), run("a")];
  await advance(10 * RUNS_SETTLED_POLL_MS);
  expect(relay.reads).toEqual([NEWEST]);
  expect(rows()).toEqual(["Running b", "Completed a"]);

  setDocumentVisible(true);
  await advance(0);
  expect(relay.reads).toEqual([NEWEST, NEWEST]);
  expect(rows()).toEqual(["Completed c", "Completed b", "Completed a"]);
});

it("pauses for a list that is off screen and loads older runs when its end is reached", async () => {
  let observe: IntersectionObserverCallback = () => {};
  const observed = new Set<Element>();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        observe = callback;
      }
      observe(target: Element) {
        observed.add(target);
      }
      disconnect() {
        observed.clear();
      }
    },
  );
  const intersect = async (target: Element, isIntersecting: boolean) => {
    expect(observed).toContain(target);
    act(() =>
      observe(
        [{ target, isIntersecting } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );
    await advance(0);
  };
  const relay = relayOf(
    ["g", "f", "e", "d", "c", "b", "a"].map((name) => run(name)),
  );
  show(relay);
  await advance(0);
  const list = screen.getByRole("region", { name: "Workflow runs" });
  const end = () =>
    olderButton().closest(".buzz-loading-region")?.parentElement as HTMLElement;

  // A covered pane or a list scrolled away is not intersecting.
  await intersect(list, false);
  await advance(RUNS_SETTLED_POLL_MS);
  await intersect(end(), true);
  expect(relay.reads).toEqual([NEWEST]);

  // Shown again: its end being in reach, the next page is read, and the
  // newest page is reread at once.
  let release = () => {};
  relay.holds = (page) =>
    page === "f"
      ? new Promise<void>((resolve) => (release = resolve))
      : undefined;
  await intersect(list, true);
  expect(relay.reads).toEqual([NEWEST, "f", NEWEST]);
  // That page pushes the end out of reach, so reading stops there.
  await intersect(end(), false);
  release();
  await advance(0);
  expect(rows()).toHaveLength(4);
  expect(relay.reads).toEqual([NEWEST, "f", NEWEST]);

  // Reached again, pages follow for as long as the end stays in reach.
  await intersect(end(), true);
  expect(rows()).toHaveLength(7);
  expect(relay.reads).toEqual([NEWEST, "f", NEWEST, "d", "b"]);
});

it("keeps the runs shown when an older page fails, and retries on request", async () => {
  const relay = relayOf([run("c"), run("b"), run("a")]);
  show(relay);
  await advance(0);
  relay.fails = (page) => page === "b";
  fireEvent.click(olderButton());
  await advance(0);
  expect(rows()).toEqual(["Completed c", "Completed b"]);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Older runs could not be read. Retry with Load older runs.",
  );
  // The newest page is fine, so its own retry is not offered.
  expect(screen.queryByRole("button", { name: "Refresh runs" })).toBeNull();

  relay.fails = () => false;
  fireEvent.click(olderButton());
  await advance(0);
  expect(rows()).toEqual(["Completed c", "Completed b", "Completed a"]);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("keeps the runs shown when a reread fails, backs off, and recovers", async () => {
  const relay = relayOf([run("b", "running"), run("a")]);
  show(relay);
  await advance(0);
  relay.fails = () => true;
  await advance(RUNS_ACTIVE_POLL_MS);
  expect(rows()).toEqual(["Running b", "Completed a"]);
  expect(screen.getByRole("alert")).toHaveTextContent("Read failed");
  expect(screen.getByRole("button", { name: "Refresh runs" })).toBeEnabled();
  expect(relay.reads).toHaveLength(2);

  // A failing relay is asked less often than a working one.
  relay.fails = () => false;
  relay.runs = [run("b", "completed"), run("a")];
  await advance(RUNS_FAILED_POLL_MS - 1);
  expect(relay.reads).toHaveLength(2);
  await advance(1);
  expect(rows()).toEqual(["Completed b", "Completed a"]);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Refresh runs" })).toBeNull();
});

it("says a workflow has no runs yet without flickering on each reread", async () => {
  const relay = relayOf([]);
  show(relay);
  expect(screen.getByText("Reading runs…")).toBeVisible();
  await advance(0);
  expect(screen.getByText("No runs yet.")).toBeVisible();
  let release = () => {};
  relay.holds = () => new Promise<void>((resolve) => (release = resolve));
  await advance(RUNS_SETTLED_POLL_MS);
  expect(relay.reads).toHaveLength(2);
  expect(screen.getByText("No runs yet.")).toBeVisible();
  expect(screen.queryByText("Reading runs…")).toBeNull();
  release();
});

it("stops reading once it is unmounted", async () => {
  const relay = relayOf([run("c", "running"), run("b"), run("a")]);
  const view = show(relay);
  await advance(0);
  let started = false;
  relay.holds = (page) => {
    if (page !== "b") return;
    started = true;
    return new Promise<void>(() => {});
  };
  fireEvent.click(olderButton());
  await advance(0);
  expect(started).toBe(true);
  view.unmount();
  // The read still under way is released with the list.
  expect(relay.views.every((owned) => owned.disposed())).toBe(true);
  const reads = relay.reads.length;
  await advance(10 * RUNS_SETTLED_POLL_MS);
  expect(relay.reads).toHaveLength(reads);
});

it("drops the runs the session cleared and waits for a refresh", async () => {
  const relay = relayOf([run("b", "running"), run("a")]);
  show(relay);
  await advance(0);
  act(() =>
    relay.views[0]?.update({ status: "idle", data: { runs: [], next: null } }),
  );
  expect(rows()).toEqual([]);
  expect(
    screen.getByText("History cleared. Refresh to read it again."),
  ).toBeVisible();
  await advance(10 * RUNS_SETTLED_POLL_MS);
  expect(relay.reads).toEqual([NEWEST]);

  fireEvent.click(screen.getByRole("button", { name: "Refresh runs" }));
  await advance(0);
  expect(rows()).toEqual(["Running b", "Completed a"]);
  await advance(RUNS_ACTIVE_POLL_MS);
  expect(relay.reads).toEqual([NEWEST, NEWEST, NEWEST]);
});
