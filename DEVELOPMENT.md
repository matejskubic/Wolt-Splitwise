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

The `key` in `src/manifest.json` fixes the extension ID to `obkgbdhgmlhjlkldcdhcmmdgbpapmpdk`. The private key is `keys/extension-key.pem` (git-ignored, keep a backup). If the key changes, update `EXTENSION_ID` in `worker/wrangler.jsonc` and redeploy the worker.

## Sign-in service (Cloudflare Worker)

Flow: extension → `GET /auth/start` → Splitwise consent → `GET /auth/callback` → `https://<extension-id>.chromiumapp.org/?code=…` → extension `POST /auth/token` → worker adds the secret and returns the access token.

Configuration:

| What | Where |
| --- | --- |
| `EXTENSION_ID` | `worker/wrangler.jsonc` |
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
