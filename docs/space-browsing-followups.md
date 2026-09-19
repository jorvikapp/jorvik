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

## 2. Isolated HTTP 401 on a hierarchy request

```
2026-09-19 21:52:42  0.001s  83B  401  {None}
GET /_matrix/client/v1/rooms/!iMZEhwCvbfeAYUxAjZ%3At2l.io/hierarchy?...
```

One occurrence. `{None}` means Synapse identified no user for the request. The client
recovered: the same three pages loaded normally at 21:52:55.

**Not established:** the cause. An access-token refresh race is one candidate, but there
is no evidence for it beyond the timing, and a single 1ms 401 is thin material.

**What would settle it:** a second occurrence with the surrounding client requests
captured, particularly whether a `POST /_matrix/client/v3/refresh` precedes it.
Symptomatically it would show as a space briefly appearing empty or erroring.

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
