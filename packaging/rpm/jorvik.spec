# Repackages the upstream release tarball. Building from source is not viable in
# a COPR chroot: the build needs pnpm and npm registry access, and mock has no
# network. The tarball is payload only, so the desktop entry and the icon set
# are produced here.
Name:           jorvik
Version:        1.0.8
Release:        1%{?dist}
Summary:        Self-hosted Matrix client built to feel like Discord

License:        AGPL-3.0-only
URL:            https://github.com/jorvikapp/jorvik
Source0:        %{url}/releases/download/v%{version}/Jorvik-%{version}.tar.gz
Source1:        %{url}/raw/v%{version}/apps/web/public/jorvik-icon.png
# Added after v1.0.8, so this source only resolves from v1.0.9 onward. The
# version below must be a release that carries it.
Source2:        %{url}/raw/v%{version}/apps/desktop/metainfo/app.jorvik.Jorvik.metainfo.xml

BuildRequires:  ImageMagick
BuildRequires:  desktop-file-utils
BuildRequires:  libappstream-glib

Requires:       gtk3
Requires:       nss
Requires:       libnotify
Requires:       libXScrnSaver
Requires:       libXtst
Requires:       at-spi2-core
Requires:       libsecret
Requires:       xdg-utils
Recommends:     libappindicator-gtk3

# Upstream publishes x86_64 only.
ExclusiveArch:  x86_64

# The payload is a prebuilt Electron application; stripping or rebuilding its
# binaries breaks the ASAR integrity check.
%global __os_install_post %{nil}
%global debug_package %{nil}

# Electron bundles its own libraries. Without this the package advertises
# libffmpeg.so to the whole repository, where it could satisfy some unrelated
# package's dependency. The matching requirement is dropped too, since it is
# only ever satisfied from inside this package. System libraries are still
# detected automatically, so the real dependency list stays accurate.
%global __provides_exclude_from ^%{_prefix}/lib/jorvik/.*$
%global __requires_exclude ^libffmpeg\\.so.*$

%description
Jorvik is a Matrix client that arranges a homeserver the way a chat app should
feel: Spaces are servers, rooms are channels, and end-to-end encryption is on by
default. It talks to any Matrix homeserver, including one you run yourself.

%prep
%setup -q -n Jorvik-%{version}

%build
# Nothing to compile; the icon set is rendered in %%install.

%install
install -d %{buildroot}%{_prefix}/lib/jorvik
cp -a . %{buildroot}%{_prefix}/lib/jorvik/

install -d %{buildroot}%{_bindir}
ln -sf %{_prefix}/lib/jorvik/jorvik %{buildroot}%{_bindir}/jorvik

# The tracked source image is 1254x1254, which is not a size hicolor declares,
# so desktops would skip it. Render the standard sizes instead.
for size in 16 24 32 48 64 128 256 512; do
    install -d %{buildroot}%{_datadir}/icons/hicolor/${size}x${size}/apps
    convert %{SOURCE1} -resize ${size}x${size} \
        %{buildroot}%{_datadir}/icons/hicolor/${size}x${size}/apps/jorvik.png
done

install -d %{buildroot}%{_datadir}/applications
cat > %{buildroot}%{_datadir}/applications/jorvik.desktop <<'DESKTOP'
[Desktop Entry]
Name=Jorvik
Comment=Jorvik Desktop Client
Exec=jorvik %U
Icon=jorvik
Terminal=false
Type=Application
Categories=Network;Chat;
StartupWMClass=jorvik
DESKTOP

install -Dm644 %{SOURCE2} \
    %{buildroot}%{_datadir}/metainfo/app.jorvik.Jorvik.metainfo.xml

%check
desktop-file-validate %{buildroot}%{_datadir}/applications/jorvik.desktop
appstream-util validate-relax --nonet \
    %{buildroot}%{_datadir}/metainfo/app.jorvik.Jorvik.metainfo.xml

%files
%license %{_prefix}/lib/jorvik/LICENSE.electron.txt
%{_prefix}/lib/jorvik/
%{_bindir}/jorvik
%{_datadir}/applications/jorvik.desktop
%{_datadir}/icons/hicolor/*/apps/jorvik.png
%{_datadir}/metainfo/app.jorvik.Jorvik.metainfo.xml

%changelog
* Wed Sep 23 2026 Jorvik contributors <admin@jorvik.app> - 1.0.8-1
- Initial COPR package
