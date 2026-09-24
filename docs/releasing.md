# Cutting a release

Releases are built by `.github/workflows/desktop-build.yml`, which runs only on
a `v*.*.*` tag push. Nothing else triggers it, so an idle Actions tab between
releases is normal.

## Steps

1. **Bump the web package version.** `apps/web/package.json` feeds
   `__APP_VERSION__` through `vite.config.ts`, and that is what Settings shows.
   Miss it and the release reports the previous version.
   The desktop package version is overwritten by CI from the tag, so leave it.
2. **Commit and push** to `main`. There is one branch: the per-release
   `release/*` branches were deleted once they were all identical to `main`.
3. **Tag and push the tag**: `git tag -a vX.Y.Z -m "Jorvik X.Y.Z" && git push origin vX.Y.Z`.
4. **Watch the run.** Windows, macOS and Linux build in parallel, then a publish
   job attaches the assets. Seven are expected: `.exe`, `.dmg`, `-mac.zip`,
   `.AppImage`, `.deb`, `.rpm`, `.tar.gz`.
5. **The snap publishes itself.** On a tag, the Linux job uploads
   `Jorvik-<version>.snap` to the Snap Store stable channel using the
   `SNAPCRAFT_STORE_CREDENTIALS` repository secret. Nothing to do, but if that
   step fails the release is incomplete even though the GitHub assets exist.
   The credential expires; `snapcraft export-login` issues a new one.
6. **Deploy the web app** if the release contains web changes:
   `cd /root/matrix-stack && docker compose build heorot && docker compose up -d heorot`.
   This is separate from the release; the desktop client carries its own copy of
   the bundle.
7. **Add the version to the AppStream metainfo.**
   `apps/desktop/metainfo/app.jorvik.Jorvik.metainfo.xml` carries a `<releases>`
   list that software centres show as a changelog. Add the new version and date,
   then check it with `appstreamcli validate` -- AppImage hub rejects a metainfo
   file that fails validation, and it ships inside the AppImage.
8. **Bump the COPR spec and trigger a rebuild.** `packaging/rpm/jorvik.spec`:
   set `Version`, reset `Release` to `1%{?dist}`, add a `%changelog` entry.
   A webhook on the repository rebuilds COPR on every push to `main`, so
   committing the bump is enough; no click required. If a rebuild does not
   appear, check the hook's recent deliveries under the repository's webhook
   settings. Its sources
   are fetched by URL at SRPM time, so nothing needs uploading, but the release
   must be published first or the fetch 404s.
9. **Bump `jorvik-bin` on the AUR.** See below. The AUR package pins a version
   and a checksum, so it keeps installing the previous release until it is
   updated. `jorvik-git` tracks HEAD and needs nothing.

## The AUR bump, step 9

`packaging/aur/jorvik-bin/` is the source of truth; the AUR repository is a copy.

```sh
cd packaging/aur
./bump.sh 1.0.11          # refuses a version that is not published yet
```

That rewrites `PKGBUILD` and `.SRCINFO`, checks the two agree, and prints the
diff. Then copy both files into a clone of
`ssh://aur@aur.archlinux.org/jorvik-bin.git` and push, and commit the same
change here.

`.SRCINFO` is written by hand rather than by `makepkg --printsrcinfo`, which
does not run off Arch. That output was verified byte-identical on a real Arch
machine at 1.0.10. Re-verify if `PKGBUILD` gains fields: a wrong `.SRCINFO`
fails silently, because the AUR accepts it and helpers simply display the wrong
metadata.

`pkgrel` returns to 1 on a version bump, and increments only when the packaging
changes without the upstream version changing.

## Notes

- The version cannot go backwards: 1.0.x sorts below the old 1.2.x tags, but
  those were never published to any package manager, so no `epoch` is needed.
- `Jorvik.exe` and `elevate.exe` are deliberately excluded from release assets;
  they are loose binaries from inside `win-unpacked/`, not installers.
