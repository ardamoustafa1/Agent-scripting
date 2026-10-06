---
title: "Keycloak"
---

1. İzole realm oluşturun; Clients → Create client → OpenID Connect, client ID verbis-web seçin.

2. Client authentication ve Standard flow açık olsun. Implicit flow ve Direct access grants’i bu BFF akışı için kullanmayın.

3. Valid redirect URIs’ye deployment callback’ini tam yazın; Web Origins’e yalnız onaylı app originlerini ekleyin.

4. Issuer `https://<keycloak>/realms/<realm>`; credentials secret’ını server’da saklayın. Verbis vendor keycloak, clientId ve clientSecretRef’i doldurun.

5. Groups mapper ve pilot kullanıcıları oluşturun; email doğrulamasını IdP’de tamamlayın. Verbis’te groups→script_designer/agent eşlemesi yapın.

6. Login, role change ve back-channel logout’u kontrol edin. Demo için keycloak realm import’unu kullanabilirsiniz; production’da demo kullanıcılarını taşımayın.

Kurum policy/lisansına göre console alanları değişebilir. Token veya secret değerini ekran görüntüsü/log içinde tutmayın. [Resmi sağlayıcı rehberi](https://www.keycloak.org/docs/latest/server_admin/index.html).
