# CTI eşleme ve Agent hata yönetimi — 2026-10-06

Kapsam: AUDIT_REPORT.md M-Z1, M-Z2, U-07, M-Z4, M-Z7, U-09, U-10, M-16, U-11, P-01.

## Sonuç

- Tek `CtiIdentitySchema`/`CtiIdentitiesSchema`, admin ve SCIM girişinde ve resolver/verifier'da kullanılır. `{platform, platformUserId}` eski giriş/kayıtları okunur; yazılan biçim `{platform, id}` olur. Platform adı trim/lowercase ve boşluk/alt çizgi/tire normalizasyonundan geçer. Gerçek SQL sorgusu aynı normalizasyonu uygular; duplicate ve belirsiz eşleşmeler kapalı kalır. Diğer platform eşlemeleri korunur.
- Önce gerçek admin PUT → simülatör → mTLS → launch intent → redeem/browser regresyonu eklendi ve başarısızlığı gözlendi (`cti-before.log`: beklenen intent 1, bulunan 0). İlk düzeltme sonrası ve son kaynakta üç motor geçti. Firefox, kayıtlı CTI ID'sinden farklı platform ID'sini e-posta üzerinden eşler. Verifier, sunucunun eşlediği olay kimliğini şifreli interaction kaydından alır ve hub'ın güncel katılımcı doğrulamasına gönderir; doğrulama gevşetilmedi.
- Aynı agent/kanal kapasitesini aşmak `409 VERBIS_CONNECTOR_CONCURRENCY_LIMIT`, correlationId ve dolu errors[] döndürür. Diğer hub 4xx yanıtları kataloglu erişim/rate-limit/payload hatalarına çevrilir; rastgele upstream detayları gösterilmez. Admin kapasite mesajı TR/EN açıklayıcıdır.
- Session load/action hataları script/yetki/ağ/depolama olarak sınıflanır. Destek kodu kopyalanabilir; sahibi olduğu oturum için yalnız kategori/kod içeren audit bildirimi gönderilir. Push launch redeem reddi de görünürdür. Hata ekranı focusable skip-link hedefi ve h1 içerir.
- `policy.onFailure: block | continue | manual` Agent recovery politikasını belirler (eksikse block). Yeniden deneme güncel girdileri kullanır. Devam/manuel sunucuda pinned script politikası ve writer claim ile doğrulanır ve audit edilir; manuel değerler eşlenmiş PCI olmayan scalar değişkenlerle sınırlıdır. Tip/sayfa/required-read kontrolleri korunur. Scriptin mevcut onError/error edge dalları kendi alternatif akışını sürdürebilir. Timeout, transport tamamlanmasa bile command kuyruğunu ve recovery ekranını kilitlemez.
- Sekmeler kanal + müşteri adını gösterir, tarih sırasını kullanır. Kanal bağlamındaki müşteri adı/profileName API'de tanınır; simülatör sesli çağrıda girilen adı taşır. Gerçek test başlık ve sekmede Synthetic customer'ı doğrular.
- Owner takeover token'ı döndürür; eski writer ve yabancı tenant yazıları reddedilir. Devir/bırakma auditlidir. Devralmada çelişen yerel taslak sunucu değerini sessizce ezmez. Pagehide/dispose CSRF'li keepalive release dener; dispose sonrası geç gelen grant de bırakılır. Token bellekte kalır; ulaşılamayan release için TTL/devralma kullanılabilir.
- İlk etkinleşmeye kadar attach/runtime socket-ticket ertelenir; ilk socket resume geçerli lease'i tekrar attach etmez. Ziyaret edilmiş controller sekme değişiminde korunur. Pasif paneller hidden/inert; keyboard Home/End/ok tuşları korunur.

## Doğrulama

| Kontrol | Sonuç |
| --- | --- |
| Gerçek izole simulator/API/hub/mTLS/DB/browser, Chromium/Firefox/WebKit | 3/3; müşteri adı, email fallback, kapasite, launch/redeem, runtime, ACK, axe ve mevcut render bütçeleri |
| API gerçek integration: connector-hub, launch, runtime | 34/34; normalizasyon/duplicate, takeover/eski token/foreign tenant/release/audit dahil |
| Etkilenen API unit alanları | 365/365 |
| Agent tüm unit | 139/139 |
| Connector hub tüm testleri | 630/630 |
| Admin tüm unit | 101/101 |
| Core runtime | 124/124 |
| Script schema | 313/313 |
| Shared types | 46/46 |
| i18n | 8/8 |
| OpenAPI drift | 7/7; spec ve script JSON Schema yenilendi |
| Normal Agent Chromium suite | 35 başarılı, 2 ortam gerektiren test atlandı; 7 yeni recovery/multi-session/axe testi dahil |

Agent production build; API/Agent/Hub/Admin ve verification typecheck; Agent/Hub/Admin/core/schema/shared/i18n lint ve değiştirilen API dosyalarının lint kontrolü geçti. Tam API lint, bu tur değiştirilmemiş integration/KMS dosyalarında 12 hata verdi: `vault-provider.spec.ts`, `vault-transit-client.ts`, `integration-engine.service.ts`, `integrations.module.ts`. Bu dosyalar değiştirilmedi. Agent build mevcut büyük chunk uyarısını verir.

Kanıt dizini: `docs/verification/evidence/cti-agent-20261006/`. İlk failing regresyon ve ara başarısız lint/test logları korunur; tekrarlar başarı toplamına eklenmez. Son gerçek müşteri-adı kanıtı `cti-customer-final.log` ve `browser-real-customer/`; son normal browser `agent-e2e-final-complete.log`. Multi-session/DS politika testleri kontrollü API fixture kullanır; gerçek simülatör doğrulaması ayrı izole servislerde çalışır. Kullanıcının mevcut dev servisleri ve tenant verileri değiştirilmedi.
