---
title: "SCIM provisioning"
---

1. Tenant için SCIM bearer credential’ını yetkili admin akışından üretin; değeri yalnız provisioning sisteminde saklayın.
2. Base URL deployment proxy önekiyle `/scim/v2/<tenant-slug>` olur. Users ve Groups endpointleri OpenAPI’de listelenir.
3. ExternalId/userName/email/group mapping’i seçin; default role yerine group→least-privilege role eşlemesi kurun.
4. Küçük pilot grubunda create, update, PATCH, disable ve group membership removal işlemlerini doğrulayın.
5. active=false sonrası login/session erişimini ve audit’i kontrol edin; token rotation planlayın.

SCIM kullanıcı satırı oluşturur; simulator agent eşlemesi veya CTI katılımcı doğrulaması sağlamaz.
SCIM bearer’ı agent browserına vermeyin. İlk seed kullanıcısına otomatik parola veya SCIM token oluşturulmaz.
