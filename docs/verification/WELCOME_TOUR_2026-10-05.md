# Studio başlangıç rehberi — 5 Ekim 2026

Kullanıcının paylaştığı üç görüntüdeki rehber yeniden tasarlandı. Her adım aynı logo ve boş alanı tekrar etmek yerine kendi konusunu anlatır: kampanya/script/ekran ilişkisi, komut araması ve test/onay/yayın süreci. Adıma özel başlıklar, daha kısa görsel alan, net tipografi, ilerleme çubukları, geri/ileri ve tutarlı alt aksiyonlar kullanılır. Paylaşılan Dialog focus trap, Escape, kapanış ve focus geri dönüşü korunur.

`{current} / {total}` hatası i18next kataloglarında çift süslü parantezle düzeltildi. Regresyon önce başarısız koşuldu; sonra 1/3, 2/3, geri dönüş ve 3/3 beklentileri geçti. Son adım metni gerçek test/onay/yayın sırasını anlatır. TR/EN katalogları birlikte güncellendi. Yeniden açılış ilk adımdan başlar; tamamlanma tercihi reload sonrası korunur.

320px kontrolde rehber arkasındaki Ayarlar özet kartının sabit minimum kolon genişliği ve İngilizce breadcrumb ortam rozetinin taşması da giderildi; yatay kaydırma gizlenerek örtülmedi.

## Doğrulama

- Odaklı Shell davranışı: 28/28 (ilk failing regression logu korunur).
- Chromium rehber testi: TR/EN × light/dark/high-contrast × 320/1440px = 12/12. Her üç adımda axe, sayaç ve taşma; geri, klavyeyle tamamlama, reload, yeniden açılış, Escape/focus dönüşü.
- 36 yeni adım referansı üretildi ve normal, güncellemesiz görsel kıyas 12/12 geçti. TR koyu üç masaüstü, açık masaüstü ve TR/EN mobil görüntüler gözle incelendi.
- Monorepo lint/typecheck/build/test: 77/77 görev başarılı (73 cache, 4 yeniden yürütülen). Coverage 18/18 workspace ve güvenlik kapıları başarılı; sonuçlar `quality-final.log` ve `coverage-final.log` dosyalarında tutulur. TR/EN katalogları 1.596/1.596 anahtarla eşleşir.

Kanıt: `docs/verification/evidence/welcome-tour-20261005/`. İlk tarayıcı teşhisinde geniş `/api/**` mocku Vite `/src/api/client.ts` modülünü de yakaladı; mock yalnız `/api/` ile başlayan URL pathname'lerine sınırlandı. Başarısız teşhis koşuları başarılı sayılmadı. Test eşikleri ve axe kuralları gevşetilmedi. Gerçek kullanıcı verisine, production deployment veya Git commit/push'a müdahale edilmedi.
