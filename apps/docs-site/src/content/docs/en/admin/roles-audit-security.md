---
title: "Roles, audit and security"
---

System roles include tenant_admin, security_auditor, script_designer, script_approver,
integration_engineer, campaign_manager, supervisor, agent and report_viewer. super_admin is platform-scoped.
Apply campaign/team/site scope and retain separation of duties/self-approval protections.

Filter audit by UTC date, action, actor, outcome and correlation ID. Verify the chain for the relevant
range; failed verification is an alarm, never fixed by deleting records. Audit exports/sensitive reads
are recorded. Preserve old verification public keys during rotation.

Configure exact HTTPS app/frame origins, secure cookies, CSRF, short-lived launch grants, mTLS service
clients, Secret store, SSRF allow-lists, PII/PAN classification and retention/legal holds. Simulator is
disabled in production. Break-glass needs MFA/TOTP and a separate authorized procedure; demo seed does not enable it.
