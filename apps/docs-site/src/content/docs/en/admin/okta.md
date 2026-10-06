---
title: "Okta"
---

1. Choose Applications → Create App Integration → OIDC / Web Application.

2. Register the exact public `/auth/oidc/callback` deployment URL, including the actual proxy prefix.

3. Use Authorization Code; Verbis supplies PKCE/state/nonce. Keep the client secret in the server Secret store.

4. Copy the exact issuer from your selected org/custom authorization server and configure vendor okta, clientId and clientSecretRef.

5. Configure openid/profile/email, the required groups claim filter and pilot group assignment.

6. Verify the draft connection, role mapping and logout. Configure SCIM separately with its scoped bearer credential.

Console fields vary with organizational policy/licensing. Never capture tokens or secrets in screenshots/logs. [Official provider guide](https://developer.okta.com/docs/guides/sign-into-web-app-redirect/node-express/main/).
