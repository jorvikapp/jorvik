#!/usr/bin/env bash
# Bump jorvik-bin to a released version.
#
# Rewrites PKGBUILD and .SRCINFO in place and prints the diff. Pushing is left
# to you: this only prepares the change.
#
#   ./bump.sh 1.0.11
#
# .SRCINFO is written by hand rather than by makepkg, which does not run off
# Arch. That was verified byte-identical against `makepkg --printsrcinfo` on a
# real Arch machine at 1.0.10 -- re-verify if PKGBUILD gains fields, because a
# wrong .SRCINFO fails silently: the AUR accepts it and helpers show bad data.
set -euo pipefail

version="${1:-}"
if [[ -z "$version" ]]; then
    echo "usage: $0 <version>   e.g. $0 1.0.11" >&2
    exit 2
fi
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "error: '$version' is not a release version" >&2
    exit 2
fi

cd "$(dirname "$0")/jorvik-bin"
url="https://github.com/jorvikapp/jorvik/releases/download/v${version}/Jorvik-${version}.deb"

# Fail before touching anything if the release is not published yet: a bump to
# a version that does not exist produces a package nobody can install.
code=$(curl -sIL -o /dev/null -w '%{http_code}' "$url")
if [[ "$code" != "200" ]]; then
    echo "error: $url is not downloadable (HTTP $code)" >&2
    echo "       cut and publish the release first" >&2
    exit 1
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -sL -o "$tmp/pkg.deb" "$url"
sha=$(sha256sum "$tmp/pkg.deb" | cut -d' ' -f1)
echo "sha256: $sha"

sed -i "s/^pkgver=.*/pkgver=${version}/; s/^pkgrel=.*/pkgrel=1/; s/^sha256sums=.*/sha256sums=('${sha}')/" PKGBUILD

python3 - "$version" "$sha" <<'PY'
import re, sys
version, sha = sys.argv[1], sys.argv[2]
p = ".SRCINFO"
s = open(p, encoding="utf-8").read()
s = re.sub(r"\tpkgver = .*", f"\tpkgver = {version}", s)
s = re.sub(r"\tpkgrel = .*", "\tpkgrel = 1", s)
s = re.sub(r"provides = jorvik=.*", f"provides = jorvik={version}", s)
s = re.sub(r"noextract = jorvik-.*\.deb", f"noextract = jorvik-{version}.deb", s)
s = re.sub(r"source = jorvik-[0-9.]+\.deb::\S+",
           f"source = jorvik-{version}.deb::https://github.com/jorvikapp/jorvik/releases/download/v{version}/Jorvik-{version}.deb", s)
s = re.sub(r"sha256sums = [0-9a-f]{64}", f"sha256sums = {sha}", s)
open(p, "w", encoding="utf-8").write(s)
PY

# The two files must agree, or the AUR shows one version and installs another.
pk_ver=$(sed -n 's/^pkgver=//p' PKGBUILD)
si_ver=$(sed -n 's/^\tpkgver = //p' .SRCINFO)
pk_sha=$(sed -n "s/^sha256sums=('\(.*\)')/\1/p" PKGBUILD)
si_sha=$(sed -n 's/^\tsha256sums = //p' .SRCINFO)
if [[ "$pk_ver" != "$si_ver" || "$pk_sha" != "$si_sha" ]]; then
    echo "error: PKGBUILD and .SRCINFO disagree after rewriting" >&2
    exit 1
fi

echo
git --no-pager diff -- PKGBUILD .SRCINFO
echo
echo "Review the diff, then copy both files into the AUR clone and push."
