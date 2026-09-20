# Space browsing: open observations and deferred work

Recorded 2026-09-19/20 while fixing federated space browsing. Each item states what was
observed and what is **not** established, so none of it is mistaken for a diagnosis.

## 1. Cancellation of an in-flight hierarchy fetch is unverified live

`fetchSpaceHierarchy` aborts the underlying request when a page times out or the caller
navigates away, and both paths have unit tests. Neither has been observed in production.

The one space switch captured (2026-09-19, baseline 21:49:29Z) happened at 21:51:55,
about 67 seconds after the first page began and after the load had already finished at
21:50:48, so nothing was in flight to cancel. No aborted (`0B`) responses appear in that
window.

**Not established:** whether an abort actually closes the connection, and whether a
response arriving after a switch is correctly ignored in the UI.

**What would settle it:** switch away from a space during a cache-cold hierarchy load
(~37s for `#community:matrix.org` when Synapse's response cache is cold) and check for a
`0B` completion in Synapse's access log plus no content appearing in the newly selected
space. Note the per-space client cache makes a cold load harder to reproduce.

## 2. HTTP 401 on authenticated requests: ordinary token expiry, recovers by itself

Investigated 2026-09-20. **No action taken, and none proposed.** Recorded so a future
reader does not re-investigate, and so the limits of the evidence are clear.

Two occurrences seen, on different endpoints:

```
2026-09-19 21:52:42  0.001s  83B  401  {None}  GET /_matrix/client/v1/rooms/{space}/hierarchy
2026-09-20 02:24:38  0.001s  83B  401  {None}  GET /_matrix/client/v3/sync
```

The second was captured with its surroundings, which the first was not:

```
02:24:37.873  200  GET  /_matrix/client/v3/sync    user=@user
02:24:38.187  401  GET  /_matrix/client/v3/sync    user=None
02:24:38.507  200  POST /_matrix/client/v3/refresh
02:24:42.449  200  GET  /_matrix/client/v3/sync    user=@user   recovered
```

**Confirmed**

- Both recovered automatically. The 2026-09-20 case took about 4.3 seconds; in the
  2026-09-19 case the three hierarchy pages loaded normally 13 seconds later.
- `refreshable_access_token_lifetime` is **not set** in `homeserver.yaml`, so Synapse's
  default of **5 minutes** applies (`synapse/config/registration.py`). That matches the
  observed cadence: 63 refreshes across a retained 1h48m window, clustered every ~5 min.
- matrix-js-sdk refreshes and **retries the original request** transparently on
  `M_UNKNOWN_TOKEN` (`http-api/fetch.ts`): on a successful refresh it re-issues via
  `doAuthedRequest(attempt + 1, ...)`. It also refreshes eagerly within 500ms of expiry,
  shares one `tokenRefreshPromise` across concurrent callers, backs off exponentially, and
  deliberately does **not** refresh when the token should still be valid.
- The space hierarchy fetch uses `client.http.authedRequest`, so it sits behind that same
  refresh-and-retry rather than bypassing it.

**Suspected, not established**

- That the errcode was `M_UNKNOWN_TOKEN`, i.e. an expired token. Everything observed is
  consistent with it and 83 bytes matches that error's shape, but the access log records
  status and size, not the body.
- **Correction to an earlier claim in this file's history:** `{None}` does *not* prove an
  `Authorization` header was present. It means only that Synapse resolved no user, which a
  missing header, a malformed one, or an invalid token all produce. The access logs cannot
  distinguish them.

**Observation, not a fault:** refreshes arrive in clusters of 2-3 within seconds, roughly
2.9 per expiry window where one would do. The dedupe clears `tokenRefreshPromise` in a
`finally`, so a request failing just after one refresh completes starts another. At 139
bytes per refresh this costs nothing worth changing.

**One narrow risk left open.** If a refresh ever returned `Logout` or `Failure`, the error
would surface to the hierarchy effect, whose generic `catch` clears the channel lists and
shows the pending notice with nothing re-triggering the fetch until the user switches
spaces. No evidence this has happened; both observed 401s recovered.

**What would justify revisiting:** repeated authentication failures, or a user-visible
symptom such as a space that stays empty until you navigate away and back. Confirming the
errcode would need a Synapse tracer at `debug` or a browser network capture, neither of
which is warranted for two self-healing occurrences.

## 3. RoomList does not finish rendering under the test harness

An attempt to add a DOM-order regression test for the sidebar sections could not be made
to terminate. Bisected:

| Probe | Result |
|---|---|
| existing `ReactionPicker` component test | passes, 8.7s |
| importing `RoomList` alone | passes, 5ms |
| all mocks, no render | passes, 5.6s |
| same mocks with render | hangs, four attempts |

Three unstable identities in the test's own mocks were found and fixed along the way
(`readCategories`/`readChannelOrder` returning fresh arrays, `usePresenceMap` returning a
fresh `Map`, the avatar-source arrays), using `vi.hoisted` because `vi.mock` factories
hoist above ordinary declarations. It still hangs.

**Not established:** the cause, and specifically whether any production code path is
affected. A component that loops when its inputs change identity every render would be
consistent with the observation, but so would several other explanations, and the mocks
are not the real modules.

**What would settle it:** item 4 below. Extracting the sections into a presentational
component would either make the test pass, or narrow the hang to the parts left behind.

## 4. Deferred: extract the sidebar discovery sections

Pull the "Subspaces" and "Available channels" blocks into a presentational component
taking already-computed props, with no hooks, providers or polling. That makes DOM-order
and affordance rendering testable, and gives item 3 a way forward.

## 5. Deferred: progressive rendering of a space hierarchy

A cold `#community:matrix.org` load is about 37 seconds across three pages
(17.9s + 16.4s + 2.5s measured). Rendering each page as it arrives would show the first
50 rooms at roughly 18s instead of 37s, with an explicit indication that loading is
incomplete.

Design notes for whoever picks it up:

- only complete results should be cached, so a partially rendered space must not be
  written to the per-space cache
- a smaller `limit` than 100 may return page 1 sooner; page 1's 17.9s appears to be
  dominated by the server summarising remote rooms, but that has not been measured
  directly
- Synapse's own response cache makes repeat fetches roughly 40x faster
  (0.9s versus 36.7s observed), so this matters most for the genuinely first load
