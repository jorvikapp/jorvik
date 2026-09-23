# Warnings seen building and running the AUR packages

Recorded 2026-09-23 from a test build on Arch + KDE. Both packages passed;
neither warning blocked anything, and neither has been investigated. Written
down so the next person does not have to rediscover them, and deliberately not
"fixed" by changing anyone's system configuration.

## Fontconfig warnings during tray-badge generation (jorvik-git)

`scripts/gen-tray-badges.js` draws the unread count as SVG text and rasterises
it through sharp, so the build needs a font. On the test machine this printed a
number of Fontconfig warnings and then produced correct badges.

What was done about it: `ttf-dejavu` is now a `makedepends` of `jorvik-git`.
That is not warning suppression -- the script requests
`DejaVu Sans, Noto Sans, sans-serif` and **exits 1** when the result rasterises
blank, so a clean chroot without a font fails the build outright. The declared
dependency makes that impossible rather than luck.

The warnings themselves are probably Fontconfig complaining about cache or
config paths inside the build environment, which is a different question from
whether a usable font exists. Unexamined.

## `Invalid mime.cache` at launch (both packages)

Printed on startup by both the binary and the source build. Everything tested
afterwards worked: launch, icon, unread badge, close to tray, reopen.

This most likely comes from the desktop environment's shared-mime-info cache
rather than from anything we ship -- we install one `.desktop` file and no MIME
definitions. Worth confirming before assuming: check whether the message also
appears when running an unrelated Electron app on the same machine. If it does,
it is an environment issue and nothing here needs changing.

## Not reproduced here

Neither warning can be investigated on the build server: it is Debian, has no
`makepkg`, and no desktop session. Both need an Arch machine with a GUI.
