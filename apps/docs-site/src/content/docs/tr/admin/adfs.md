---
title: "ADFS / SAML"
---

1. AD FS Management → Relying Party Trusts → Add Relying Party Trust: claims-aware SAML uygulama oluşturun.

2. Verbis tenant/IdP metadata endpointinden SP EntityID, ACS ve SLO URL’lerini alın; endpointi OpenAPI’den bulun, tahmin etmeyin.

3. EntityID’yi relying party identifier, ACS’yi SAML POST endpoint yapın; Verbis SP signing certificate’ını ekleyin.

4. ADFS federation metadata’daki issuer/SSO/SLO ve güncel signing cert’i Verbis SAML configine aktarın. İmza ve audience kontrollerini koruyun.

5. Claim rules: kararlı NameID, email, display name ve grup/rol claim’leri üretin. Verbis preset adfs ve claim eşlemesini yapılandırın.

6. SP-initiated login’i pilot kullanıcıyla deneyin. IdP-initiated varsayılan kapalı kalsın; InResponseTo, replay, expiry ve cert rollover’ı doğrulayın.

Kurum policy/lisansına göre console alanları değişebilir. Token veya secret değerini ekran görüntüsü/log içinde tutmayın. [Resmi sağlayıcı rehberi](https://learn.microsoft.com/en-us/entra/external-id/direct-federation-adfs).
