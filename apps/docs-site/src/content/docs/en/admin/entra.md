---
title: "Microsoft Entra ID"
---

1. In Entra admin center → App registrations → New registration, create a single-tenant app.

2. Under Authentication → Web, register the exact deployment OIDC callback. Avoid wildcard redirects and SPA implicit flow.

3. Record application/client ID and directory tenant ID; use issuer `https://login.microsoftonline.com/<tenant-id>/v2.0`.

4. This Verbis version supports confidential client secrets: store one only in the Secret store, bind `clientSecretRef`, and schedule expiry/rotation.

5. Use Verbis vendor entra with issuer/clientId and openid/profile/email scopes; configure needed groups/app-role claims.

6. Assign a pilot user and review group→role mapping. If verified email is unavailable, use subject-based provisioning rather than weakening email-linking checks.

Console fields vary with organizational policy/licensing. Never capture tokens or secrets in screenshots/logs. [Official provider guide](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri).
