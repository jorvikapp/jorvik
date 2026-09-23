# Snap: what is ready, and what is left

Prepared 2026-09-23. The `snap` target is **configured but not enabled**: it is
absent from `linux.target` in `apps/desktop/electron-builder.json`, so releases
do not build one yet. Adding `"snap"` to that list is the switch.

## What was established by building one

A snap was built locally on Debian, twice, to see what it actually takes.

- **No snapcraft, no LXD, no multipass.** Electron Builder uses its template-app
  path, which downloads a 1.5MB template and packs the snap with a bundled
  squashfs tool. `squashfs-tools` was not installed on the machine at the time
  of the first successful build, so the system copy is not used either. **CI
  needs no new tooling to build.** Publishing is a different matter, below.
- The template path applies only while `useTemplateApp` is not false, the arch
  is x64 or armv7l, `buildPackages` is empty and `stagePackages` matches the
  defaults (`targets/snap.js`). Customising stage packages silently drops back
  to requiring snapcraft.
- Result: `Jorvik-1.0.9.snap`, 109MB, `confinement: strict`, `grade: stable`.

## What the config fixes

The generated metadata defaulted to `summary: Jorvik` and
`description: Jorvik Desktop Client`, which is what a store listing would have
shown. Both are now set properly.

Three plugs were added to the defaults, and the reasons matter:

- **`audio-record`** -- voice channels need a microphone. The default set has
  `audio-playback` and `pulseaudio` only, so without this voice would play but
  not capture.
- **`password-manager-service`** -- the app sets `enableCookieEncryption` and
  uses the system keyring through libsecret. Denied, `safeStorage` fails.
- **`camera`** -- reserved for video; harmless if unused.

## What is left, and the part that is not automatic

1. **Register the name.** `jorvik` was unregistered on the Snap Store as of
   2026-09-23 (`api.snapcraft.io/v2/snaps/info/jorvik` returned
   `resource-not-found`). `snapcraft register jorvik` claims it.
2. **Enable the target** by adding `"snap"` to `linux.target`.
3. **Publishing from CI** needs snapcraft credentials, which is the one genuinely
   new secret: `snapcraft export-login` produces a token, stored as a repository
   secret and read by `snapcraft upload`. Building does not need it; only
   uploading does.
4. **Auto-connection is the real caveat.** `audio-record`,
   `password-manager-service` and `camera` are **not auto-connected** under
   strict confinement. Until the store grants auto-connection, users must run
   `snap connect jorvik:audio-record` and the equivalents by hand, or the
   microphone and the keyring simply will not work. Requesting auto-connection
   is a manual review thread on the Snapcraft forum, and it is slow. Plan for
   it rather than discovering it from bug reports.

## Untested

Nobody has installed the snap. Strict confinement is a different runtime from
the AppImage and the deb: the tray icon, desktop notifications, the keyring and
voice capture are all mediated by interfaces and portals, and any of them can
behave differently. `base: core20` is also old -- moving to a newer base means
leaving the template path, so it is a deliberate decision, not a version bump.
