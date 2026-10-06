# Designer yaşam döngüsü ve ekip çalışması

CLAUDE.md, mevcut onay politikası, BFF/CSRF, tenant RLS ve audit/outbox kuralları üzerine kuruludur.
[ADR-0028](adr/0028-lifecycle-collaboration-and-package-v2.md) kararları ve paket v2 sözleşmesini açıklar.

## Ekranlar

- `/scripts/:id/versions/:number/release`: zorunlu değişiklik notuyla incelemeye gönderme,
  yorum/ret/geri çekme, senaryo regresyon kapılı onay/yayın, zamanlanmış yayın durumları ve
  önceki yayın başına tek tıkla rollback. Yetkiler ve görevler ayrılığı sunucuda yeniden kontrol edilir.
- Aynı sayfada sürüm seçimi, yan yana gerçek core-runtime ekran görüntüsü, renk ve metinle
  eklenen/silinen/değişen node göstergeleri, iki flow görünümü, değişken/veri kaynağı ve JSON patch diff.
  Diff renderer etkileşimsizdir; entegrasyon ya da aksiyon çalıştırmaz. Lint ve senaryo sonuçları ayrıca gösterilir.
- `/scripts/:id/assignments`: çoklu kampanya atama, kampanya içindeki tüm scriptleri klavye veya
  sürüklemeyle önceliklendirme, tek transaction’da toplu optimistic kayıt, tarih/koşul ve A/B kollarının
  yayınlanmış sürümlerine pinleme. Yüzdeler resolver’ın 10.000 baz puan ölçeğine dönüştürülür.
  Resolver testinde kanal, kampanya ve attached data ile gerçek resolver trace’i gösterilir.
  İlk 100 kayıttan fazlası varsa tüm kampanya sıralaması engellenir; yanlış eksik liste sırası yazılmaz.
- `/scripts/:id/packages`: onaylı/yayınlanmış sürümlerin hedef ortama imzalı export’u;
  import ön kontrolü, eksik entegrasyon oluşturma/eşleme ve yalnız secret metadata’sı üzerinden
  secret-ref eşleme. Import taslak oluşturur; hedef ortamın yayın/onay kurallarını atlamaz.
- `/templates`: bankacılık, telekom, sigorta, e-ticaret, tahsilat ve anket başlangıçları;
  sektör/kaynak/arama filtreleri ve tenant sürümünden şablon oluşturma.
- Görsel editörün ekip paneli: gerçek zamanlı Yjs düzenleme, adla presence avatarları,
  imleçler/seçimler, seçili node yorumları, uygun üyelere @mention, yanıt/çözüldü/yeniden aç.
  Üst bar bildirimleri ilgili inceleme sürümüne götürür.

## Sunucu yayın kapısı (2026-10-06)

Script oluşturma penceresinde yazarın okuyabildiği ve script oluşturma yetkisi olan bir kampanya
seçilir. `POST /v1/scripts` üzerindeki `campaignId`, script ve `latestPublished` atamasını aynı
tenant transaction'ında oluşturur; ikisi de audit/outbox'a yazılır. Kampanya kapsamlı yazar için
atamasız oluşturma veya mevcut atamasız scripti submit/regression etme, açıklamalı
`403 VERBIS_AUTHZ_SCOPE_MISSING` döndürür. Başka kampanya/tenant erişimi verilmez. Kapsamsız
yönetici/servis istemcileri için API'de `campaignId` isteğe bağlıdır.

Submit, onay, publish, zamanlanmış publish ve rollback sunucuda güncel kayıt üzerinde kapıyı
çalıştırır: tüm sayfalardaki host `ComponentRegistry` prop/event/binding/child/plugin sözleşmeleri,
tenant veri kaynağı varlığı, birebir sürüm pini ve onaylı prod profili denetlenir. Veri kaynağı satır
kilitleri transaction sonuna kadar düzenleme/silme/promotion yarışını engeller. En az bir kayıtlı
sentetik regresyon senaryosu bulunmalı ve bütün senaryolar geçmelidir; boş küme `passed:false`
olur. Kontrol hata verdiğinde yaşam döngüsü durumu ve yayın başı değişmez.

İmzalı import önce özgün imzayı doğrular; scriptler ve ortak ekranların bileşen sözleşmelerini
kontrol eder, script senaryolarını yalnız mock portlarıyla çalıştırır. Bağımlılık/secret eşlemesi
sonrasında hedef tenant'taki gerçek ref ve sürüm tekrar denetlenir. Import bir taslaktır: yeni
entegrasyonun prod profili taşınmaz; prod onayı submit/publish öncesinde hedef ortamda gerekir.
Dry-run eksik bağımlılıkları bir plan olarak gösterir, yazmaz. Regresyon senaryosu gereksinimi
script belgeleri içindir; yalnız ortak ekran içeren paket bir çalıştırılabilir script değildir.

Güncel test sonuçları ve ilk başarısız regresyon kanıtı:
[Yayın kapısı doğrulaması](verification/PUBLICATION_GATE_2026-10-06.md).

## Kurulum

1. Bağımlılıkları yükleyin: `pnpm install`. Bu değişiklik Yjs ve Hocuspocus 4.7.0 ekler.
2. API migrations’ı uygulayın: `pnpm --filter @verbis/api db:migrate`.
   `20261002090000_team_authoring` yorumlar, CRDT snapshot’ları ve zamanlanmış yayın tablolarını,
   foreign key’leri ve FORCE RLS politikalarını ekler. Bu geliştirme oturumunda migration çalıştırılmadı.
3. Redis, PostgreSQL, NATS ve mevcut outbox/event consumers altyapısı çalışmalı.
   Zamanlanmış yayın için `EVENT_CONSUMERS_ENABLED=true` gereklidir; kapalıysa API isteği reddeder.
4. Aynı API sürecinde özel listener için `COLLABORATION_PORT=4010` ayarlayın.
   Yerelde `COLLABORATION_ADDRESS=127.0.0.1`; konteynerde yalnız özel ağ üzerinden erişilen
   `0.0.0.0` kullanılabilir. Varsayılan port `0` özelliği kapatır.
5. Designer Vite proxy’si `/collaboration` WebSocket isteklerini varsayılan
   `COLLABORATION_INTERNAL_URL=http://127.0.0.1:4010` adresine iletir.
   Production aynı TLS origin altında upgrade proxy ister:
   [nginx örneği](../infra/collaboration/nginx.location.conf.example).
   BFF allowed-origin yapılandırması browser origin’i içermelidir. Origin’i değiştirmeyin.
6. Bir collaboration instance veya belge bazlı sticky routing kullanın. Redis lease farklı
   instance’a aynı belgeyi açtırmaz; instance’lar arasında CRDT relay henüz yoktur.
7. Paket imzalama için mevcut paket signing key/key-ring yapılandırmasını kullanın.
   Hedef ortam export kaynağının doğrulama anahtarını güvenilir ring’e eklemelidir.
   Secret değerlerini JSON’a veya browser’a koymayın; hedef ortamdaki secret referansını seçin.

## Kayıt ve çakışmalar

Snapshot debounce’u 1,5 saniye, azami bekleme 10 saniyedir. Normal autosave ortak düzenleme
boyunca durur; eski HTTP sekmeleri Redis owner lease nedeniyle yazamaz. İlk sync ve bağlantı
kesintisinde editör yazıları askıya alınır. Geçici semantik hatalar odadaki değişiklikleri korur ve
“doğrulama gerekli” durumunu gösterir; geçerli belge oluşturulduğunda sonraki snapshot kaydedilir.
Kalıcı counter/permission çakışmasında tekrar bağlanmak gerekir. “Kaydet ve ekipten ayrıl” başarılı
flush ve yeniden yükleme yapar; kaydedilmeyen yerel değişiklikler için browser uyarısı korunur.

Süreç kaybında son onaylanmış snapshot geri yüklenir; henüz onaylanmamış değişiklikler kaybolabilir.
Lease 30 saniyede dolar. Socket trafiği BFF oturum süresini uzatmaz; süresi dolan oturum tekrar giriş
ister. Son bağlantı kapanırken snapshot, halen yetkili son editör adına audit edilir.

## Test komutları

```sh
pnpm test:lifecycle
pnpm test:lifecycle --integration
pnpm test:lifecycle --e2e
```

Unit senaryoları CRDT alan çakışması/reorder/yerel undo, lease owner fencing, rollback ve SoD,
zorunlu not, imzalı bağımlılık/secret eşleme, v1 imza uyumu ve authoritative resolver head’i kapsar.
Zamanlanmış yayın testleri permission iptali, içerik değişmesi, regresyon reddi, retry ve no-op
kontrollerini içerir. API integration senaryoları tenant izolasyonu, yorum/resolve optimistic
counter’ı ve batch transaction rollback’ini; Playwright senaryoları zorunlu not/CSRF,
klavye diff sekmeleri, sektör galerisi ve üç tema axe kontrollerini içerir.

İki kullanıcı/iki socket kabulü ve geçmiş çalıştırmalar için `docs/verification/` raporlarına bakın.
Süreç restart/failover ve operasyon kabulü ayrı kanıt ister; yayın kapısı testleri bunların yerine geçmez.
