# Çalışma zamanı dayanıklılığı — 2026-10-06

Kapsam: AUDIT_REPORT M-11, M-12, M-13, M-15, M-17, M-18, M-19, M-22.
Karar/saklama sözleşmesi: [ADR-0039](../adr/0039-runtime-io-and-payment-token-recovery.md).

## Değişiklikler

- M-11: Agent datasource ucu own-transactions kullanır. Kısa RLS hazırlığında owner,
  writer/sequence ve ref/sürüm doğrulanır; HTTP/vault decrypt sırasında request transaction'ı
  açık değildir. Sonuç ayrı transaction'da güncel writer/sequence ile fence edilir. Geç sonuç
  oturum aktivitesini değiştiremez; entegrasyon girişimi yine audit edilir.
- M-12: toplam deadline → kuyruklu bulkhead → breaker → retry → deneme başına timeout.
  Kuyruk concurrency kadar sınırlıdır; toplam süre en fazla 120 saniye. Mevcut idempotent
  REST metotları dışında retry açılmaz. 1.000 policy LRU olarak tek tek atılır; sıcak tenant'ın
  breaker durumu korunur. Metrik map'i de başlangıçta sınırlanır. Fallback/başarısız çağrı
  `datasource.called` aktivitesinde failure olur; upstream başarısı olarak sayılmaz.
- M-13: datasource hatası/yükleme/idle durumunda boş kayıt uyarısı gösterilmez. Başarısız
  runtime aktivitesi commit edildikten sonra problem+json `errors[]` içinde güvenli TIMEOUT /
  CIRCUIT_OPEN sebebi aktarılır. Agent TR/EN ayrılmış açıklama ve correlationId gösterir;
  devam/manuel/retry kapıları korunur. Hata sonrası authoritative sequence eşitlenir.
- M-15: collaboration message/awareness hooks SQL/Redis çağırmaz. Bağlantı ve 10 saniyelik
  yetki/lease kontrolü korunur; save güncel permission/version, zod ve linked composition
  kontrolü yapar. İki MiB Yjs boyut kontrolü in-memory sync sırasında kalır. `TeamService`
  belge blob'u yerine metadata seçer; yalnız comment içeriği gerektiğinde ayrıca yüklenir.
  `assignments(tenant_id, script_id) WHERE deleted_at IS NULL` migration'ı eklendi.
- M-17: yerel PCI Map kaldırıldı. Signed hosted capture receipt doğrulaması korunur; yalnız
  doğrulanmış token referansı PostgreSQL/Redis tenant-session envelope'unda tutulur. Ham
  ödeme verisi reddedilir; page leave/terminal geçişinde referans temizlenir, bütün browser
  view/event/audit/analytics akışlarında maskelenir. Cache hatası metrik/log üretir; ödeme
  referansı varsa failure sessizce yutulmaz. PSP ödeme verisinin ve token geçerliliğinin sahibidir.
- M-18: launch session fetch hatası disconnected + destek uyarısı olur ve backoff ile yeniden
  denenir; unmount retry'ı iptal eder. Ticket/redeem hataları görünürdür. Yetki reddinin audit'i
  yazılamazsa VERBIS_AUDIT_UNAVAILABLE/503 fail-closed, güvenli log ve metrik üretilir.
  Redis/runtime queue hataları oran sınırlı loglanır. Collaboration listen hatası readiness'e
  yansır. Optional cache parse/read/write ve collaboration persist hataları görünür metriklidir.
  Zararsız cleanup/best-effort catch'ler korunur; mekanik olarak bütün catch'ler silinmedi.
- M-19: AXP/generic command receipt Set'leri 20.000; launch/workload tracker'ları 50.000
  interaction ile sınırlı. Tenant-interaction indeksli cleanup, iki saat TTL ve transferde
  önceki owner temizliği var. API PostgreSQL tuple kilidi ile valid pending/redeemed push
  intent'i yeniden kullanır; hub restart/replika dedupe'si belleğe bağlı değildir. Expired pending
  intent yenilenebilir; fragment teslimi korunur. Genesys overflow resync başarısız ID'yi
  tutar; tek backoff timer retry çakışmasını önler, shutdown timer'ı temizler.
- M-22: supervisor state push kanalına bağlı; bağlıyken polling yok, kopuksa 10 saniyelik
  fallback, liste 30 saniye. Terminal state periodic okumayı durdurur. Audit socket observation
  başladı/bitti başına bir olaydır; her snapshot audit yazmaz. Agent terminal polling kaldırıldı;
  outcome ACK aynı transaction'da outbox → runtime push ile görünür. ACK bekleyen terminal
  bağlantı tekrar bağlanabilir, ACK sonrası reconnect durur.

## Doğrulama ve sınırlar

İlk timeout retry, transaction/fallback ve mesaj başına yetki regresyonları kırmızıydı;
PCI ham değer reddi de önce başarısız oldu. Yjs semantic denetiminin persistence'a taşınması
önceki test beklentilerini save sınırına taşıdı. UI boş sonuç fixture'ı statik `rows` yerine
reactive datasource durumunu kullanacak şekilde düzeltildi.

Gerçek PostgreSQL/Redis/NATS koşusu: 37/37, migration drift yok; beş eşzamanlı push tek intent,
upstream beklerken 1 saniyelik lock_timeout ile field command başarılı, geç sonuç sequence
fence ile reddedilmiş ve yalnız integration attempt audit'i kalmış. SIGKILL ve iki bağımsız
API process writer yarış regresyonları da geçti. Transport testleri timeout/retry/queue/LRU'yu
kontrollü sahte saat ile doğrular; gerçek upstream vendor erişimi bu testlerin kapsamı değildir.

Son Agent Chromium/axe: 37/37, timeout/circuit destek kodu ve recovery dahil.
Root test **32/32** görev (29 cache hit), API **1906**, Agent **151**, Hub **634**, components **298** testi başarılı; 18-workspace merkezi kapsam kapısı geçti.
Son lint **33/33**, typecheck **32/32**, format ve audit/i18n inventory **2/2** geçti.
Güvenli loglar ve SHA manifesti [kanıt dizininde](evidence/runtime-resilience-20261006/).
Ara test/fixture/derleme/lint/kapsam ve migration drift hataları başarı olarak sayılmaz;
eşikler veya güvenlik kapıları gevşetilmedi.

İki saatlik advisory workload TTL'i çok uzun/idle interaction sayısını eksik gösterebilir;
platform routing authority'dir. Yjs boyut koruması update başına in-memory encode eder; bu
çalışma document-size CPU maliyetini bütünüyle kaldırmaz. Browser script timeout'u server retry
bütçesinden önce dolabilir; yazar timeout politikalarını buna göre ayarlamalıdır. Stop audit
başarısızlığı gözlenebilir; DB tamamen erişilemezken audit teslimi garantisi yoktur.

Uzak CI run URL, production/HA load, gerçek vendor ve PSP kabulü bekliyor. Local green
sonuçları release/PCI uygunluk kabulü olarak sunulmaz. Mevcut shared dev verisi korunur;
entegrasyonlar disposable Testcontainers ile çalışır.
