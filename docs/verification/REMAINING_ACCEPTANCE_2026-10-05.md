# Aktif Agent, simülatör ve güvenlik/performance — 2026-10-05

Önceki tüm sayfalar denetimindeki aktif oturum/simülatör ve production nginx güvenlik boşlukları yerel izole kabul ortamında yeniden test edildi. Gerçek API/hub/runtime zinciri üç tarayıcıda geçti; üretimde kullanılan nginx config gerçek nginx container üzerinde geçti. Gerçek müşteri production/staging yük kabulü verilmez.

## Aktif oturum ve simülatör

`tests/verification/agent-live-local.audit.spec.ts` mevcut kabul sürücüsü genişletildi: gerçek API ile iki sayfalı script oluşturma, ayrı kullanıcının review/publish işlemi, kampanya/pinned assignment ve generic simulator connector; gerçek hub ve sertifika doğrulayan mTLS edge. İzole PostgreSQL16/Redis7/NATS kullanılır. Auth/API/hub HTTP mock değildir; SSO cookie gerçek SessionStore tarafından sentetik olarak kurulmuştur, gerçek IdP login kanıtı değildir. SQL owner fixture işlemleri yalnız disposable test DB içindedir.

Üç motor: Chromium/Firefox/WebKit **3/3**. Çağrı→launch intent→socket→redeem→runtime, normal Agent rolü, ikinci sekme salt okunur, recording pause/resume, platform hold/resume ve pasif/aktif Next, kalıcı alan kaydı, iki sayfa geçişi, zorunlu outcome notu, tam bir outcome, gerçek writeAttributes/setWrapUp hub ACK, yenilemeden sonra tamamlanma. 390/768/1440 px taşma ve axe kontrolleri geçti; browser exception listesi boş.

Shared development tenantına connector/secret/role/publish eklenmedi: 5175 simülatör ekranı halen etkin connector olmadığını gösterir. Çalıştırılmış connector ve yayımlanmış sentetik script izole fixture tenantına aittir; test sonunda o ortam kapanır. Kalıcı demo kurulumuyla bu kabul testi karıştırılmamalıdır.

## Ölçümler (ms)

| Motor | Event→aktif ekran | İlk tab navigasyonu | Tekrar navigasyon | Sayfa geçişi | Sonuç→hub ACK |
|---|---:|---:|---:|---:|---:|
| chromium | 233 | 250 | 305 | 17.4 | 144 |
| firefox | 241 | 321 | 279 | 22 | 174 |
| webkit | 291 | 831 | 467 | 27 | 171 |

İlk/tekrar navigasyon bütçeleri **1500/500 ms**, gerçek Next→page-id değişimi bütçesi **100 ms**; hepsi geçti. İlk navigasyon aynı browser context’te yeni sekmedir; tamamen boş HTTP cache veya müşteri cihazında cold start garantisi değildir. Writer ana sekmede kalır, navigasyon ölçümleri aynı aktif oturumun observer sekmesinde yapılır. Sayfa geçişi ana yazıcı sekmesinde gerçek API üzerinden ölçülür. Event→aktif ekran ve hub ACK ayrı 10s mevcut kapıları altında kalır. Yerel tekil sentetik oturum ölçümleridir, dağıtık yük/SLA kanıtı değil.

Standalone Agent `e2e/performance.spec.ts` bu tur harici storage state ile çalıştırılmadı; aynı 1500/500/100 ms kapıları gerçek zincire entegre edilerek üç motorda uygulandı. Önceki iki skip tarihsel sonuç olarak korunur.

Gerçek audit writer throughput: sekiz tenant, 100.000 kayıt, **3,79s / 26.411 events/s**, 10.000 events/s eşiği geçti; hash zinciri/RLS/batch gerçek DB, **2/2**. Tek modül batched throughput, 2000 eşzamanlı temsilci kapasitesi anlamına gelmez.

## Production nginx güvenlik

Mevcut `nginxinc/nginx-unprivileged:1.31-alpine` image, Agent üretim dist ve depodaki nginx/security-headers/frame-sources dosyaları salt okunur mount ile yalnız loopback5484’te çalıştırıldı. `SECURITY_BASE_URL=http://127.0.0.1:5484 E2E_LIVE=1` ile mevcut `agent-web/e2e/security.spec.ts` **1/1** geçti: her response farklı 32-hex nonce, HTML nonce eşleşmesi, strict-dynamic, unsafe-inline/eval yok, Trusted Types enforcement, uygulama root render, sıfır CSP violation, HSTS/nosniff/no-referrer/no-store. Vite headers mock değildir.

HTTP loopback test HSTS başlığını doğrular; gerçek TLS terminasyonu, müşteri DNS/certificate ve HTTPS enforcement kabulü değildir. Bu static edge authenticated BFF proxy/production deployment kabulünün yerine geçmez. Güvenlik kontrolleri gevşetilmedi. Test container stop/remove edildi; kullanıcı docker servisleri korunur.

Güvenlik focused suite **44/44** (schema2, UI9, SDK4, components7, API22). Harness ESLint ve TypeScript kontrolü temiz; format ve diff check geçti. İlk browser callback DOM tipleri Node tsconfig altında tip hatası verdi; mevcut harness’in string browser evaluation yaklaşımıyla düzeltildi, final3/3 ve typecheck tekrarlandı. İfade kullanıcı girdisi değildir. Ara/final loglar saklanır; tekrarlar toplam başarıya eklenmez.

## Kanıt ve kalan ihtiyaç

Screenshots/ölçümler `artifacts/remaining-acceptance-20261005/agent-final/`; log ve SHA manifest `docs/verification/evidence/remaining-acceptance-20261005/`. Kaynak değişikliği test fixture/kabul ölçümüyle sınırlı; production uygulama kaynakları değiştirilmedi.

Gerçek production güvenlik/performance kabulü için yetkili **staging URL ve erişim**, deployment/edge topolojisi, hedef eşzamanlı temsilci ve workload/SLA/RPO/RTO gerekir. Paylaşılan geliştirme tenantında kalıcı simülatör demo istenirse hub service-client mTLS/JWKS güveni ve Agent platform kimliği kurulmalıdır; gizli anahtarlar chat veya repoya konulmamalı. Bu bilgiler olmadan production/2000-agent/HA/restore/rollback veya müşteri IdP kabulü varmış gibi sunulmaz. Dış vendor ve canlı AI önceki kullanıcı kapsamıyla dışarıdadır.
