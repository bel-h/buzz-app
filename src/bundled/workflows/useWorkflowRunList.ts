import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  WorkflowCapability,
  WorkflowReference,
  WorkflowRunCursor,
  WorkflowRunPage,
  WorkflowView,
} from "../../features/workflows/types";
import {
  activePages,
  emptyRunList,
  isActiveRun,
  withNewest,
  withOlder,
  withPage,
  type WorkflowRunList,
} from "./workflowRunList";

/** The relay pushes nothing about runs, so a visible list polls its signed
 * history route. That route shares one per-person budget with every other API
 * call (300 a minute by default), so these stay a small part of it: one read
 * of the newest page per interval, plus at most `PAGES_PER_POLL` older pages
 * that still hold an active run. */
export const RUNS_ACTIVE_POLL_MS = 5_000;
export const RUNS_SETTLED_POLL_MS = 30_000;
export const RUNS_FAILED_POLL_MS = 60_000;
const PAGES_PER_POLL = 2;

type State = Readonly<{
  list: WorkflowRunList;
  /** The newest page has been read at least once since the list was empty. */
  loaded: boolean;
  /** The last read of the newest page failed. */
  failed: boolean;
  older: "idle" | "loading" | "failed";
}>;
type Action =
  | { type: "newest"; page: WorkflowRunPage }
  | { type: "failed" }
  | { type: "clear" }
  | { type: "page"; page: WorkflowRunPage }
  | { type: "reading-older" }
  | {
      type: "older";
      cursor: WorkflowRunCursor;
      page: WorkflowRunPage | undefined;
    };

const EMPTY: State = {
  list: emptyRunList,
  loaded: false,
  failed: false,
  older: "idle",
};
function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "newest": {
      const list = withNewest(state.list, action.page);
      return {
        list,
        loaded: true,
        failed: false,
        // A failure to read past an end the list no longer has is over.
        older:
          state.older === "failed" && list.next !== state.list.next
            ? "idle"
            : state.older,
      };
    }
    case "failed":
      return state.failed ? state : { ...state, failed: true };
    // The session purged what it held; copies of it go too.
    case "clear":
      return EMPTY;
    case "page":
      return { ...state, list: withPage(state.list, action.page) };
    case "reading-older":
      return { ...state, older: "loading" };
    case "older":
      // A read for a cursor the list has moved on from is neither result.
      if (state.list.next !== action.cursor) return { ...state, older: "idle" };
      return action.page
        ? {
            ...state,
            list: withOlder(state.list, action.cursor, action.page),
            older: "idle",
          }
        : { ...state, older: "failed" };
  }
}

const documentVisible = () => document.visibilityState === "visible";
function watchDocument(listener: () => void) {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
}

/** Keeps one run history current while it is on screen. `newest` and `refresh`
 * are the caller's view of the first page; older pages and re-reads of active
 * runs go through short-lived views of the same capability, so every read
 * keeps the capability's access checks and purge. */
export function useWorkflowRunList({
  capability,
  workflow,
  newest,
  refresh,
}: {
  capability: WorkflowCapability;
  workflow: WorkflowReference;
  newest: ReturnType<WorkflowView<WorkflowRunPage>["snapshot"]> | undefined;
  refresh: () => Promise<void>;
}) {
  const [state, dispatch] = useReducer(reduce, EMPTY);
  // Before paint, so a first page never shows as an empty history.
  useLayoutEffect(() => {
    if (newest?.status === "ready")
      dispatch({ type: "newest", page: newest.data });
    else if (newest?.status === "error") dispatch({ type: "failed" });
    else if (newest?.status === "idle" || newest?.status === "unavailable")
      dispatch({ type: "clear" });
  }, [newest]);

  const [section, setSection] = useState<HTMLElement | null>(null);
  const [end, setEnd] = useState<HTMLElement | null>(null);
  // Without an observer the list counts as on screen and the end as out of
  // reach, which leaves the explicit control.
  const [onScreen, setOnScreen] = useState(true);
  const [nearEnd, setNearEnd] = useState(false);
  useEffect(() => {
    if (!section || typeof IntersectionObserver === "undefined") return;
    // Against the viewport: a covered pane, a hidden tab and a list scrolled
    // out of any ancestor all read as off screen.
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries)
        (entry.target === section ? setOnScreen : setNearEnd)(
          entry.isIntersecting,
        );
    });
    observer.observe(section);
    if (end) observer.observe(end);
    return () => {
      observer.disconnect();
      setNearEnd(false);
    };
  }, [section, end]);
  const visible =
    useSyncExternalStore(watchDocument, documentVisible, () => true) &&
    onScreen;

  const latest = useRef({ capability, workflow, state, refresh });
  latest.current = { capability, workflow, state, refresh };
  const reading = useRef(new Set<WorkflowView<WorkflowRunPage>>());
  useEffect(() => {
    const views = reading.current;
    return () => {
      for (const view of views) view.dispose();
      views.clear();
    };
  }, []);
  const readPage = useCallback(async (cursor: WorkflowRunCursor) => {
    let view: WorkflowView<WorkflowRunPage>;
    try {
      view = latest.current.capability.runs(latest.current.workflow, cursor);
    } catch {
      // Access was lost, or the session is at its view limit.
      return undefined;
    }
    reading.current.add(view);
    try {
      await view.refresh();
      const snapshot = view.snapshot();
      return snapshot.status === "ready" ? snapshot.data : undefined;
    } catch {
      return undefined;
    } finally {
      reading.current.delete(view);
      view.dispose();
    }
  }, []);

  const polling = useRef(false);
  const again = useRef(false);
  const turn = useRef(0);
  const poll = useCallback(
    async (after = false) => {
      // A read under way may predate what `after` asks to be shown, so that
      // one is followed by another. A timed read just waits for its next turn.
      if (polling.current) {
        again.current ||= after;
        return;
      }
      polling.current = true;
      try {
        do {
          again.current = false;
          const pages = activePages(latest.current.state.list);
          const first = pages.length > PAGES_PER_POLL ? turn.current++ : 0;
          await Promise.all([
            latest.current.refresh(),
            ...pages.slice(0, PAGES_PER_POLL).map(async (_, index) => {
              const cursor = pages[(first + index) % pages.length];
              const page = cursor && (await readPage(cursor));
              if (page) dispatch({ type: "page", page });
            }),
          ]);
        } while (again.current);
      } finally {
        polling.current = false;
      }
    },
    [readPage],
  );

  // History the session cleared waits for an explicit refresh.
  const live =
    newest?.status === "ready" ||
    newest?.status === "loading" ||
    newest?.status === "error";
  const interval = state.failed
    ? RUNS_FAILED_POLL_MS
    : state.list.runs.some(isActiveRun)
      ? RUNS_ACTIVE_POLL_MS
      : RUNS_SETTLED_POLL_MS;
  const [polled, setPolled] = useState(0);
  const paused = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Each finished poll schedules the next.
  useEffect(() => {
    if (!visible) paused.current = true;
    if (!visible || !live) return;
    // Catch up at once after a pause; otherwise wait, spread a little so
    // lists opened together do not read together.
    const wait = paused.current ? 0 : interval * (1 + Math.random() / 10);
    paused.current = false;
    let current = true;
    const timer = setTimeout(
      () =>
        void poll().finally(() => {
          if (current) setPolled((count) => count + 1);
        }),
      wait,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [visible, live, interval, polled, poll]);

  // A run this person just started is shown without waiting for the next poll.
  const started = useSyncExternalStore(capability.operations.subscribe, () => {
    let request: string | undefined;
    for (const operation of capability.operations.snapshot())
      if (
        operation.action === "trigger" &&
        operation.runId &&
        operation.workflow.id === workflow.id &&
        operation.workflow.owner === workflow.owner &&
        operation.workflow.channelId === workflow.channelId
      )
        request = operation.eventId;
    return request;
  });
  const shownStart = useRef(started);
  useEffect(() => {
    if (shownStart.current === started) return;
    shownStart.current = started;
    if (visible && live) void poll(true);
  }, [started, visible, live, poll]);

  const readingOlder = useRef(false);
  const loadOlder = useCallback(async () => {
    const cursor = latest.current.state.list.next;
    if (!cursor || readingOlder.current) return;
    readingOlder.current = true;
    dispatch({ type: "reading-older" });
    try {
      dispatch({ type: "older", cursor, page: await readPage(cursor) });
    } finally {
      readingOlder.current = false;
    }
  }, [readPage]);
  useEffect(() => {
    if (nearEnd && visible && state.list.next && state.older === "idle")
      void loadOlder();
  }, [nearEnd, visible, state.list.next, state.older, loadOlder]);

  return {
    runs: state.list.runs,
    loaded: state.loaded,
    /** Older runs exist that are not shown yet. */
    more: !!state.list.next,
    older: state.older,
    loadOlder,
    section: setSection,
    end: setEnd,
  };
}
