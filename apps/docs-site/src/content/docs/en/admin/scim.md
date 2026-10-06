---
title: "SCIM provisioning"
---

1. Generate a tenant-scoped SCIM bearer credential through authorized administration; store it only in the provisioning system.
2. Base URL is `/scim/v2/<tenant-slug>` with the deployment’s proxy prefix. OpenAPI lists Users/Groups operations.
3. Configure externalId/userName/email/group mapping and least-privilege group roles rather than blanket defaults.
4. Verify create, update, PATCH, disable and membership removal with a small pilot group.
5. Check login/session invalidation and audit after active=false; schedule token rotation.

SCIM creates user rows, not simulator mappings or CTI participation proofs. Never give the bearer to
agent browser code. Demo seed creates no automatic password or SCIM credential.
