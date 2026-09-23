# Cutting a release

Releases are built by `.github/workflows/desktop-build.yml`, which runs only on
a `v*.*.*` tag push. Nothing else triggers it, so an idle Actions tab between
releases is normal.

## Steps

1. **Bump the web package version.** `apps/web/package.json` feeds
   `__APP_VERSION__` through `vite.config.ts`, and that is what Settings shows.
   Miss it and the release reports the previous version.
   The desktop package version is overwritten by CI from the tag, so leave it.
2. **Commit and push** to the working branch and to `main`.
3. **Tag and push the tag**: `git tag -a vX.Y.Z -m "Jorvik X.Y.Z" && git push origin vX.Y.Z`.
4. **Watch the run.** Windows, macOS and Linux build in parallel, then a publish
   job attaches the assets. Seven are expected: `.exe`, `.dmg`, `-mac.zip`,
   `.AppImage`, `.deb`, `.rpm`, `.tar.gz`.
5. **Deploy the web app** if the release contains web changes:
   `cd /root/matrix-stack && docker compose build heorot && docker compose up -d heorot`.
   This is separate from the release; the desktop client carries its own copy of
   the bundle.
6. **Add the version to the AppStream metainfo.**
   `apps/desktop/metainfo/app.jorvik.Jorvik.metainfo.xml` carries a `<releases>`
   list that software centres show as a changelog. Add the new version and date,
   then check it with `appstreamcli validate` -- AppImage hub rejects a metainfo
   file that fails validation, and it ships inside the AppImage.
7. **Bump `jorvik-bin` on the AUR.** See below. The AUR package pins a version
   and a checksum, so it keeps installing the previous release until it is
   updated. `jorvik-git` tracks HEAD and needs nothing.

## The AUR bump, step 6

`packaging/aur/jorvik-bin/` holds the source of truth; the AUR repository is a
copy of it. For each release:

```sh
ver=X.Y.Z
cd packaging/aur/jorvik-bin
curl -sLO "https://github.com/jorvikapp/jorvik/releases/download/v$ver/Jorvik-$ver.deb"
sha=$(sha256sum "Jorvik-$ver.deb" | cut -d' ' -f1)
sed -i "s/^pkgver=.*/pkgver=$ver/; s/^pkgrel=.*/pkgrel=1/" PKGBUILD
sed -i "s/^sha256sums=.*/sha256sums=('$sha')/" PKGBUILD
rm "Jorvik-$ver.deb"
```

Then regenerate `.SRCINFO` (`makepkg --printsrcinfo > .SRCINFO`, which needs an
Arch machine) and push both files to `ssh://aur@aur.archlinux.org/jorvik-bin.git`.

`pkgrel` goes back to 1 on a version bump, and increments only when the
packaging changes without the upstream version changing.

## Notes

- The version cannot go backwards: 1.0.x sorts below the old 1.2.x tags, but
  those were never published to any package manager, so no `epoch` is needed.
- `Jorvik.exe` and `elevate.exe` are deliberately excluded from release assets;
  they are loose binaries from inside `win-unpacked/`, not installers.
