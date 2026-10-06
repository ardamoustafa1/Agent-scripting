# Enterprise Core — REST hata ve kalıcılık denetimi

Tarih: 2026-10-05. Kapsam: kullanıcının devam talebiyle ilk core release'in staging olmadan doğrulanabilen hata/kayıt sınırları. Gerçek müşteri vendor bağlantısı, canlı AI veya 2.000 agent production kapasitesi kabulü değildir.

## Düzeltilen iki uygulama hatası

| Bulgu | Son davranış | Regresyon |
| --- | --- | --- |
| Tenant datasource mock enabled olduğunda live prod çağrısı gerçek transport olmadan başarılı mock sonucu dönebiliyordu. | Prod/live + enabled mock: değer yok, trace MOCK_FORBIDDEN; secret okunmaz ve transport çağrılmaz. Sessizce gerçek isteğe geçilmez. Explicit preview ile dev/test mock davranışı korunur. | Önce başarısız production testi; sonra aynı test geçti. |
| Geçersiz JSON veya output schema'ya uymayan cache kaydı gerçek servisin okunmasını engelliyordu. | Best-effort cache miss; gerçek authenticated/egress-checked response alınır, şema doğrulanır ve cache yenilenir. Geçersiz live response yine SCHEMA_INVALID verir. | Malformed JSON ve wrong-type cache için önce iki başarısız test, sonra geçen live-read testleri. |

[İlk failing log](evidence/core-resilience-20261005/rest-before.log): 3 başarısız / 33 başarılı. [REST modül son koşusu](evidence/core-resilience-20261005/rest-final.log): **130/130**, dokuz dosya. Retry idempotency, POST/PATCH non-retry, total timeout, concurrency limit, circuit open/reset, fallback/SSRF, transport abort/body sınırları ve authentication testleri bu modül koşusundadır; yeni testlerin tamamı bunların yeniden uygulanması değildir.

Davranış sıkılaştırması ve eski production mock ayarlarının kapatılması gereği [ADR-0038](../adr/0038-production-integration-mocks-and-cache-recovery.md) içinde. Request/document şeması değişmez. Runtime environment server-side bağlanır; kullanıcı alanı prod yerine test seçmek için kullanılmaz. Mevcut audit path başarısız execution'ı trace error ile kaydeder.

## Yeni gerçek veritabanı kabul senaryoları

1. **İki API instance / aynı draft revision:** iki Nest uygulaması aynı PostgreSQL/Redis/NATS'e bağlanır. Aynı If-Match revision ile farklı iki belge eşzamanlı PUT edilir. Biri 200, diğeri 412/version mismatch alır. Kaydedilmiş belgenin kazanan içerik olduğu, version'un yalnız bir arttığı ve yalnız bir script.version.updated audit kaydı bulunduğu kontrol edilir. Mevcut uygulama koruması geçti; bu alanda production kod değişikliği gerekmedi.
2. **Yeni API instance / hot cache kaybı:** persist=true runtimeCounter=42 için command ACK alındıktan sonra ilgili Redis snapshot cache kaydı silinir. Yeni oluşturulmuş API instance yalnız durable kaydı kullanarak sequence=3, active state ve değeri 42 geri okur. Event ve sequence tekrar çoğalmaz. Mevcut uygulama koruması geçti.

Bu ikinci test gerçek process SIGKILL, Redis servisinin tamamen kaybı, WAN/network partition veya PostgreSQL failover testi değildir. Claim/lease Redis state'i silinmez; kayıp hot snapshot cache ile sınırlıdır. PCI/ephemeral hassas belleğin kurtarıldığı iddia edilmez. Birincide iki ayrı uygulama instance'ı aynı yerel process içinde çalışır; production multi-host topolojisini kanıtlamaz.

[Authoring/runtime/RLS son koşu](evidence/core-resilience-20261005/recovery-integration.log): **39/39**, üç dosya. Yarışan runtime command, tab fencing, tenant negatifleri, transaction rollback ve mevcut lifecycle/yayın/assignment testleri de dahil.

## Son geniş doğrulama

| Kontrol | Sonuç | Kanıt |
| --- | --- | --- |
| API tam unit + gerçek DB integration / coverage | **1.833/1.833**, 146 dosya | api-full.log; üç yeni unit + iki yeni integration testi dahil. Statement %90,76, branch %85,64, function %88,66, line %92,89; kapılar korunur. |
| Agent tam unit / coverage | **125/125**, 16 dosya | agent-unit.log; reconnect/offline/conflict/vault kontrolleri dahil; fixture testleri live platform kabulü değildir. |
| Core Runtime tam unit / coverage son tekrar | **124/124**, 11 dosya | runtime-final.log |
| API typecheck / lint / build | Başarılı | api-typecheck.log, api-lint-final.log, api-build.log |

Kanıt dizini: [manifest](evidence/core-resilience-20261005/manifest.json). Full API koşusu, hedef 130/39 testleri içerir; rakamlar toplanarak benzersiz başarı sayısı şişirilmez. Agent/Core Runtime bu turda değişmedi; mevcut koruma davranışları yeniden kontrol edildi.

İlk runtime koşusunda eşzamanlı API/typecheck test yükü sırasında basit rule conversion ExpressionError TIMEOUT verdi: 123 başarılı / 1 başarısız. Süre veya expression güvenlik budget'ı artırılmadan tekrar 124/124 geçti. İlk log runtime-unit.log saklandı. Nedeni üretim topolojisinde kesinleştirilmiş sayılmaz; hedef yük altında expression bütçesi ve kullanıcı hata davranışı ölçülmelidir. İlk lint yeni test helper'ında await içermeyen async get buldu; Promise.resolve biçimine düzeltildi ve son lint geçti. İlk REST modül tekrarında eski cache testi invalid cached response beklentisi nedeniyle başarısızdı; test geçersiz gerçek transport response'unu da doğrulayacak şekilde güncellendi, SCHEMA_INVALID assertion'ı korunur.

## Sonraki release kapıları

- Mevcut staging yokluğundan bağımsız yerel fault/race senaryoları genişletilebilir; bu rapor iki somut hatayı kapatır.
- 2.000 bağımsız active session ile en az 60 dakika karma load/socket soak, instance-loss/reconnect ve expression bütçesi ölçümü hedef staging'de yapılmalı.
- Durable sıfır kayıp için synchronous ACK/replication/felaket kapsamı kararı ve backup restore/anahtar/audit doğrulaması hâlâ gerekir.
- Aynı digest ile staging clean-install, production edge ve upgrade/rollback kabulü yapılmadan genel canlı onayı verilmez.

Müşteri verisi, .env, mevcut yerel development servisleri veya production deployment değiştirilmedi. Kod commit/publish/deploy edilmedi.

## Ek kanıt — ayrı API process / SIGKILL

Sonraki devam turunda aynı-process sınırı gerçek ayrı Node API süreçleri ve HTTP ACK sonrası SIGKILL ile genişletildi. Sıcak cache korunurken ve yalnız session hot cache kaydı silinirken encrypted durable runtime recovery; iki gerçek process arasında tek revision winner; audit count/hash ve tenant negatifleri geçti. Ayrıntılar ve kapsam sınırları: `PROCESS_RECOVERY_2026-10-05.md`. Önceki yerel testin kendisi SIGKILL testi olarak yeniden adlandırılmadı. PostgreSQL/Redis/NATS kaybı, multihost veya 2000-agent kabulü hâlâ ayrı gerekliliktir.
