# @heorot/web

The Jorvik web client. The package keeps the `@heorot` name from the project Jorvik grew out of. For user-facing documentation, setup guides, and voice configuration see the [root README](../../README.md).

---

## Development

```bash
# From repo root
pnpm dev:web        # dev server → http://localhost:5173
pnpm build:web      # production build → apps/web/dist/
pnpm typecheck      # TypeScript type check

# From this package directory
pnpm dev
pnpm build
pnpm typecheck
pnpm test           # vitest unit tests
```

---

## Architecture

```
src/
├── core/   # Matrix logic, no React: client and session lifecycle, auth (password, SSO),
│           # crypto and cross-signing, rooms, spaces, DMs, presence, push, voice, storage
└── ui/     # React: AppShell, Timeline, Composer and the other components, settings,
            # notifications, layout (desktop and phone), providers, styles
```

**State machine** (`MatrixProvider`): `booting` → `login_required` / `starting` → `security_verification` / `security_recovery` → `ready`

---

## Runtime config

Config is loaded from `config.json` at startup. Copy from `config.example.json`:

```bash
cp config.example.json config.json
```

See the [root README configuration reference](../../README.md#configuration-reference-configjson) for all keys.

---

## Presence gate

Presence indicators are gated per homeserver in `config.json`:

```json
{
  "enable_presence_by_hs_url": {
    "https://matrix.example.com": true,
    "http://localhost:8008": true
  }
}
```

If omitted, presence defaults to enabled for localhost and the configured homeserver.

---

## Troubleshooting

**`WebAssembly: Response has unsupported MIME type 'text/html'`**
Run through `pnpm dev` or `pnpm preview`. If self-hosting, ensure `.wasm` files are served as `application/wasm`.

**`Failed to resolve import "@matrix-org/matrix-sdk-crypto-wasm"`**
Run `pnpm install` from the repo root, then clear Vite cache (`node_modules/.vite`) and restart.

---

## Tests

```bash
pnpm test           # unit tests (vitest)
pnpm test:smoke     # smoke tests
```

Unit tests live in `test/unit-tests/`, mirroring `src/`.
