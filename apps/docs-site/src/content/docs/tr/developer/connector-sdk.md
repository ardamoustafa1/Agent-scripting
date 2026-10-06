---
title: "Connector SDK"
---

Server-only `@verbis/sdk-connector` Connector interface’ini uygulayın: lifecycle, events, verifyParticipant,
capabilities ve supported commands. Browser yalnız `@verbis/sdk-connector/launch` kullanır.

Native payload’ı vendor sürümüne göre validate edin; mapper ile normalized InteractionEvent üretin.
Event ID tekrar denemede sabit, occurredAt gerçek platform zamanı olsun. Güncel katılımı server SDK’sından
teyit edin; browser hints ve CRM record ownership kanıt değildir. Source ACK yalnız JetStream ACK sonrası.
SecretRef çözümü, reconnect/backoff, command idempotency/durable journal ve tenant scoped ACL kurun.

Ortak contract kit’te connect/disconnect, event normalization, write-back, transfer/end ve stale assignment
senaryolarını yazın. İlan etmediğiniz recording/wrap-up özelliğini UI’da açmayın. Testleri çalıştırma komutları
repository TESTING.md’dedir; bu rehberde başarı iddiası yoktur.
