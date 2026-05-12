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
- `APP_PASSWORD` (enables in-app password gate for `/editor`, `/settings`, and API routes)

Local developer behavior:
- provider keys are resolved server-side from environment values
- for local workspace runs, the server also reads the repo-root `.env` and `.env.local`
- if `APP_PASSWORD` is missing in development, password auth is bypassed; in production, missing `APP_PASSWORD` keeps protected pages unavailable

## Vercel deployment (recommended)

Use this path for the least-friction Next.js deployment.

Project setup:
1. Import the repository in Vercel.
2. For monorepo detection, set the project root to `apps/web` (or keep repo root and use existing root scripts).
3. Set production environment variables:
   - `OPENAI_API_KEY`
   - `GEMINI_API_KEY`
   - `ANTHROPIC_API_KEY`
   - `APP_PASSWORD`
4. (Optional hardening) configure Deployment Protection in Vercel:
   - protection method: `Vercel Authentication`
   - protection scope: `All Deployments` when available; otherwise `Standard Protection`
5. (Optional hardening) add one Vercel WAF rate-limit rule for paths that start with `/api/edit/`.
6. Deploy.

### Git-trigger fallback: GitHub Actions + Vercel CLI

If Vercel Git auto-deploy events are unreliable for this project, use repo-native CI deployment from `.github/workflows/vercel-production-deploy.yml`.

Behavior:
- triggers on every push to `master` (and manual `workflow_dispatch`)
- builds via `vercel build --prod`
- promotes with `vercel deploy --prebuilt --prod`
- does not depend on Vercel GitHub webhook ingestion for push events

Required GitHub repository secrets:
- `VERCEL_TOKEN` (Personal Access Token with deploy permission)
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID` (for this project: `prj_VYVONvIZgC6Pl3uTgotG2btP4hPv`)

Operational note:
- Vercel Deploy Hooks still require correct branch names (`master` in this repo, not `main`) and rely on Vercel-side git provider linkage.
- The CLI workflow above is the preferred fallback when Deploy Hook calls return git-linkage errors.

Runtime behavior prepared in this repo:
- all AI API routes are pinned to `runtime = "nodejs"`
- `/api/edit/review` exports `maxDuration = 300` for long workflow review jobs
- `/api/edit/review/proposal` exports `maxDuration = 120`
- `/api/edit/patch` and `/api/edit/review/image` export `maxDuration = 60`
- smaller utility routes keep shorter limits where appropriate
- image generation and review upstream timeouts are capped below route duration so requests fail gracefully instead of hitting hard platform timeout

Configured API routes:
- `apps/web/app/api/edit/patch/route.ts`
- `apps/web/app/api/edit/review/route.ts`
- `apps/web/app/api/edit/review/proposal/route.ts`
- `apps/web/app/api/edit/review/image/route.ts`
- `apps/web/app/api/settings/validate/route.ts`
- `apps/web/app/api/auth/login/route.ts`
- `apps/web/app/api/auth/logout/route.ts`

Review-image route behavior:
- `POST /api/edit/review/image` supports async enqueue (`async: true`) and returns `202` with a job id
- `GET /api/edit/review/image?jobId=...` returns queue status and final asset/error (`Cache-Control: no-store`)

Review route behavior:
- `POST /api/edit/review` starts an in-memory async job by default and returns `202` with a job id
- `GET /api/edit/review?jobId=...` returns queue status and the final review payload/error (`Cache-Control: no-store`)
- `POST /api/edit/review` with `async: false` keeps the direct synchronous path for debugging and tests
- the in-memory job queue is a lightweight v1 and can be lost if Vercel recycles the function instance; rerun the review step if a job expires or cannot be found

If your Vercel project uses a different function mode/limit profile, increase route `maxDuration` and keep upstream provider timeouts slightly lower than that value.

## Vercel security operations

The default security boundary for this app is the in-app password gate.

Operational defaults:
- set `APP_PASSWORD` in production
- no periodic password rotation requirement
- rotate password on events: leak suspicion, offboarding, or accidental disclosure
- optional second layer: Vercel Deployment Protection

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
