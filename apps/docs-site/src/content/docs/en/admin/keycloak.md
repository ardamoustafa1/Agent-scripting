---
title: "Keycloak"
---

1. Create an isolated realm; choose Clients → Create client → OpenID Connect with client ID verbis-web.

2. Enable client authentication and Standard flow. Do not use implicit flow or Direct access grants for this BFF flow.

3. Set the exact deployment callback under Valid redirect URIs; add only approved app origins to Web Origins.

4. Use issuer `https://<keycloak>/realms/<realm>`, store the credential server-side and configure vendor keycloak/clientId/clientSecretRef.

5. Configure a groups mapper and pilot users; verify emails in the IdP. Map groups to script_designer/agent in Verbis.

6. Verify login, role changes and back-channel logout. Demo can use the realm import; do not copy demo users to production.

Console fields vary with organizational policy/licensing. Never capture tokens or secrets in screenshots/logs. [Official provider guide](https://www.keycloak.org/docs/latest/server_admin/index.html).
