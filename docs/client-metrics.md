# Client performance metrics

## Agent snapshots in packaged apps

With **Plugin development** enabled, an agent on this device can call
`performance_snapshot({"duration_ms":5000})`. An external agent needs the owner's
existing full-agent approval. This uses the shipped agent tool route. Native MCP
and Developer mode are not required. Older apps do not offer this tool.

The only argument is optional `duration_ms`: an integer from 1000 to 10000,
default 5000. A second concurrent capture fails. The capture stops when the
plugin unloads or the host cancels the call or ends its owning turn or
connection. External MCP supports connection cancellation. It does not cancel
individual requests. No recorder runs between calls. A blocked or throttled page
can delay completion. Use the reported `elapsedMs`, not the requested duration.

| Report field | Meaning |
| --- | --- |
| `version`, `sessionId`, `startedAt` | Schema version 1, a random ID shared by captures in this page lifetime, and the capture's UTC start. The ID changes on page reload. |
| `host` | Desktop flag, production-bundle flag and native app version, or `null` when not available. This does not identify an OS process or source commit. |
| `requestedMs`, `elapsedMs`, `visibility` | Requested and actual duration; visible and hidden milliseconds; final page visibility. |
| `mainThread.timerLag` | Timer lateness of at least 50 ms, sampled every 100 ms while visible, including an overdue sample at completion: count, total/max milliseconds and visible sample count. Hidden time and visibility transitions reset its baseline. This is delay, not CPU use. |
| `mainThread.longTasks` | Unbuffered long-task entries delivered during capture, when supported. Includes hidden-page work. Unsupported engines, including WebKit, return `supported:false` and a reason, not a zero count. |
| `work` | Existing `fold`, `verify.read` and `verify.restore` batch instrumentation: batch count, item count and total/max batch milliseconds. Includes all retained relay sessions and visibility states. Native signature work outside these timers is not included. |
| `reads` | Completed finite reads across relay sessions: count, total/max request milliseconds, decoded UTF-16 code units, failed count and background count. Reads started before capture can finish inside it. |
| `agentUpdates` | Calls to the agents service's existing change subscription. This is update frequency, not recipient or listener count. |
| `mcpReplies` | Plugin `Host.serveMcp` JSON encoding attempts: count, total/max synchronous encoding milliseconds, UTF-16 code units and encoding failures. Excludes native IPC and handler work. Counts successful encoding even if transport later fails. |
| `unsupported` | Explicit gaps: process CPU, heap, layout, style, all-JavaScript time, JSON outside plugin MCP replies, and subscriber count. |

All time totals use `totalMs` and `maxMs`. Captures retain fixed numeric totals,
not sample arrays. Work has exactly three keys. Update and serialization counters
never retain payloads, message bodies, keys, URLs or credentials. A capture owns
one subscription, two timers, one visibility listener and at most one observer.
Completion, cancellation and setup failure release them. There are no diagnostic
disk or relay writes. The agent receives a normal tool result. Its own reply is
encoded after capture stops and is outside the measured window.

Compare equal durations and visibility states. High lag with many updates or
large MCP output suggests a path to inspect. It does not prove causation.
Use a profiler for work outside the listed boundaries. This tool does not start
monitoring, send alerts, or dispatch work by itself.

## Development metrics

Development builds record how quickly channels open, where their rows come
from, what warming costs the main thread, and how long live coverage takes to
set up. The numbers stay in memory in the page. Nothing is sent anywhere, and
production builds and unit tests get a no-op recorder
([`client-metrics.ts`](../src/features/developer/client-metrics.ts)).

## Viewing and exporting

Run `just web` or `just desktop`, use the app, then open **Settings →
Developer → Client performance**.

The Developer page leads with broker totals, then session summary cards,
a source-by-source wait/render chart, and connection measurements. Connection
history stays horizontally scrollable when its columns cannot fit. These are
existing session measurements, not a historical analytics store.

**Export JSON** downloads the summary and
the raw records, so builds can be compared side by side. **Reset** clears the
records and keeps the current connection's coverage. In the browser console,
`__buzzClientMetrics.summary()` returns the same data.

To record a baseline for a build: reload, wait for the sidebar to settle, open
the channels you usually read (by click or keyboard), then export. Repeat on
the other build with the same roster and the same order.

## What is measured

| Metric | Definition |
|---|---|
| Click-to-content | From the sidebar click or keyboard event (or, for other routes, the pane switch) to the first paint after one of its rows is in the DOM. |
| Wait / render | Each open splits at the moment the store first holds rows for the channel. **Wait** runs until then: a disk read or relay request, or zero when the rows were already there. **Render** is the rest, from rows in memory to rows on screen. The panel shows the median of each part, so the parts need not add up to the median total. |
| Source | Where the rows came from, tracked apart from freshness (a dropped socket marks relay rows stale, which does not make them disk rows). `memory`: rows a relay read already fetched this session. `disk`: restored from IndexedDB before the open. `disk-late`: the open waited, then a disk restore arrived before the network read did. `network`: the open waited for a relay read. |
| Cache-hit rate | Share of opens served from `memory` or `disk`, with no network wait. |
| Long tasks | Long-task entries where the engine supports them (Chromium). WebKit has none, so it uses event-loop lag of at least 50 ms instead. |
| CPU | Time spent verifying signatures (`verify.read`, `verify.restore`) and folding rows (`fold`), measured per batch or window, never per event. |
| Reads | `/query` calls (and the broker's channel-activity reads), with decoded response size in UTF-16 code units (about bytes for JSON). They are grouped by phase: the app open, then each reconnect. |
| Live coverage | Per phase: time from connecting to the socket authenticating, and to every channel route settling: live, or failed (refused, or over the live capacity). The panel counts every settled route that is not live as failed. Also each route's pending→live time after authentication. |

Opens with nothing to paint are not timed: empty or failed channels, and
rows kept offscreen by a saved scroll position. The summary counts them as
**Not timed**. Leaving the pane (for Settings, say) drops an unfinished open,
and coming back is a new open.

Live coverage and reads follow the first relay session the page reports,
normally the community selected at launch. Other retained communities keep
their own sockets, which would otherwise read as that session reconnecting.

## Live setup probe

`pnpm probe:live` compares ways of setting up live subscriptions against a
real relay. Each run uses a fresh authenticated socket.

```sh
BUZZ_PRIVATE_KEY=nsec1… BUZZ_RELAY_URL=wss://relay.example pnpm probe:live \
  --strategies idle,client:1,client:4,client:16,client:all,filters:10,multi-h:all \
  --runs 3 --json probe.json
```

| Strategy | What it sends |
|---|---|
| `client:K` | The app's own subscriber ([`live.ts`](../src/features/relay/live.ts)), treating the roster as joined channels: up to ten singleton channel filters per REQ, with K wire setups outstanding. The app uses 4. It includes the profile and membership routes. |
| `filters:F` | All channels at once, F per REQ, one `#h` channel per filter. The relay allows at most 10 filters per REQ. |
| `multi-h:M` | All channels at once, M channels in one filter's `#h` per REQ. |
| `idle` | Nothing, which gives a baseline for the canary. |

Without `--channels` (a comma-separated list or `@file`), it probes every
channel the identity is a member of. It stops if that roster read is refused
or hits its 500-channel cap, rather than probing part of the roster. It reports medians of:

- **coverage:** from authentication to the last channel reaching EOSE, only
  when every channel did;
- **per-REQ time:** from send to EOSE;
- **canary:** how long a one-filter REQ sent right after the burst took to
  reach EOSE, compared with `idle`;
- **failures:** refusals by reason (including the canary's), summed over runs.

A run that misses `--timeout` (30 s by default) or leaves any channel refused
is counted as `incomplete`, and that strategy then reports no coverage median,
since a median over only the finished runs would favour it. Likewise, a
refused canary is counted under `canary refused` and suppresses the canary
median.

Refusals such as `rate-limited: quota exceeded` count as failures for the raw
strategies. The app's subscriber retries them itself. Runs rotate their order
and pause 10 s between runs so one run's quota use doesn't spill into the next.
The probe checks only that setup reaches EOSE; it does not check live event
delivery after that.
