# Kurumsal canlı kullanım kararı — 2026-10-05

## Karar

**Yeni kapsam notu:** Kullanıcının sonraki yedi başlıklı gereksinimleriyle ilk release'te real-time collaboration zorunlu olmaktan çıktı. [Enterprise Core kapsamı](ENTERPRISE_CORE_REQUIREMENTS_2026-10-05.md) ve kapalı feature kurulum profili geçerlidir. Aşağıdaki collaboration hata/failover maddeleri ancak bu özellik sunulursa release kapısıdır; core runtime kapasite, sıfır durable veri kaybı, restore ve üretim topolojisi kapıları devam eder.

**Genel kurumsal canlı kullanım onayı: VERİLMEDİ.** Dış entegrasyonlar ve canlı AI kapsam dışında tutulduğunda da bu karar değişmez. Mevcut kanıtlar çalışır bir ürün, kapsamlı yerel işlev testleri ve teknik demo için yeterli temel gösterir. Bunlar büyük bir müşterinin kritik üretim operasyonunu, hizmet seviyesini veya tüm olası durumlarda doğru davranışı tek başına kanıtlamaz.

Ürün teknik demo ve kapsamı açık bir pilot teklifi için sunulabilir. Pilotun kendisi test ortamında, sentetik/uygun şekilde onaylanmış veriyle ve açık kabul kriterleriyle yürütülmelidir. Bu rapor sözleşme, sertifikasyon veya Apple'ın tedarikçi kabulü hakkında hüküm değildir. Müşterinin ölçeği, kritik kullanım biçimi ve güvenlik gereksinimleri belirlenmeden ticari canlı kabul verilmez.

## Bu turdaki yeni yürütme kanıtları

| Kontrol | Sonuç | Sınır |
| --- | --- | --- |
| İç güvenlik birim testleri | **44/44** | Consent şeması, UI güvenliği, component SDK, privacy, rate limit/JSON, runtime cipher/state ve session-cookie; bağımsız pentest değildir. |
| Gerçek API/PostgreSQL/Redis/NATS entegrasyonu | **57/57**, dört dosya | Runtime yarışan yazmaları/ikinci tab fencing/tenant erişimi/PII/rollback; authoring/yayın/yönlendirme; audit zinciri/bozulma tespiti/izin; privacy tenant izolasyonu. İzole Testcontainers ortamı. |
| Dağıtım güvenlik politikası | **11/11** | Helm render ve script güvenlik testleri; gerçek cluster kurulumu, kesinti veya restore tatbikatı değildir. |
| Yerel audit throughput / concurrent writer | **2/2**; 100.000 olay / 1,95s = **51.235 olay/s** | Gerçek PostgreSQL, runtime rolü, sekiz tenant ve 500'lük batch; zincir/hash ve aynı tenant'taki 20 eşzamanlı writer kontrolü. 5.000 aktif agent veya uçtan uca API/SLA kabulü değildir. |
| Bağımlılık güvenliği | Raw **2 high, 0 critical**; doğrulanmış yama sonrası çözümsüz high/critical **0** | extract-zip yerel yaması/config/hash/saldırı regresyonu geçti; istisna 2026-11-03'e kadar geçerli. Diğer severity'lerin sıfır olduğu iddia edilmez. |

Loglar: [security-unit](evidence/enterprise-readiness-20261005/security-unit.log), [internal-integration](evidence/enterprise-readiness-20261005/internal-integration.log), [deployment-policy](evidence/enterprise-readiness-20261005/deployment-policy.log), [dependency-security](evidence/enterprise-readiness-20261005/dependency-security.log), [audit-throughput](evidence/enterprise-readiness-20261005/audit-throughput.log).

En güncel editör kanıtı ayrı turda son kodla **341/341 birim**, **200/200 Chromium**, **3/3 seçilmiş gerçek ürün senaryosu**: [scripting mantık denetimi](SCRIPTING_LOGIC_AUDIT_2026-10-05.md). Eski 4.996 paket toplamı yeni sonuçlara eklenerek yeni tam ürün koşusu gibi sunulmaz.

## Kapsam içindeki canlı kabul engelleri

| Öncelik | Bulgu / kanıt açığı | Kapatılma kriteri |
| --- | --- | --- |
| P0 | Ortak düzenlemede daha önce iki tam gerçek ürün koşusunda peer güncellemesi gelmedi. Sonraki koşular geçti fakat kök neden düzeltmesi yok. | Başarısız sıra tekrar üretilebilmeli; uygulama düzeltmesi ve regresyonu; çok kullanıcı edit, disconnect/reconnect, flush/reload, çakışma ve owner kaybında belge kalıcılığı. Son geçiş önceki aralıklı hatayı otomatik kapatmaz. |
| P0, yüksek erişilebilirlik taahhüdü için | Collaboration tek document owner/replica ve Recreate. Otomatik lider devri ve kesintisiz owner failover uygulanmış değil. | Hedef topolojide owner kaybı, yeniden bağlanma ve doğrulanmış kalıcılık; uygulanan failover veya müşteriyle kabul edilmiş kesinti/yeniden bağlantı sınırı. |
| P0, üretim terfisi için | Hedef ortamda doğrulanmış backup restore, audit anahtarları/anchor doğrulaması ve ölçülmüş RPO/RTO yok. | İzole geri dönüş tatbikatı; verinin tenant bütünlüğü, en son kayıtlar ve audit zinciri; UTC zamanlarıyla ölçülmüş kayıp/toparlanma. |
| P0, kapasite/SLA taahhüdü için | 5.000 aktif agent/API/socket soak ve üretim edge açılış ölçümlerinin tamamlanmış raporu yok. SLO belgesi hedef; 99,95% veya p95 <1s gerçekleşmiş garanti değil. | Beklenen eşzamanlı agent/editör/tenant profili; hedef donanımda uzun süreli yük, p95/p99, hata, bellek, kuyruk, reconnect ve kapasite payı. Yerel audit throughput bu ölçümün yerine geçmez. |
| P0, üretim terfisi için | Gerçek üretim kurulum/upgrade/rollback, migration ve edge TLS/CSP/cookie/egress kabulü tamamlanmış değil. Önceki ürün turları bunları kapsam dışında tutmuştu. | Digest'e sabitlenmiş aynı release üzerinde hedef staging kurulumu; doğru runtime DB rolü; mevcut veriyle migration/rollback, sır yönetimi ve network policy negatif testleri. |
| Müşteri güvenlik kapısı | Bağımsız pentest ve müşteri güvenlik incelemesinin kabulü yok. ASVS checklist maddelerinin büyük kısmı inceleme bekliyor. | Müşterinin kabul ettiği kapsamda bağımsız inceleme; açık kritik/yüksek bulguların kapatılması ve yeniden test. Sertifika/uyumluluk beyanı test sayısından çıkarılmaz. |
| Gereksinime bağlı | ASVS L3 hedefindeki crypto isolation açığı: keyring/tenant KEK uygulama belleğinde. | Müşteri bu izolasyon düzeyini istiyorsa Vault/HSM transit adapter ve rotasyon/kesinti testleri. Bu gereksinimin her müşteride zorunlu olduğu varsayılmaz. |

Kaynaklar: [ortak düzenleme bulgusu](AWAKEN_FULL_AUDIT_2026-10-05.md), [son ortak düzenleme sınırı](SCRIPTING_LOGIC_AUDIT_2026-10-05.md), [kurulum/topoloji](../ops/INSTALL_ONPREM.md), [rollout](../ops/ROLLOUT.md), [DR](../ops/DR.md), [performans](../ops/PERFORMANCE.md), [SLO](../ops/SLO.md), [ASVS](../security/ASVS_CHECKLIST.md).

## Yayın için somut kabul sırası

1. Satılacak release ve kapsamı sabitle; hangi özelliklerin açık olacağını belirt. Dış entegrasyon/AI için bu rapordan kabul çıkarma.
2. Ortak düzenleme aralıklı hatasını kök neden ve regresyonla kapat veya ilk satılacak kapsamda özelliği açıkça hariç tut. Sessizce hatayı yok kabul etme.
3. Müşteri ölçeğini temsil eden staging'de yük/soak, owner kaybı ve yeniden bağlantı senaryolarını çalıştır.
4. Backup restore ve upgrade/rollback tatbikatlarıyla kalıcılık ve toparlanmayı doğrula.
5. Bağımsız güvenlik değerlendirmesi, erişim matrisi ve operasyon sorumluluklarını müşteri kriterleriyle kabul ettir.
6. Kapsamı sınırlı pilotta gerçek kullanıcı kabulü ve ölçülmüş sonuçları kaydet; canlı terfi kararını aynı release ve kanıtlarla ver.

Hedef üretim ortamı veya müşteri ölçeği mevcut yerel çalışma alanından varsayılıp doldurulmadı; hiçbir dağıtım veya müşteri verisi işlemi yapılmadı.
