# Contributing to Jorvik

Thanks for wanting to help! Jorvik is chat and voice for Matrix, built in the open
under the [AGPL-3.0](LICENSE). It is still in alpha, so there is plenty to do, and
help of every kind is welcome: bug reports, testing, ideas, code and packaging.

## Ways to help

- **Report a bug or suggest a feature** in
  [Issues](https://github.com/jorvikapp/jorvik/issues/new/choose). Please search the
  open issues first, in case it is already there.
- **Test releases on your system.** Windows and macOS get the least testing, so
  reports from those are especially useful.
- **Fix something.** Issues labelled
  [good first issue](https://github.com/jorvikapp/jorvik/labels/good%20first%20issue)
  are a gentle place to start, and
  [help wanted](https://github.com/jorvikapp/jorvik/labels/help%20wanted) marks where
  help is needed most.
- **Improve packaging** for your distribution, in `packaging/` and `apps/desktop/`.

For help with your account, or anything you would rather not post in public, email
**support@jorvik.app**. **Security problems** go there too, not into a public issue,
so they can be fixed before anyone else learns about them.

## Before you start on code

For anything bigger than a small fix, please open an issue first and say what you
have in mind, so we can agree on the approach before you spend time on it.

## Setting up

You need Node.js 22 or newer and pnpm 10 or newer.

```bash
git clone https://github.com/jorvikapp/jorvik.git
cd jorvik
pnpm install
```

On Linux, if `pnpm install` fails on Windows-only install scripts, run
`pnpm setup:linux` instead.

Point the web app at a homeserver:

```bash
cp apps/web/config.example.json apps/web/config.json
```

Then set `base_url` and `server_name` under `default_server_config` in
`apps/web/config.json`. Use a test account on a server you control, or a throwaway
local [Synapse](https://element-hq.github.io/synapse/latest/setup/installation.html),
rather than your everyday account.

```bash
pnpm dev:web        # the web app, at http://localhost:5173
pnpm dev:desktop    # the desktop app
```

## Where things are

- `apps/web` is the client itself: React, TypeScript and Vite, with matrix-js-sdk
  and its Rust crypto. Most changes happen here. `src/core` holds the Matrix logic
  and `src/ui` the interface.
- `apps/desktop` is the Electron shell (window, tray, badges, notifications) and
  the build configuration for the installers, the Snap and the Flatpak.
- `packaging` holds the AUR packages and the RPM spec used by COPR.
- `docs` has notes for maintainers, including how releases are cut.

## Checks

Before opening a pull request, run these from the repository root:

```bash
pnpm typecheck
pnpm --filter @heorot/web test
pnpm --filter @heorot/web test:smoke
```

`pnpm typecheck` ignores errors inside matrix-js-sdk's own sources, which are not
ours to fix, so anything it reports is in Jorvik's code.

Add or update tests for what you change. Unit tests live in
`apps/web/test/unit-tests` and run with Vitest; components are tested by rendering
them with fakes rather than talking to a real server.

## Pull requests

- Keep each pull request to one change, and explain what it does and why. Link the
  issue it fixes, for example "Fixes #12".
- For changes you can see, add a screenshot or a short clip.
- Write commit messages as a short summary with a scope, like the history does:
  `fix(web): …`, `feat(desktop): …`, `docs: …`. Use the body to say why.
- Match the style of the code around your change: TypeScript, React function
  components, four-space indentation, double quotes.
- Keep text that people will read short and plain.

By contributing, you agree that your work is published under the project's
[AGPL-3.0](LICENSE) licence.

## Be kind

Be respectful and assume good intent, in issues, reviews and everywhere else.
