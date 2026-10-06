---
title: "Okta"
---

1. Applications → Create App Integration → OIDC / Web Application seçin.

2. Sign-in redirect URI’ye deployment’ın tam `/auth/oidc/callback` public URL’sini yazın; proxy önekini doğru ekleyin.

3. Authorization Code grant’i kullanın; Verbis PKCE/state/nonce üretir. Client secret yalnız server Secret store’da durur.

4. Okta issuer’ı seçtiğiniz org/custom authorization server’dan aynen alın; clientId ve clientSecretRef ile vendor okta preset’ini doldurun.

5. openid/profile/email ve gereken groups claim filtresini ayarlayın; pilot grubu uygulamaya atayın.

6. Draft testi, role mapping ve logout’u doğrulayın. SCIM provisioning’i ayrı bearer yetkisiyle kurun.

Kurum policy/lisansına göre console alanları değişebilir. Token veya secret değerini ekran görüntüsü/log içinde tutmayın. [Resmi sağlayıcı rehberi](https://developer.okta.com/docs/guides/sign-into-web-app-redirect/node-express/main/).
