# Development

## Layout

| Path | What |
| --- | --- |
| `src/` | Extension (Manifest V3, TypeScript): `content/` reads Wolt pages, `popup/`, `options/`, `background/` (sign-in) |
| `tests/` | Extension unit tests (vitest) with Wolt page text fixtures |
| `scripts/` | `build.ts` (esbuild → `dist/`), `package.ps1` (zip → `artifacts/`) |
| `worker/` | Cloudflare Worker `auth-research`: completes the Splitwise OAuth flow so the consumer secret never ships in the extension |

pnpm workspace: the root package is the extension, `worker/` is a separate package.

## Setup

Requirements: Node 22, pnpm (`corepack enable`), PowerShell 7, Edge.

Restore your development key to `keys/extension-key.pem` before building locally (see *Extension ID* below).

```pwsh
pnpm install
pnpm build:dev        # or: pnpm watch
```

Load `dist/` with **Load unpacked** in `edge://extensions`, or press **F5** in VS Code (*Run Edge extension (Debug profile)*), which builds first.

Optional `.env` in the repo root (dev builds only): `SplitWiseGroupId=<id>` preselects the default group.

Checks:

```pwsh
pnpm typecheck; pnpm test          # extension
pnpm worker:test                   # worker
```

## Extension ID

The tracked `src/manifest.json` has no `key`. Local `pnpm build:dev` and `pnpm watch` derive its public value from `keys/extension-key.pem` and inject it into `dist/manifest.json`, preserving the development ID `obkgbdhgmlhjlkldcdhcmmdgbpapmpdk`. The entire `keys/` folder is git-ignored; keep a backup of the PEM and restore it on a new machine. Local dev builds fail with a clear error if it is missing. The private key is never bundled.

Production (`pnpm build`) and CI builds omit the key and need no local key files. Local dev versions include the build time (`0.1.0.HHmm`, display name `YYYY-MM-DD HH:mm`); production and CI use the package version.

Without a manifest key, unpacked builds have a path-derived ID and store installs have a store-assigned ID. Sign-in only works for IDs listed in `EXTENSION_IDS` in `worker/wrangler.jsonc` (comma-separated): the local development ID plus the Chrome and Edge store listings. When you publish to another store or replace a key, add the new ID there and redeploy the worker.

## Sign-in service (Cloudflare Worker)

Flow: extension → `GET /auth/start?state=…&ext=<extension-id>` (the worker rejects IDs not in `EXTENSION_IDS` and carries the ID in the OAuth `state`) → Splitwise consent → `GET /auth/callback` → `https://<extension-id>.chromiumapp.org/?code=…` for that same extension → extension `POST /auth/token` (its `Origin` must be an allowed ID) → worker adds the secret and returns the access token.

Configuration:

| What | Where |
| --- | --- |
| `EXTENSION_IDS` (allowed extension IDs, comma-separated) | `worker/wrangler.jsonc` |
| `CLOUDFLARE_ACCOUNT_ID`, `SPLITWISE_CONSUMER_KEY` (public client id) | GitHub environment variables (see *Deploy*); locally as environment variables |
| `SplitwiseConsumerSecret` | Cloudflare secret: `pnpm --dir worker exec wrangler secret put SplitwiseConsumerSecret` |
| Callback URL `https://auth-research.splitwise-extensions.workers.dev/auth/callback` | Splitwise app settings at [secure.splitwise.com/apps](https://secure.splitwise.com/apps). Splitwise always uses this registered URL. |
| Worker URL in the extension | `src/shared/constants.ts` and `host_permissions` in `src/manifest.json` |

After changing `wrangler.jsonc`, regenerate types with `pnpm --dir worker run types`. For `wrangler dev`, put `SplitwiseConsumerKey` and `SplitwiseConsumerSecret` in `worker/.dev.vars` (git-ignored).

## Deploy

**Worker, manually:** run `pnpm --dir worker exec wrangler login` once, then:

```pwsh
$env:CLOUDFLARE_ACCOUNT_ID = '<account id>'
pnpm worker:deploy   # keeps the SplitwiseConsumerKey already set on Cloudflare (keep_vars)
```

**Worker, from GitHub Actions:** every push to `main` deploys after the build job passes (`deploy-worker` job). One-time setup:

1. In the Cloudflare dashboard, go to **My Profile → API Tokens → Create Token**, use the **Edit Cloudflare Workers** template, and limit *Account Resources* to the *Splitwise Extensions* account.
2. In GitHub, go to **Settings → Environments → New environment** `cloudflare-worker`. Optionally add required reviewers or restrict it to `main`.
3. In that environment, add:
   - secret `CLOUDFLARE_API_TOKEN`: the token from step 1
   - variable `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account id (dashboard → *Workers & Pages* → *Account details*)
   - variable `SPLITWISE_CONSUMER_KEY`: the consumer key of the Splitwise app

`SplitwiseConsumerSecret` stays in Cloudflare; deploys keep existing secrets.

**Extension release:** bump `version` in `package.json`, then push a tag `v<version>`. The workflow builds, tests and attaches the zip to a GitHub release. Every build also uploads the zip as a workflow artifact.
