---
title: "Connector ortak kurulumu"
---

## Güvenli bağlantı sözleşmesi

Her connector server-side event normalization, güncel katılımcı doğrulama, declared capability ve
idempotent command sözleşmesini uygular. Marketplace connector’lar vendor SDK’sını otomatik sağlamaz;
lisanslı/server auth facade tenant entegrasyonudur. Browser NATS credentials, SDK server entrypoint
veya Secret store değerlerini almaz. Browser-safe `/launch` exportunu kullanın.

1. Adapter/kind seçin; Secret referansları ve attribute allow-listini tanımlayın.
2. NATS JetStream’i üç node ve R3 stream/consumer ile kurun; connector’a yalnız kendi subjects/inbox ACL’lerini verin.
3. SDK server port’unda readAttributes, execute ve verifyParticipant’ı native API’ya bağlayın.
4. Native event’i validate/normalize edin, stable eventId ile publish edin ve ancak durable ACK sonrası source’u ACK edin.
5. Queue/skill/campaign external mapping, agent identity, wrap-up mapping ve origin policy yapılandırın.
6. Secure launch tek kullanımlık kod, BFF cookie/CSRF, assignment ve fresh server verifier ister. Script ID query parametresi yetki vermez.

- [Genesys Cloud](/tr/connectors/genesys-cloud/)
- [Genesys Engage](/tr/connectors/genesys-engage/)
- [Avaya AES](/tr/connectors/avaya-aes/)
- [Avaya AXP](/tr/connectors/avaya-axp/)
- [Avaya AACC](/tr/connectors/avaya-aacc/)
- [Amazon Connect](/tr/connectors/amazon-connect/)
- [Cisco Webex Contact Center](/tr/connectors/cisco-webex/)
- [Cisco UCCE/PCCE Finesse](/tr/connectors/cisco-finesse/)
- [NICE CXone](/tr/connectors/nice-cxone/)
- [Five9](/tr/connectors/five9/)
- [Salesforce Open CTI](/tr/connectors/salesforce/)
- [Dynamics 365 CIF](/tr/connectors/dynamics-365/)
