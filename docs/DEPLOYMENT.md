# Deployment

## Runtime model

This repository is a Next.js workspace app.

Production entrypoints:
- build: `npm run build`
- start: `npm run start`

The root scripts delegate to `apps/web`, so a platform can build and start from the repo root without custom workspace commands.

## Port behavior

There is no hardcoded runtime port in the application code or Next config.

Expected behavior:
- production: listen on the platform-provided `PORT`
- local default: `3000`
- local fallback: if `3000` is busy, Next may auto-select `3001`

That `3001` behavior is only a local development fallback. It is not a second deployment port and should not be treated as part of the production contract.

## Environment variables

Provider keys are optional unless that provider is used.

Supported server-side keys:
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `ANTHROPIC_API_KEY`

Local developer behavior:
- if the settings form leaves the API key blank, the server checks process env first
- for local workspace runs, the server also reads the repo-root `.env` and `.env.local`

## Vercel deployment (recommended)

Use this path for the least-friction Next.js deployment.

Project setup:
1. Import the repository in Vercel.
2. For monorepo detection, set the project root to `apps/web` (or keep repo root and use existing root scripts).
3. Set production environment variables:
   - `OPENAI_API_KEY`
   - `GEMINI_API_KEY`
   - `ANTHROPIC_API_KEY`
4. Configure deployment protection in Vercel:
   - protection method: `Vercel Authentication`
   - protection scope: `All Deployments` when available; otherwise `Standard Protection`
5. If CI/E2E/monitoring must reach protected deployments, create one automation bypass secret and send it in `x-vercel-protection-bypass`.
6. Add one Vercel WAF rate-limit rule for paths that start with `/api/edit/`.
7. Deploy.

Runtime behavior prepared in this repo:
- all AI API routes are pinned to `runtime = "nodejs"`
- all AI API routes export `maxDuration = 60`
- image generation upstream timeout is capped below route duration so requests fail gracefully instead of hitting hard platform timeout

Configured API routes:
- `apps/web/app/api/edit/patch/route.ts`
- `apps/web/app/api/edit/review/route.ts`
- `apps/web/app/api/edit/review/proposal/route.ts`
- `apps/web/app/api/edit/review/image/route.ts`
- `apps/web/app/api/settings/validate/route.ts`

Review-image route behavior:
- `POST /api/edit/review/image` supports async enqueue (`async: true`) and returns `202` with a job id
- `GET /api/edit/review/image?jobId=...` returns queue status and final asset/error (`Cache-Control: no-store`)

If your Vercel project uses a different function mode/limit profile, increase route `maxDuration` and keep upstream provider timeouts slightly lower than that value.

## Vercel security operations

The security boundary for this app is Vercel edge protection, not in-app login screens.

Operational defaults:
- no app-level password flow
- no periodic bypass-secret rotation
- rotate bypass secret only on events: leak suspicion, offboarding, or accidental disclosure

For dashboard paths, verification checks, and emergency response, use `docs/SECURITY_RUNBOOK.md`.

## Generic Node hosting

Recommended flow:
1. Install dependencies with `npm ci`.
2. Run `npm run check:text` to verify UTF-8 and LF text integrity.
3. Build with `npm run build`.
4. Start with `npm run start`.
5. Let the platform inject `PORT`.
For container-style deployments, it is also reasonable to expose `HOSTNAME=0.0.0.0` if the platform expects binding on all interfaces.

## Current repo status

Deployment-related config present now:
- root workspace scripts in `package.json`
- app runtime scripts in `apps/web/package.json`
- basic Next config in `apps/web/next.config.ts`

Deployment-related config not present now:
- no `vercel.json`
- no `Dockerfile`
- no `Procfile`
- no `railway.json`
- no `render.yaml`

That means the current deployment contract is intentionally simple: standard Next build/start plus environment variables.

## Operational note

If you ever see local servers on both `3000` and `3001`, that usually means multiple Next processes were started at different times. It does not mean the repository is configured for dual-port runtime.
