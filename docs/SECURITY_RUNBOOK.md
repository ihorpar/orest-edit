# Security Runbook (Vercel Edge-First)

## Goal

Keep the app private for internal editors with minimal maintenance and no in-app auth layer.

## Baseline policy

- primary access control: Vercel Deployment Protection with `Vercel Authentication`
- preferred scope: `All Deployments`
- fallback scope when plan-limited: `Standard Protection` (track the custom-domain gap)
- automation bypass: enabled only if CI/E2E/monitoring needs it
- bypass secret rotation: event-based only (no scheduled rotation)
- abuse guard: one Vercel WAF rate-limit rule for `/api/edit/*`

## Setup checklist (dashboard)

1. Open Vercel project settings for this app.
2. Deployment Protection:
   - method: `Vercel Authentication`
   - scope:
     - use `All Deployments` when available
     - otherwise use `Standard Protection`
3. Protection Bypass for Automation (optional):
   - create one bypass secret
   - store it only in CI/automation secrets
   - do not expose it to browser/client code
4. Vercel WAF:
   - add a rate-limit rule
   - condition: path starts with `/api/edit/`
   - start with conservative fixed-window limits, then tune from real traffic

## CI/E2E usage

Automation that must call protected deployments should include:

- header: `x-vercel-protection-bypass`
- value: the bypass secret from CI secrets

Never commit the bypass secret to the repository.

## Verification checklist

1. Anonymous browser request to `/editor` is blocked by Deployment Protection.
2. Anonymous API request to `/api/edit/patch` is blocked.
3. Authenticated Vercel team member can load `/editor` and use `/api/edit/*`.
4. Automation request without bypass header is blocked.
5. Automation request with bypass header succeeds.
6. Burst calls to `/api/edit/*` trigger WAF rate limiting.

## Emergency response

Use this flow on suspected bypass secret exposure:

1. Revoke/delete the existing bypass secret in Vercel.
2. Create a new bypass secret.
3. Update CI/monitoring secrets.
4. Re-run protected-deployment automation checks.
5. Confirm anonymous access is still blocked.

## Documentation links

- https://vercel.com/docs/deployment-protection
- https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication
- https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation
- https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting
