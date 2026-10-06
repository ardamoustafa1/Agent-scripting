# Verbis — 3 dakikalık satış demosu

Bu akış yazıldı; seed, browser/capture ve testler bu oturumda çalıştırılmadı. Gösterimi izole yerel
ortamda prova edin. İddiaları gerçek kabul sonuçlarıyla sınırlayın; mock/vendor/HA/SLO başarısı ima etmeyin.

## Hazırlık (sunumdan önce)

Bağımlılıklar ve generated Prisma client hazır olmalı; temiz checkout’ta önce
`pnpm install --frozen-lockfile` ve `pnpm --filter @verbis/api... build` kullanın.

- Development veritabanına migration uygulayın; `NODE_ENV=development` ve yalnız local
  PostgreSQL `verbis`/`verbis_dev`/`verbis_demo`/`verbis_test` hedefiyle `pnpm seed:demo` çağırın.
  Komut migration/seed/test zinciri çalıştırmaz; schema hazırlanmış olmalıdır. Production/remote DB
  reddedilir. Var olan demo bundle’ı güncellenmez/silinmez; tekrar çağrı veri eklemez.
- İsteğe bağlı izole SSO/mTLS seed ve temiz kurulum smoke hazırlığı: [smoke README](../tests/demo-smoke/README.md).
  Demo manual scoped roller yalnız dört sentetik campaign ID’sine izin verir.
- Tenant `verbis-demo`; yönetici, tasarımcı, onaycı, agent ve denetçi kullanıcıları
  `@example.invalid` fixture adresleriyle oluşturulur. Seed parola, TOTP, IdP secret veya auth bypass
  yaratmaz. Ayrı demo IdP’de doğrulanmış subject/email/group ile bu kullanıcıları bağlayın; ayrılmış
  browser profillerinde SSO oturumlarını önceden açın. Existing dev Keycloak yalnız `verbis-dev`
  tenantına bağlı olabilir; demo tenantı için admin’in yetkili IdP kurulumu gerekir.
- Hub/API’de simulator development feature flag’ini açık tutun; hub tenant listesi/service-client
  yetkileri demo tenantını kapsasın. Production’da simulator’ı açmayın. Agent platform identity
  `generic / demo-agent-1`, connector `019c0000-0000-7000-8000-000000000002`.
- Designer’da dört yayınlanmış script ve `Ortak Karşılama` linked screen görünür olsun. Yeni değişiklik
  için yayınlanmış sürümü düzenlemek yerine yeni draft oluşturun. İlk seed yayını **sentetik bootstrap**;
  gerçek onay sürecinin başarılı çalıştığına dair kanıt değildir.
- Mock servisler gerçek API’ya çıkmaz; success/empty/failure/slow console senaryolarını prova edin.
  Endpointler `.invalid`dir. Demo runtime’ın mock.enabled ayarını kaldırmayın.
- Analytics etkin olsun: ayrı ephemeral `ANALYTICS_PSEUDONYM_KEY`’i secret store/env’de sağlayın;
  bu depoda sabit key yoktur. Varsayılan seed günü `2026-10-03`; gösterimden önce boş demo DB’de
  `DEMO_DATE=YYYY-MM-DD pnpm seed:demo` ile uygun tarihi seçin. Dashboard tarih aralığını DEMO_DATE
  ve önceki altı güne ayarlayın: 28 geçmiş session / 84 fact, dört kampanya, sentetik outcomes.
- `apps/api/prisma/demo/scenarios.json` dört call lifecycle fixture’ı içerir. Admin simulator UI veya
  yetkili API üzerinden çalıştırın; JSON grant/token değildir. Wrap-up için demo-success sonucu kullanın.
- Gerçek screenshot capture isteğe bağlı, ayrı yetkili komuttur (`pnpm docs:capture`); mevcut görseller
  şematik olarak etiketlenir. Görüntüde gerçek PII, secret veya auth state göstermeyin.

## 0:00–0:30 — Tek ekran, dört kampanya

**Göster:** Admin kampanyaları: Kredi Kartı Satış, Tarife Yükseltme, Tahsilat, Memnuniyet Anketi.
Designer ortak ekran kitabından `Ortak Karşılama` sürüm 1.0.0 ve dört linked kullanımını açın.

**Söyle:** “Agent deneyimini kampanyaya göre değiştiriyoruz. Ortak karşılama ve bilgilendirme ekranını
bir kere yönetiyoruz; yayınlanan sürümlerin pin’leri değişikliklerden korunuyor.”

## 0:30–1:10 — Kodsuz karar ve güvenli entegrasyon

**Göster:** Kredi kartı scriptinin yeni draft’ında paletten eklenebilir component, variable binding,
flow karar kolu ve mock credit-score mapping. Mock console’da success → failure değiştirin.
TR/EN mesaj alanlarını ve preview’yu gösterin; hazırlanan değişikliği submit edin.

**Söyle:** “Tasarım, kural ve servis tek akışta. Agent’a secret vermiyoruz; response sadece izinli
alanlara map ediliyor. Hata kolunu yayınlamadan görebiliyoruz.”

## 1:10–1:40 — Görev ayrımı ve kontrollü yayın

**Göster:** Ayrı onaycı profilinde draft’ın change note/checksum’unu inceleyip onaylayın. Yetkili
yayıncı yayınlasın; campaign manager yeni pin’i atasın. İşlemler staging kabulü gerektirir.

**Söyle:** “Tasarlayan ve onaylayan ayrı. Yeni yayın aktif görüşmenin sürümünü sessizce değiştirmiyor.”

## 1:40–2:25 — Çağrıdan doğru agent ekranına

**Göster:** Admin simulator: `credit-card-sale`, queue `demo-creditcardsales`, agent `demo-agent-1`,
autoConnect. Agent profilinde single-use launch teklifini kabul edin. Ortak karşılama/must-read,
mock teklif, İleri ve wrap-up sonucu. İsterseniz kısa hold/resume gösterin; tüm sayfaları doldurmayı
üç dakikaya sıkıştırmayın. Önceden prova edilmiş kısa yol kullanın.

**Söyle:** “URL’de script ID taşımıyoruz. Güncel çağrı katılımı ve kampanya ataması doğrulanınca
uygun ekran geliyor. Sonuç write-back sözleşmesiyle ve idempotency anahtarıyla takip ediliyor.”

## 2:25–3:00 — Ölçülebilirlik ve denetlenebilirlik

**Göster:** Hazır analytics tarih aralığında campaign tamamlanma/süre; audit’te son publication,
assignment ve launch correlation ID’si. Zincir verification sonucunu **yalnız gerçekten çalışıp
başarılıysa** gösterin; aksini bir ölçüm sonucu olarak sunmayın.

**Söyle:** “Sadece ekran tasarımı değil: görüşme sonucunu ölçebiliyor, kimin hangi değişikliği
onayladığını izleyebiliyoruz. Kurumsal kimlik, tenant izolasyonu ve audit aynı ürünün parçası.”

## Prova aksarsa

SSO/launch başarısızsa guard’ı kapatmayın; doğru demo user/tenant/queue/hub yetkisini düzeltin.
Vendor sandbox bağlı değilse yalnız açıkça **simülatör** anlatın. Shared-screen veya draft ekranı
yüklenmiyorsa önceden capture edilmiş, incelenmiş **demo screenshot** kullanılabilir; canlı sonucu
mış gibi göstermeyin. Demo’ya gerçek kart/kimlik/telefon veya müşteri bilgisi girmeyin.

## Three-minute English talk track

- **0:00–0:30:** Four campaigns, one version-pinned shared welcome screen. “Manage shared guidance
  once while preserving published campaign versions.”
- **0:30–1:10:** Designer binding, decision and mock success/failure mapping. “Author rules and service
  behavior without sending credentials to an agent browser.”
- **1:10–1:40:** Independent approver and campaign pin. “Separate authorship from approval; preserve
  active interaction versions.”
- **1:40–2:25:** Authenticated simulator call, secure launch, shared page, offer and wrap-up.
  “Current participation and assignment select the screen; a script ID in a URL grants nothing.”
- **2:25–3:00:** Synthetic analytics and actual audit evidence. “Measure outcomes and review change
  custody.” Show verification success only after it actually succeeds.

The preparation above requires a migrated isolated local database, separately configured SSO/hub
service clients and feature flags. Seed creates synthetic data, not login credentials, production
vendor connectivity or tested release evidence.
