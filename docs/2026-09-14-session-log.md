# Session log — 2026-09-14

Shipped as `v1.2.16` from `release/1.2.16` (8 commits).

## The headline: browser lag after ~an hour

**Symptom.** The web client degraded until it was unusable — 20-second
freezes — after roughly an hour open. Closing and reopening the tab fixed
it. The Electron app, running the same code on Chromium, had been up for
days without trouble.

**Cause.** `Timeline` kept the hovered message in React state:

```tsx
onMouseEnter={() => setHoveredMessageId(messageKey)}
onMouseLeave={() => setHoveredMessageId((c) => (c === messageKey ? null : c))}
onFocus={() => setHoveredMessageId(messageKey)}
onBlur={() => setHoveredMessageId((c) => (c === messageKey ? null : c))}
```

Each of those re-rendered the whole component — the entire `events.map`,
`renderEvents`, `readReceiptsByEventId`. Dragging the cursor down the
message list cost one full re-render per row crossed.

It was also doing nothing. `App.css` already handled it:

```css
.timeline-event:hover .message-actions-bar,
.timeline-event:focus-within .message-actions-bar
```

The state recomputed in JavaScript a result the browser was producing for
free. The fix is deletion.

**What confirmed it.** "It's almost like it gets stuck in mouse movement
scrolling" — then parking the cursor off the message list and watching the
stutter stop.

## Three theories that were wrong

Worth recording so nobody re-runs them.

**1. Deep main-thread task queue.** An inverted profile put
`TaskController::ProcessUpdatedPriorityModifier` at the top. The Gecko
source confirms it linearly scans `mMainThreadTasks` on every event-loop
turn, so its cost scales with queue depth. Refuted by measurement: an
event-loop turnaround probe read 0.04 ms average — the queue was empty.

**2. DOM / timeline accumulation.** `extractMessageEvents` has no cap and
nothing is memoised, so unbounded growth looked plausible. Refuted: DOM
node count held at exactly 288 across a 32-second freeze, and later 145.
Nothing was accumulating.

**3. Main-thread IndexedDB serialization.** `IndexedDBStore` had no
`workerFactory`, so the whole sync accumulator was serialized on the main
thread — and Gecko is much slower at that than Chromium, which fit the
cross-browser evidence exactly. **The fix was made and kept** (it is
correct regardless) but it did not resolve the lag.

The through-line: all three read "worse over an hour" as accumulation. It
was interaction-driven the whole time, and the early data was consistent
with that from the start.

## Instrumentation mistakes

Both produced confidently wrong numbers:

- `fps` divided by a hardcoded 30 while the interval fired minutes late.
  A row reading `fps: 101.8` was really ~12 fps.
- `requestAnimationFrame` stops for backgrounded tabs, so the first frame
  after a tab switch was billed as one enormous janky frame. Five
  "90-second freezes" were just alt-tabs.

Also lost two Firefox profiles to the profiler's share panel, which
silently strips other processes, redacts URLs and clips the time range
unless every sanitize checkbox is ticked.

## Also shipped

- **Linux tray unread badge.** Plasma renders the badge on a taskbar task
  delegate; a tray-only window has none, so the count had nowhere to go.
  Linux-only indicator behind `process.platform === "linux"`, with the
  shared `setBadgeCount` contract unchanged. See
  [tray-badge-unread-investigation.md](tray-badge-unread-investigation.md).
- **Sync store in a web worker.** Off the main thread on every engine.
- **Avatar retry loop.** `memberAvatarSources` returns a fresh array each
  call, so the effect keyed on it reset `sourceIndex` every parent render
  and re-requested URLs that had already 404'd.
- **Read markers** now require the window to be visible and focused, so a
  window hidden to the tray stops clearing its own unread badge.
- Status/presence picker with custom message, rate-limit aware.
- Emoji picker: 8 → 1,898 emoji, categories, capped scroll region.
- Text emoticons (`:)` `:-)` `:=)`) mapped to Unicode on send.
- Local users display as `@alice`, not `@alice:jorvik.app`.
- DMs accept a bare `@alice`.
- GIF and pasted-image uploads send without a second Send press.

## Repo housekeeping

- Deleted 20 old releases (`v0.1.x`, `v1.1.x`) with tags — ~13.6 GB. 14
  `v1.2.x` kept. Tag `v0.1.10` survives with no release attached.
- **`sharp` was in `apps/desktop/package.json` but absent from
  `pnpm-lock.yaml`.** CI runs `pnpm install --frozen-lockfile`, so the
  next tag push would have failed on all three OSes before building
  anything. Lockfile regenerated.
- `EmojiPackStore.test.ts` timeout raised — every test resets and
  re-imports the module graph (~700 ms each), which crossed vitest's 5 s
  default under parallel load.
- Temporary `badgeTrace` diagnostics removed.

## Open

- **Unconfirmed:** whether the hover fix resolves the lag in practice. It
  is the fix with the least evidence behind it.
- **Typing notifications fire per keystroke.** Ten-plus PUTs in a few
  seconds, each 170–713 ms. Should be one notification with a timeout,
  refreshed every ~25 s.
- **Dead sessions never surface.** On an expired token the app retried
  `/capabilities` every ~30 s for 11 minutes without ever showing a login
  screen.
- `config.chat.jorvik.app.json` 404s and Caddy returns `index.html`, so
  the app starts on defaults rather than the deployed `config.json`.
- Crypto store IndexedDB is still on the main thread — not covered by
  `workerFactory`, and not reachable from our side.
- `apps/desktop/package.json` says `0.1.0` while releases are `1.2.x`. CI
  overrides it, but in-app version display may be wrong.
- Desktop builds are unsigned: Gatekeeper blocks macOS, SmartScreen warns
  on Windows.
