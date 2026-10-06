# Routing doğruluğu — 2026-10-06

Kapsam: M-03…M-10, T-05, T-16. Kararlar: [ADR-0040](../adr/0040-authoritative-routing-and-session-admission.md).

## Davranış

- Connector SDK explicit `routing` ve allow-list canonical attributes üzerinden locale, skills,
  segment ve stable key taşır. Locale casing normalize edilir. API encrypted interaction envelope
  içinde saklar; lifecycle event eksik routing/customer verisini korur. Launch envelope'u açar ve
  attached predicate facts dahil resolver'a iletir. Browser launch input'u genişletilmedi.
- Closed campaign schedule seçim yapmaz. Bozuk DB workingHours log/metrik + 503 üretir; null
  schedule açık kalır. Tarih/timezone/tatil ve kapanışın exclusive sınırı korunur.
- A/B agent kimliğine/boş sabite düşmez. Key yoksa normal version + abSkipped trace; kolun
  version'ı published değilse normal version + variant_not_published, variant analytics etiketi yok.
- Matches, ortak RE2JS linear-time motorunda, pattern/input ve tree sınırlarıyla çalışır. Admission
  compile, lookaround/backreference/invalid desenleri reddeder. `$expr` yazma DTO/OpenAPI'sinde
  yok; legacy subtree negation/short-circuit ile true'ya dönüşmez. Designer assignment formu fact
  kuralıyla açılır, advanced editor sunmaz ve legacy expression için açıklama/dönüşüm ister.
- Redis key generation + DB metadata fingerprint içerir; relay/consumer gecikmesi stale karar
  döndürmez. Load racing commit'ini üç kez fence eder ve conflict verir. Invalidation failure
  consumer'a throw edilerek retry edilir.
- Session quota için tenant lock yalnız kısa bağımsız RLS admission transaction'ındadır.
  NO KEY UPDATE foreign-key key-share lock'larına takılmaz. Active session + pending lease tek
  MVCC statement'ta sayılır. INSERT tüketimi session ile atomic; rollback lease'i korur, expiry
  tüketimi reddeder. Partial session tenant/state ve tenant/interaction index migration/RLS/drift
  kontrolüyle eklendi. User/script quota davranışı korunur.

## Kanıt

İlk unit/property koşusu 14 failed / 127 passed; SDK routing ve Designer değişiklikleri de önce
kırmızı testle başladı. Baseline integration eski launch/resolver/snapshot/normal quota kodunu
geçici olarak geri yükleyerek çalıştırıldı; yeni testin reserveSessionCapacity yardımcı export'u
bu koşuda bırakıldı. Cache pause ve 1 saniyelik tenant lock probe başarısız oldu (2 failed / 34
passed); yalnız launch bağlamı regresyonu önceki launch koduyla 422 aldı (1 failed / 20 filtered).
Bu karşılaştırma sonrası mevcut implementation dosyaları geri yüklendi; filtered testler kabul
başarısı sayılmaz.

Son hedef disposable PostgreSQL/Redis/NATS + migrations **45/45**: encrypted context→secure
redeem, doğrudan committed pause/channel/priority/delete/hours değişikliği, bozuk hours 503,
8 concurrent quota reservation'dan yalnız 3 kabul, stalled initialize sırasında tenant policy
update, rollback/expiry ve migration drift/RLS. Eksik routing alanlı held olayından sonra da redeem başarılı; normal quota testleri korunur.

Hedef unit/property **154/154**; long ambiguous regex nonmatch, deterministic ranking,
customer-key stickiness across agents/interactions, closed-hours ve unpublished variant properties.
Designer Chromium **10/10**; assignment POST fact predicate ve axe, release a11y üç tema dahil.
Ara fixture, SQL permission, expired lease error-code, lint ve type annotation hataları düzeltilmiş
olup başarılı sonuç olarak sayılmaz. Güvenlik/kapsam kapıları gevşetilmedi.

Root test **32/32** görev (30 cache hit), API **1927/1927**, Designer **368/368**; lint **33/33**, typecheck **32/32**, format başarılı; inventory **2/2** ve 18-workspace coverage kapısı geçti.
Son root test/lint/typecheck/format, merkezi coverage, inventory ve SHA manifesti
[kanıt dizininde](evidence/routing-correctness-20261006/). OpenAPI ve docs-site kopyaları birlikte
üretildi; API write contract artık routing expression reference içermez.

## Kalan kabul

Reservation TTL iki dakika; API request transaction sınırı 15 saniye. Başarısız launch bu sürede
geçici kapasite tutabilir. Admission hâlâ kısa süre tenant başına seri ve indeksli count yapar;
metadata fingerprint'i çok yüksek assignment/release sayısında production load ölçümü gerektirir.
Harici customer key verilmezse stickiness interaction seviyesindedir. Kontrol sürümüne fallback
olan oturumlar experiment-arm analitiğinden çıkar; gerçek vendor/customer identity kabulü
bu testin kapsamı değildir. `$expr` için routing fact scope desteği gelecekte ayrı karardır.

Uzak CI run URL, gerçek vendor routing ve dağıtılmış production/HA yük kabulü bekliyor.
Yerel green sonucu release kabulü olarak sunulmaz; shared dev verileri korunmuş, altyapı testleri
Testcontainers üzerinde çalışmıştır.
