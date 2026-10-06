---
title: "SSO setup"
---

The Verbis BFF supports Authorization Code + PKCE and SAML 2.0. Browser code receives no access
tokens or client secrets. Configure HTTPS app origins and `PUBLIC_API_URL`/`AUTH_PUBLIC_PATH_PREFIX`
first. A typical proxy callback is `https://<public-api>/api/auth/oidc/callback`; direct API routing
has no `/api` prefix. Derive the exact URL from your deployment.

1. [Entra ID](/en/admin/entra/)
2. [Okta](/en/admin/okta/)
3. [Keycloak](/en/admin/keycloak/)
4. [ADFS / SAML](/en/admin/adfs/)

Create a draft IdP, review issuer/metadata/CA and claims, run its connectivity check then activate.
Map groups to least-privilege roles; never grant tenant_admin by default. Verify deprovisioning and
logout/session invalidation. Troubleshoot clock, callback, audience/issuer and certificate rotation;
never disable state, nonce or signature validation.
