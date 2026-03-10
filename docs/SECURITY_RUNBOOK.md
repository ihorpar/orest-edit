# Security Runbook (In-App Password)

## Goal

Keep the app private for editors and client reviewers with one simple password gate.

## Baseline policy

- primary access control: in-app password via `APP_PASSWORD`
- login page: `/login`
- protected paths: `/editor`, `/settings`, `/api/*` (except `/api/auth/login`)
- session: httpOnly signed cookie
- production safety: if `APP_PASSWORD` is missing, protected pages remain unavailable until it is set
- password rotation: event-based only (no scheduled rotation)
- optional hardening: Vercel Authentication and one WAF rate-limit rule on `/api/edit/*`

## Setup checklist (dashboard)

1. Open Vercel project settings for this app.
2. Add environment variable `APP_PASSWORD` with a strong value.
3. Redeploy.
4. Optional hardening:
   - enable Deployment Protection (`Vercel Authentication`)
   - add one WAF rate-limit rule where path starts with `/api/edit/`

## Optional CI/E2E usage (only with Vercel Deployment Protection)

If you additionally enable Vercel Deployment Protection, automation that must call protected deployments should include:

- header: `x-vercel-protection-bypass`
- value: the bypass secret from CI secrets

Never commit secrets to the repository.

## Verification checklist

1. Open the app in incognito.
2. Request to `/editor` redirects to `/login`.
3. Wrong password keeps user on `/login` with error.
4. Correct password opens `/editor`.
5. Anonymous request to `/api/edit/patch` returns `401`.
6. Optional: if WAF is enabled, burst calls to `/api/edit/*` are rate-limited.

## Emergency response

Use this flow on suspected password exposure:

1. Change `APP_PASSWORD` in Vercel.
2. Redeploy.
3. Verify old password no longer works.
4. Verify new password works.
5. If Deployment Protection is enabled, rotate bypass secret too.

## Documentation links

- https://vercel.com/docs/deployment-protection
- https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication
- https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation
- https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting
