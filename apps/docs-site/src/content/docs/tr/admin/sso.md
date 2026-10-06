---
title: "SSO kurulumu"
---

Verbis BFF Authorization Code + PKCE ve SAML 2.0 destekler. Browser access token veya client secret
almaz. Önce HTTPS app originlerini ve `PUBLIC_API_URL`/`AUTH_PUBLIC_PATH_PREFIX` değerlerini kurulumda
belirleyin. OIDC callback çoğu reverse proxy kurulumunda `https://<public-api>/api/auth/oidc/callback`
olur; doğrudan API kullanıyorsanız `/api` eklemeyin. Kendi deployment URL’nizi kaynak alın.

1. [Entra ID](/tr/admin/entra/)
2. [Okta](/tr/admin/okta/)
3. [Keycloak](/tr/admin/keycloak/)
4. [ADFS / SAML](/tr/admin/adfs/)

IdP’yi draft oluşturun, metadata/issuer/CA ve claim’leri inceleyin; connectivity testi sonrası
aktif edin. Grupları en az yetkili role map edin; otomatik tenant_admin atamayın. Kullanıcı devre
dışı bırakıldığında provisioning ve logout/session invalidation davranışını doğrulayın. Giriş sorunu
varsa clock, callback, audience/issuer ve cert rotation kontrol edin; state/nonce/imza kontrolünü kapatmayın.
