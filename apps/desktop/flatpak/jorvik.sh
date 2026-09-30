#!/bin/sh
# A per-app TMPDIR lets a second launch reach the running instance
# (Chromium's singleton socket lives there).
export TMPDIR="${XDG_RUNTIME_DIR}/app/${FLATPAK_ID}"
exec zypak-wrapper /app/jorvik/jorvik "$@"
