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

## Generic Node hosting

Recommended flow:
1. Install dependencies with `npm ci`.
2. Build with `npm run build`.
3. Start with `npm run start`.
4. Let the platform inject `PORT`.

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