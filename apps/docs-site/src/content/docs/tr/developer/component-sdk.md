---
title: "Component SDK"
---

`@verbis/sdk-component` trusted publisher bundle’ını host içinde çalıştırmaz; capability MessagePort
ile sandbox iframe’e mount eder. Manifest type/version/integrity ve izin verilen props/events/bindings
kaynak sözleşmesidir. Erişilebilir keyboard, label, TR/EN ve light/dark davranışını komponentte sağlayın.

1. zod props schema, public defaults, declared events ve bundle manifest yazın.
2. Guest bundle’da `@verbis/sdk-component/guest` içinden connectGuest kullanın; write/emit/resize dışında host yetkisi yoktur.
3. Bundle’ı sabit HTTPS origin, doğru MIME/CORS ve integrity ile dağıtın; bağımlılıkları içine bundle edin.
4. Yetkili admin publisher/tenant approval ve entitlement’ı açsın; host exact version + integrity pin’iyle mount etsin.
5. Revocation/expiry, malicious props, replay ve keyboard/axe kabulünü izole ortamda doğrulayın.

Secrets, runtime/store/BFF handle veya PCI/PII variable context’ini guest’e vermeyin. Sandbox CPU quota
sağlamaz; yalnız incelenmiş publisher kodunu kabul edin. Manifest/host/guest type referansı SDK README’dedir.
