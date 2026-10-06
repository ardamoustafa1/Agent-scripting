---
title: "ADFS / SAML"
---

1. In AD FS Management → Relying Party Trusts → Add Relying Party Trust, create a claims-aware SAML application.

2. Read SP EntityID, ACS and SLO URLs from the Verbis tenant/IdP metadata endpoint documented in OpenAPI; do not guess them.

3. Use EntityID as relying party identifier and ACS as SAML POST endpoint; install the Verbis SP signing certificate.

4. Import issuer/SSO/SLO and current signing certificate from ADFS federation metadata into Verbis SAML config; retain signature/audience checks.

5. Configure claim rules for stable NameID, email, display name and groups/roles; choose Verbis preset adfs and map claims.

6. Try SP-initiated login with a pilot. Keep IdP-initiated login disabled by default; verify InResponseTo, replay, expiry and certificate rollover.

Console fields vary with organizational policy/licensing. Never capture tokens or secrets in screenshots/logs. [Official provider guide](https://learn.microsoft.com/en-us/entra/external-id/direct-federation-adfs).
