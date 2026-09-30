#!/usr/bin/env bash
# Builds dist-electron/Jorvik-<version>-x86_64.flatpak from the unpacked
# Linux app (dist-electron/linux-unpacked) inside the Flathub build
# container, the same way locally and in CI. Needs Docker.
set -euo pipefail
cd "$(dirname "$0")/.."

version="${1:?usage: scripts/build-flatpak.sh <version>}"
bundle="dist-electron/Jorvik-${version}-x86_64.flatpak"
test -d dist-electron/linux-unpacked || { echo "no dist-electron/linux-unpacked: build the Linux app first" >&2; exit 1; }
test -f build/icons/512x512.png || { echo "no build/icons: run the desktop build first" >&2; exit 1; }

docker run --rm --privileged -v "$PWD:/desktop" -w /desktop \
    ghcr.io/flathub-infra/flatpak-github-actions:freedesktop-24.08 \
    bash -euo pipefail -c "
        flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
        flatpak-builder --user --install-deps-from=flathub --force-clean --disable-rofiles-fuse \
            --state-dir=.flatpak-builder --repo=.flatpak-repo .flatpak-build flatpak/app.jorvik.Jorvik.yml
        flatpak build-bundle .flatpak-repo '${bundle}' app.jorvik.Jorvik \
            --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo
    "
ls -lh "${bundle}"
