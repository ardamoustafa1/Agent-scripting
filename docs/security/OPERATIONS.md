# Güvenlik kurulumu ve doğrulama sınırı

Bu değişiklik testleri ve taramaları **çalıştırmaz**. TypeScript derlemesi güvenlik
sertifikasyonu değildir. [ASVS envanteri](ASVS_CHECKLIST.md) bir release gate'tir;
üretim TLS, IdP, PSP, anahtar saklama, yedekleme ve bağımsız pentest kanıtları ayrıca gerekir.

## CSP ve iframe politikası

Üç web uygulaması Vite `html.cspNonce` ile `__VERBIS_CSP_NONCE__` işaretini üretir.
Production nginx her HTML yanıtında bu işareti 16 rastgele bayttan oluşan `$request_id`
ile değiştirir; HTML `no-store` olur. `script-src` nonce + strict-dynamic, inline event
handler yasağı, Trusted Types ve nonce'lu style etiketi politikası uygulanır.
`browserNonce()` nonce gizleme uygulayan tarayıcılarda `.nonce` özelliğini okur;
Radix style-singleton ve CodeMirror aynı nonce'u kullanır. Sourcemap yayınlanmaz.
Plugin iframe'i ayrı rastgele nonce, opaque origin (`allow-scripts`), ağ erişimi yasağı
ve ayrı CSP kullanır. `verbis-plugin` Trusted Types policy yalnızca SDK'nın kendi
ürettigi dokümanı kabul eder; DOMPurify dışında varsayılan HTML policy yoktur.

Production `API_DOCS=off` kullanılmalıdır. Admin Swagger UI kendi statik hash CSP'sini kullanır; Trusted Types dönüşümü yapılmadan production GUI için uygunluk iddiası yapılmaz. API JSON yanıtlarında Helmet varsayılan inline style istisnası kapalıdır.

TLS ingress / BFF aynı origin'de `/api` ve websocket yollarını API'ye yönlendirmelidir.
Mevcut static nginx `/api/` için 404 döndürür: bu imaj tek başına çalışan BFF değildir.
Nginx'in health endpoint'i edge içindir; API readiness ayrı izlenir.

PSP kullanılırken `infra/docker/frame-sources.conf` dosyası salt okunur bir volume
ile değiştirilir: `set $verbis_frame_sources "'self' https://psp.example.com";`.
Yalnızca doğrulanmış tam HTTPS origin'leri eklenir. Genesys/Cisco/CRM gömme
ortamlarında `frame-ancestors` ilgili tenant'ın onaylı tam origin'leri ile dağıtımda
üretilmelidir; wildcard, `null` veya kullanıcı tarafından sağlanan politika kabul edilmez.
Bu CSP ayarları test ortamında iframe ve SSO smoke testleriyle doğrulanmadan yayın yapılmaz.

## Hosted secure fields / PCI

`PSP_TENANT_PROFILES` operatör tarafından sağlanan JSON dizisidir:

```json
[{"tenantId":"00000000-0000-4000-8000-000000000001","url":"https://psp.example.com/capture","issuer":"https://psp.example.com","jwks":{"keys":[{"kty":"EC","crv":"P-256","x":"PUBLIC_X","y":"PUBLIC_Y","kid":"psp-1"}]}}]
```

Buraya özel anahtar veya kart verisi konmaz. BFF sadece doğrulanmış tenant profilinin
capture URL/origin'ini döndürür. Provider olmayan secure field kapalı kalır; parent DOM'da
PAN/CVV input'u yoktur. Provider ayrı origin'de alanları sunar, tokenizasyonu kendi
servisine doğrudan yapar. Parent yalnızca aşağıdaki mesajı kabul eder:

```json
{"type":"verbis.secure.receipt","challenge":"iframe URL'sindeki challenge","sessionId":"session UUID","variable":"card","receipt":"SIGNED_JWS"}
```

Origin + iframe kaynak penceresi + challenge + session + variable eşleşir; ek alanlar
reddedilir. JWS ES256/EdDSA, sabit audience `verbis-secure-field`, profil issuer'ı,
`tenantId`, `sessionId`, `variable`, `token` (`tok_…`), `iat`, `exp`, `jti` taşır.
Ömür en fazla 120 saniyedir. Redis `SET NX` replay'i reddeder; Redis yoksa kabul edilmez.
Public JWKS uzaktan veya kullanıcının seçtiği URL'den alınmaz. PSP session'ı kendi
kimlik doğrulaması ile bağlamalıdır; URL'deki UUID bir yetkilendirme belgesi değildir.
Bu sözleşme PCI sertifikası sağlamaz; PSP AOC ve kapsam analizi tenant'ın release kanıtıdır.
PCI variable token'ları dahi event/audit/snapshot/analytics payload'ına kopyalanmaz.

## PII saklama ve arama

`RuntimeCipher` 256-bit rastgele DEK, 96-bit rastgele IV, AES-GCM tag ve tenant-bound
wrapped DEK kullanır. V2 envelope tenant KEK'ini HKDF-SHA256 domain separation ile üretir; V1 kayıtlar okunabilir ve sonraki yazımda V2 olur. PostgreSQL snapshot JSON alanı ve Redis runtime cache uygulama
katmanında şifrelenir; kayıt/tenant değiştirildiğinde AAD doğrulaması başarısız olur.
Identity keyring aktif key + geçmiş key'lerle rotasyonu destekler. Operatör üretimde
anahtarları KMS/Vault kaynağından enjekte etmeli, erişim ve rotasyon kanıtı sunmalıdır.
PII/PCI authoring defaults boş olmak zorundadır; plaintext Variable read modeline
hassas default kopyalanmaz. Önceki sürümlerde bulunan PII defaults yayın öncesinde
ayrı envanter/migrasyon ile temizlenmelidir: imzalı geçmiş dokümanlar sessizce değiştirilmez.

Şifreli runtime değişkenleri için eşitlik araması/index endpoint'i yoktur. Mevcut DSAR
arama yetkili, sınırlı decrypt işlemi kullanır. Arama index'i eklenirse raw SHA-256 yeterli
değildir: bağımsız tenant anahtarı ile HMAC-SHA256 blind index, alan/tenant domain
separation, normalize etme ve anahtar rotasyonu zorunludur. Bu sürüm plaintext PII
arama index'i oluşturmaz; blind index desteği uygulanmış olarak işaretlenmez.

## Container ve CI

Node runtime shell/package manager içermeyen distroless Debian 12 / Node 22 nonroot
imajıdır; builder aynı libc tabanındadır. Web nginx UID 101 kullanır. Production workload'a
`infra/kubernetes/security-context.yaml` şablonu uygulanır: read-only rootfs, tüm
capability'ler kapalı, privilege escalation kapalı, RuntimeDefault seccomp ve sınırlı
memory-backed /tmp. Docker'da varsayılan seccomp devrede tutulmalı; `unconfined` yasaktır.
Image digest'leri release sırasında SBOM ile kaydedilip deployment'ta pinlenmelidir.
Şablon otomatik olarak cluster'a uygulanmaz; deployment admission policy ile zorunlu kılınır.

Pre-commit gitleaks yoksa commit'i reddeder; `.env`/private key dosya kontrolü her zaman
çalışır. CI full-history gitleaks, CodeQL, pnpm audit (npm registry advisories), Trivy
filesystem/image (unfixed HIGH/CRITICAL dahil), CycloneDX SBOM ve üç production web
imajına ZAP baseline tanımlar. CI gelecekte çalışacaktır; bu görevde scan raporu üretilmedi.
ZAP yalnızca izole geçici hedefe gider. Kimlik doğrulanmış API DAST/pentest kapsamı
[PENTEST_CHECKLIST.md](PENTEST_CHECKLIST.md) üzerinden ayrıca yürütülür.

İsteğe bağlı komutlar (bu görevde çalıştırılmadı):

```sh
node scripts/test-security.mjs unit
# Production edge'in test URL'si; gerçek müşteri verisi içermemeli:
SECURITY_BASE_URL=https://security-staging.example.com node scripts/test-security.mjs headers
pnpm --filter @verbis/api exec vitest run src/modules/analytics/session.consumer.spec.ts src/modules/runtime/runtime-state.store.spec.ts
pnpm audit --audit-level high
```
