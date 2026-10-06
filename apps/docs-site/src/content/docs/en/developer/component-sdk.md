---
title: "Component SDK"
---

`@verbis/sdk-component` mounts reviewed publisher bundles in a sandbox iframe through a capability
MessagePort. Manifest type/version/integrity and declared props/events/bindings are the contract.
Provide keyboard access, labels, TR/EN and light/dark behavior in the component.

1. Define a zod props schema, public defaults, declared events and bundle manifest.
2. Use connectGuest from `@verbis/sdk-component/guest` in the guest bundle; capabilities are write/emit/resize only.
3. Publish a bundled artifact at a fixed HTTPS origin with correct MIME/CORS/integrity.
4. Authorized admins approve publisher/tenant entitlement; host mounts an exact version/integrity pin.
5. Verify revocation/expiry, hostile props, replay and keyboard/axe acceptance in isolation.

Never send secrets, runtime/store/BFF handles or PCI/PII context to guests. Sandbox is not a CPU
quota; approve reviewed publisher code only. SDK README documents manifest/host/guest types.
