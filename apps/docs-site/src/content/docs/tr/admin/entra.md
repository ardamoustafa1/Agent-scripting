---
title: "Microsoft Entra ID"
---

1. Entra admin center → App registrations → New registration: tenantınıza ait single-tenant uygulama oluşturun.

2. Authentication → Web platform: deployment’ın tam OIDC callback URL’sini kaydedin. Wildcard/SPA implicit flow kullanmayın.

3. Application/client ID ve directory tenant ID’yi alın. Issuer `https://login.microsoftonline.com/<tenant-id>/v2.0` olsun.

4. Bu Verbis sürümünün desteklediği confidential client secret’ı yalnız Secret store’a koyun ve `clientSecretRef` ile bağlayın. Süre dolumu/rotation planlayın.

5. Verbis OIDC preset’inde vendor entra, issuer, clientId ve scopes openid/profile/email ayarlayın. Gerekli groups/app-role claim’lerini ekleyin.

6. Pilot kullanıcı atayın. Grup→rol eşlemesini inceleyin; verified email claim’i gelmiyorsa subject tabanlı provisioning kullanın, email linking kontrolünü gevşetmeyin.

Kurum policy/lisansına göre console alanları değişebilir. Token veya secret değerini ekran görüntüsü/log içinde tutmayın. [Resmi sağlayıcı rehberi](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri).
