# Tray badge and premature unread reset investigation

Investigated 2026-09-13/14, continuing from `linux-launcher-badge-investigation.md`.
Three changes were made to the working tree. Nothing was committed, pushed, or
released. `pnpm-lock.yaml` and `node_modules` were not modified.

## Outcome

Two independent defects, found in sequence:

1. **No taskbar target in the tray-only state.** On KDE, an unpinned application
   with no toplevel window has no task delegate, so `app.setBadgeCount` has
   nowhere to render. Addressed with a portable Linux tray-icon indicator.
2. **The renderer marked messages read while hidden.** `Timeline.tsx` advanced
   the read marker on every new message with no visibility gate, so the unread
   count — and therefore the badge — cleared seconds after appearing.

The second defect is platform-independent. It was clearing the macOS dock badge
and the Windows overlay icon for the same reason; the Linux work only made it
visible.

## What was ruled out, and how

Each of these was a working hypothesis that the evidence killed. They are
recorded so they are not re-investigated.

- **Plasma QML rendering.** Instrumented `plasma-desktop` v6.7.4
  (`TaskBadgeOverlay.qml`, `Task.qml`, `smartlauncheritem.cpp`,
  `smartlauncherbackend.cpp`) with read-only probes. Konsole rendered a real
  painted badge through the identical code path. The QML layer is correct.
- **Desktop-file placement / `NoDisplay`.** `jorvik.desktop` sits directly in
  `~/.local/share/applications` with no `NoDisplay`. `menuId()` resolves fine.
- **`serviceByMenuId()` vs `serviceByStorageId()` asymmetry** between
  `SmartLauncher::Item` and `Backend`. Real asymmetry in the upstream source,
  but resolution succeeded every time a task delegate existed.
- **Notification suppression gates** in `Backend::count()` — badges enabled,
  Do Not Disturb off, app not blacklisted. All verified clear.
- **Encrypted-room `notification_count: 0`.** `matrix-js-sdk/lib/sync.js:1113`
  trusts a server-provided zero for encrypted rooms, which the SDK's own `XXX`
  comment documents as faulty. Reproduced in an *unencrypted* room, so not this.
- **Notification lifecycle.** `notification.on("close")` in `main.ts` only logs.
  `useElementLikeNotifications.ts` closes popups when unread is already zero; it
  never sends receipts. The timing correlation with the notification timeout was
  a coincidence — both are a few seconds after the same message.

## How the second defect was actually found

Static tracing produced two wrong answers. Measurement produced the right one in
one run. Temporary instrumentation logged every write to a room's notification
count with its caller, every outgoing receipt API call, and — decisively — every
HTTP request touching `/receipt` or `/read_markers`. Nothing can send a receipt
without passing that layer, so it distinguishes "this client sent it" from
"another device sent it" with no ambiguity.

The trace showed Jorvik itself issuing `POST /read_markers` for the incoming
event while hidden in the tray, followed by `SyncApi.processSyncResponse`
resetting unread 1 to 0 roughly 350-400 ms later, followed immediately by
`desktopBadge(0)`.

Call site:

```
Timeline.tsx:1890  useEffect([events, ...])     unguarded, fires on every new message
  -> markActiveRoomReadToLatest()   (:1847)
  -> client.setRoomReadMarkers(...) (:1876)
```

Electron hides the window to the tray rather than destroying it (`main.ts:525`),
so the renderer keeps running and the timeline stays mounted with
`stickToBottomRef.current === true`.

## Changes in the working tree

Three separable changes.

**1. Linux tray badge (`apps/desktop`)**

- `electron/linux-tray-badge.ts` — new. Mirrors the count onto the tray icon.
  Desktop-agnostic: no `XDG_CURRENT_DESKTOP` checks, nothing KDE-specific.
  200 ms debounce, count 0 restores `resolveIconPath()` verbatim, renders at
  32 px to match the existing tray sizing. Writes each icon to a unique path
  because AppIndicator and other SNI hosts cache by icon path.
- `scripts/gen-tray-badges.js` — new, build-time only. Pre-renders 101 PNGs
  (`tray-0` .. `tray-99`, `tray-99plus`) from `../web/public/jorvik-icon.png`.
  `sharp` is a devDependency and does not ship. Fails the build if the rendered
  badge is blank, which is the "build machine has no font" case.
- `electron/main.ts` — construction beside the existing `Tray`, mirror call
  inside the existing `process.platform === "linux"` branch, dispose on
  `before-quit`. The darwin and win32 branches are unchanged.
- `electron-builder.json` — `extraResources` added under `linux` only, not the
  shared root array, because that file also serves the signed-mac and win
  targets and a root entry pointing at a Linux-only directory would break them.
  Platform sections replace the root array rather than merging, so the existing
  `jorvik.png` entry is carried across. `!build/tray-badges/**` added to `files`
  so the badges are not also bundled into the asar.
- `package.json` — `build:tray-badges`, wired into `dist:linux` only.
  `electron-builder.mac-unsigned.json` untouched, so mac artifacts carry none of it.

**2. Read-marker visibility gate (`apps/web`)**

- `Timeline.tsx` — `isTimelineUserVisible()` gate on the events-driven
  auto-read, plus a catch-up listener on `focus` / `visibilitychange` so
  returning to the app still marks the open room read. `handleScroll` is
  untouched: scrolling is user-driven and implies the user is present.

**3. Temporary instrumentation — REMOVE BEFORE COMMIT**

- `apps/web/src/ui/diagnostics/badgeTrace.ts` — new.
- `AppShell.tsx` +5 lines, `main.ts` +7 lines (renderer console forwarding).
- Strip with `apps/desktop/scripts/revert-badge-trace.sh`.

## Verification status

Verified:

- `tsc` passes under `strict: true`; no errors in any changed file.
- Badge set: 101 PNGs, all distinct, all painted, 812K.
- AppImage builds; `resources/jorvik.png` and `resources/tray-badges/` (101
  files) both present; zero badge files leaked into the asar.
- Packaged app launches under Xvfb and the tray path executes: writes
  `/tmp/jorvik-tray-<pid>/t0-tray-0.png`, resized 1.35 MB to 2.6 KB, cleaned up
  by `dispose()` on quit.
- On real KDE: the tray icon repaints and the numeric badge renders.

Not yet verified:

- The read-marker fix has not been run on real KDE. Expected: badge persists
  while hidden with no `OUTGOING setRoomReadMarkers` in the log, then clears on
  focus.
- Windows and macOS were not rebuilt or tested. Both should benefit from the
  read-marker fix; neither has platform-specific code changed.

## Open questions

- An earlier reproduction reported the badge clearing for a message in a
  *non-active* room. `AppShell` renders exactly one `<Timeline>`, bound to
  `activeRoom`, and there is exactly one `setRoomReadMarkers` caller, so this
  path can only mark the active room read. Either that room was active after
  all, or a second mechanism exists that this fix does not cover. Worth one
  deliberate re-test.
- The SDK's encrypted-room behaviour at `sync.js:1113` is still latent. It did
  not cause this bug, but a server that issues `notification_count: 0` for
  encrypted rooms will clear counts the client computed locally.

## Remaining work

1. Verify the read-marker fix on KDE.
2. Run `revert-badge-trace.sh`; delete `*.bak-tray-badge` and
   `Timeline.tsx.bak-readmarker-fix`.
3. Install sharp for real (`pnpm install` wanted to delete and rebuild
   `node_modules`, so this was deliberately left alone).
4. Minified `dist:linux`. Note `dist:linux` stamps the `package.json` version
   (0.1.0); the release flow goes through `npm run dist` -> `dist-with-version.mjs`.
5. Split into three commits.

## References

- `matrix-js-sdk` 40.2.0 `lib/sync.js:1101-1126` — encrypted-room count handling
  and its `XXX` comment
- `matrix-js-sdk` 40.2.0 `lib/client.js:7348` — `fixNotificationCountOnDecryption`,
  increments only
- `plasma-desktop` v6.7.4 `applets/taskmanager/smartlauncherbackend.cpp:110-124`
  — the gates that force any badge to zero
- `plasma-desktop` v6.7.4 `applets/icontasks/metadata.json` —
  `X-Plasma-RootPath` makes Icons-only Task Manager a shim over the same QML
