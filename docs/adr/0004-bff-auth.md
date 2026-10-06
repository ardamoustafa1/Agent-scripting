# ADR-0004: BFF authentication pattern; no tokens in the browser

- **Status:** Accepted · 2026-10-01
- **Related:** [SECURITY §4–5](../SECURITY.md), [ARCHITECTURE](../ARCHITECTURE.md)

## Context
Verbis must support OIDC and SAML 2.0 with multiple IdPs per tenant, SCIM provisioning, and strong XSS/token-theft resistance. Agent desktops often run inside CTI client iframes.

## Decision
- The **api-gateway/BFF** terminates all IdP protocols (`openid-client` for OIDC with Authorization Code + PKCE; `@node-saml/node-saml` for SAML 2.0).
- IdP tokens/assertions are validated and kept **server-side** (encrypted in Redis). The browser receives only an opaque session id in a `__Host-` **httpOnly, Secure, SameSite** cookie. **No access/refresh/ID tokens in JS-accessible storage.**
- CSRF: per-session token header + Origin/Sec-Fetch-Site checks.
- Internal calls use short-lived, audience-bound signed JWTs (mTLS in cluster).
- Tenant resolved from host (subdomain/custom domain); IdP selected by tenant config and home-realm hints.
- Embedded mode: partitioned cookies (CHIPS) with top-level-popup fallback for third-party cookie restrictions.
- Back-channel/front-channel logout and SCIM deactivation revoke server sessions immediately.
- Secure launch (a distinct mechanism) uses its own single-use token, redeemed over this authenticated session ([SECURITY §4](../SECURITY.md)).

## Consequences
- (+) Token theft via XSS is eliminated; centralized session control and revocation.
- (−) BFF is on the critical path and stateful (Redis); needs HA and sticky-free design.
- (−) Third-party-cookie behavior in iframes needs per-browser testing.

## Alternatives
- SPA with tokens in memory/localStorage: exposed to XSS. Rejected.
- Direct IdP JWT validation in each service: complicates SAML and revocation.
