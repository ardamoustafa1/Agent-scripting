# Enterprise Core — yük kabulü hazırlığı

Tarih: 2026-10-05. Durum: **yerel test hazırlığı doğrulandı; staging kapasitesi veya production kabulü verilmedi.** Uygulama arayüzü, müşteri verisi ve mevcut development servisleri değiştirilmedi. Dış vendor/canlı AI ilk core sürüm kapsamına alınmadı.

## Bulunan ve düzeltilen sorunlar

| Sorun | Son davranış |
| --- | --- |
| Fixture yalnız satır sayısıyla kontrol ediliyordu; aynı kullanıcı/BFF/session ile kapasite şişirilebilirdi. | Seçilen kullanıcı UUID, gerçek BFF cookie değeri ve socket runtime session UUID birbirinden farklı olmak zorunda. Cookie'ye farklı yardımcı alan eklemek aynı oturumu bağımsız yapmaz. |
| Boş/negatif/kesirli/NaN/sonsuz sayılar; eksik session/page/REST/interaction bilgileri erken kontrol edilmiyordu. | Pozitif güvenli tamsayı, HTTPS origin, secure cookie ve tam fixture doğrulaması init/preflight aşamasında. Interaction UUID'leri agent ve round boyunca benzersiz; 5 farklı sayfa ve 3 farklı REST source gerekli. |
| HTTP çağrıları production SPA edge'in `/api/` yolunu atlıyordu. | Varsayılan API base HTTPS origin + `/api`; websocket/Origin ayrı bare origin. Onaylı direkt API ingress için explicit prefix override. |
| Rapor hedeflenen interaction sayısını gerçekleşmiş gibi veriyor, profile metni sürekli 5000/20 diyordu. | Expected/observed ayrı; gerçek sayaçlar, parametreler ve her threshold sonucu raporlanır. Eksik metrik/threshold, yarım iteration veya başarısız check ile accepted=false. |
| Executor deadline her soak süresinde 65m idi. | İstenen süre +300s; tamamlanan iteration sayısı da zorunlu threshold. 2 saat için 7500s. |

Tam fixture taraması SharedArray kurucu callback'inde bir kez yapılır; her VU için bütün kullanıcı listesi tekrar taranmaz. Core socket hedef varsayılanı 2000; vendor interaction profili tarihsel 5000 hedefini korur. Her iki profil yalnız hazırlanmış güvenli staging fixture'i ile çalıştırılmalı.

Read-only CLI: `node scripts/k6-preflight.mjs socket` veya `interaction`. Private fixture repository dışında, chmod 600 ve en fazla 100 MiB olmalı. CLI ağ isteği göndermez; kimlik/cookie/CSRF/dosya yolu yazdırmaz. Kimliklerin gerçekten yetkili veya session'ın active olduğunu preflight kanıtlamaz; gerçek ticket/launch akışı bu kontrolleri korur. Fixture örneği kasıtlı placeholder içerir ve doğrudan kullanılamaz.

## Bu turda yürütülen kontroller

- Mevcut hatalı doğrulama/rapor mantığı framework-free modüle çıkarılıp regresyonlar önce çalıştırıldı: **18 başarısız / 4 başarılı**. Edge prefix için ayrı önce test: **1 başarısız / 28 başarılı**. İlk/son loglar saklandı.
- Son load fixture/summary/preflight suite: **37/37**, skip yok. 2000 benzersiz fixture kimliği ve son satır duplicate testi yalnız input doğrulamasıdır; 2000 canlı oturum oluşturulmadı.
- Gerçek kurulu **k6 v2.2.0** ile iki tam workload'un init/options kontrolü geçti. mTLS init için dış geçici dizinde üretilmiş self-signed test kimliği kullanıldı; staging'de trusted değil, ağ bağlantısı yapılmadı, dosyalar temizlendi.
- İki VU'lu offline k6 metric harness: tam sayaçlar/threshold'lar exit 0 ve accepted=true; eksik bağlantı sayımı exit **99** ve accepted=false. Bunlar ağ, uygulama performansı, SSO veya socket handshake testi değildir.
- `pnpm test:policy`: **42/42**; 37 yeni kontrol + 5 mevcut policy kontrolü, tekrarlar benzersiz başarı toplamına eklenmedi. CI policy komutuna yeni kontroller eklendi. k6 olmayan ortamlarda 3 k6 kontrolü explicit skip olur; bu yerel koşuda üçü de yürüdü.
- Değişen JS/MJS dosyaları lint geçti. k6 globals için ilk lint CLI'da yanlış `:readonly` biçimi no-undef verdi; `--global __ENV --global open` ile k6 ortamı tanımlandı ve geçti. Ürün güvenlik/threshold kapıları gevşetilmedi.

Kanıt: `evidence/load-acceptance-20261005/confirmed.log`, `policy.log`, `before.log`, `edge-before.log`, `lint.log` ve kaynak/log SHA-256 manifesti. Önceki API/Agent geniş testleri bu turda tekrar çalıştırıldı diye sunulmaz; değişiklikler yalnız yük testleri, tooling ve ilgili dokümanlarda.

## Kalan gerçek kabul

1. Aynı release digest ile izole staging kurulumu, SSO ve normal secure launch üzerinden 2000 ayrı aktif agent/session; oturum/lease/idle ömrü ve kapasite ayarları. Socket soak en az 60 dakika, generator ve cluster CPU/memory/network/DB pool ölçümleriyle birlikte.
2. Core karma page/REST workload, render/latency/error ölçümleri; instance/process kaybı ve reconnect/expression budget kabulü. Mevcut socket soak tek başına bu kapıları kapatmaz.
3. Durable ACK/replication/zero-loss kapsamı, backup restore + encryption key/audit doğrulaması; clean install/upgrade/rollback ve bağımsız güvenlik kabulü.

Vendor interaction profili core kapalı hub/simulator profili için kullanılmaz. Production SPA edge mTLS header'larını siler; vendor profili ileride onaylı service-authenticated ingress ve simulator ACK gözlemi gerektirir. Güvenli ingress değiştirilmedi veya bypass edilmedi. Genel canlı/SLA/Awaken üstünlük kanıtı verilmedi.

K6 summary/executor sözleşmeleri resmî [custom summary](https://grafana.com/docs/k6/latest/results-output/end-of-test/custom-summary/) ve [per-VU iterations](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/per-vu-iterations/) kaynaklarıyla kontrol edildi. Çalıştırma yönergesi: `docs/ops/PERFORMANCE.md`.
