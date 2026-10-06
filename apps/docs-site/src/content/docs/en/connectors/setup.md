---
title: "Common connector setup"
---

## Secure connection contract

Every connector implements server-side normalization, fresh participation verification, declared
capabilities and idempotent commands. Marketplace adapters do not automatically supply vendor SDKs;
licensed/authenticated server facades belong to the tenant integration. Browser code receives no
NATS credentials, server SDK entrypoint or Secret values. Use the browser-safe `/launch` export.

1. Choose adapter/kind, Secret references and attribute allowlists.
2. Configure three-node JetStream with R3 streams/consumers and connector-scoped subject/inbox ACLs.
3. Bind server-port readAttributes, execute and verifyParticipant to native APIs.
4. Validate/normalize events, publish stable eventId, then ACK the source only after durable ACK.
5. Configure external routing, agent identity, wrap-up mapping and approved origins.
6. Secure launch needs single-use code, BFF cookie/CSRF, assignment and fresh server verification. Script ID query parameters grant no permission.

- [Genesys Cloud](/en/connectors/genesys-cloud/)
- [Genesys Engage](/en/connectors/genesys-engage/)
- [Avaya AES](/en/connectors/avaya-aes/)
- [Avaya AXP](/en/connectors/avaya-axp/)
- [Avaya AACC](/en/connectors/avaya-aacc/)
- [Amazon Connect](/en/connectors/amazon-connect/)
- [Cisco Webex Contact Center](/en/connectors/cisco-webex/)
- [Cisco UCCE/PCCE Finesse](/en/connectors/cisco-finesse/)
- [NICE CXone](/en/connectors/nice-cxone/)
- [Five9](/en/connectors/five9/)
- [Salesforce Open CTI](/en/connectors/salesforce/)
- [Dynamics 365 CIF](/en/connectors/dynamics-365/)
