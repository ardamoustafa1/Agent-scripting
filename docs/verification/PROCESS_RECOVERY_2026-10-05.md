# Enterprise Core — gerçek API süreç kaybı ve yarışan yazma

Tarih: 2026-10-05. Sonuç: **yerel, gerçek PostgreSQL/Redis/NATS üzerinde üç yeni ayrı-process senaryosu geçti.** Genel production, HA/SLA veya 2000 eşzamanlı agent kapasitesi kabulü değildir. Bu turda production uygulama kodunda yeni hata bulunmadı; davranış koruması testlerle güçlendirildi.

## Önceki kanıttan farkı

Önceki recovery testi aynı Node process içindeki iki Nest instance'ı kullanıyordu. Yeni yardımcı mevcut API kaynaklarını TypeScript project build ile derler, gerçek Node child process açar ve compiled Nest/Fastify API'yi yalnız `127.0.0.1` üzerinde dinletir. İstekler gerçek HTTP üzerinden gönderilir. Kimlik/config yalnız test IPC kanalında taşınır; process logları/config/tokens yazdırılmaz. Child PID'leri test runner'dan farklıdır. SIGKILL sonucu gerçekten `SIGKILL` olarak kontrol edilir; `app.close`, shutdown flush veya graceful drain kullanılmaz. Test sonunda oluşturulan tüm child process'ler temizlenir; parent kaybında IPC disconnect worker'ı kapatır.

## Üç yeni senaryo

1. **HTTP ACK → SIGKILL → yeni PID, sıcak cache korunur:** ayrı API süreci persist=true runtimeCounter=42 ve şifreli PII runtimeCustomer için 201 ACK/sequence 3 ve 4 döndürür. Süreç SIGKILL ile kapatılır. Yeni süreç sequence=4, active state ve iki değeri geri okur. Writer lease yeniden attach edilir; eski expectedSequence=2 ile değişiklik 412 olarak reddedilir, doğru sequence=4 ile değer 43 kabul edilir ve sequence=5 olur.
2. **Aynı akış, cache kaydı kaybı:** ilk süreç kapandıktan sonra yalnız bu session'ın Redis hot snapshot kaydı silinir. Yeni süreç encrypted PostgreSQL snapshot'ından aynı durable değerleri okur. Bu, Redis servisinin tamamen kaybı veya partition testi değildir; PostgreSQL/Redis/NATS servisleri çalışır durumda kalır.
3. **İki ayrı API süreci / aynı revision:** iki farklı child process aynı session'a expectedSequence=2 ile 21/22 değerlerini eşzamanlı gönderir. Yanıtlar tam olarak 201/412; durable kazanan yalnız biri, sequence=3, seq=3 event yalnız bir adet ve runtime outbox toplamı üç olur. İki süreç kapatılıp hot cache silindikten sonra kazanan değer durable kayıttan tekrar okunur.

İlk iki senaryoda başka tenant/admin aynı runtime state'i okuyamaz (403/404). DB'de sequence 1–5 event'leri tam ve tektir; runtime outbox beş kayıt içerir. Üç başarılı field değişiminin üç başarılı audit kaydı bulunduğu, her kaydın yeniden hesaplanan hash'inin stored hash ile eşleştiği kontrol edilir. PII snapshot DB'de plaintext değildir; event/outbox/audit'te sentetik müşteri değeri görünmez. Yarışma senaryosunda başarılı field audit yalnız bir adet ve hash doğrulaması geçer. Bunlar audit anchor/backup restore tatbikatı yerine geçmez.

## Yürütülen doğrulama

| Kontrol | Sonuç | Kanıt |
| --- | --- | --- |
| Tam API unit + integration + coverage | **1836/1836**, 146 dosya, 79.31s | `api-full.log`; üç yeni ayrı-process testi dahil |
| Son supplemental audit count/hash kontrolleriyle runtime + authoring + RLS | **42/42**, üç dosya, 24.40s | `integration-final.log`; final test kaynağı |
| API typecheck | Başarılı | `typecheck-final.log` |
| Değişen üç test/helper dosyası lint/format | Başarılı | `lint-final.log`, `format.log` |

Full API coverage: statement %90.80, branch %85.67, function %88.74, line %92.94; kapılar değiştirilmedi. Full koşudan sonra mevcut üç process testine audit count/hash assertion'ları eklenip son üç dosyalı 42/42 koşuda tekrar doğrulandı; full suite'in daha güçlü supplemental assertion'larla yeniden çalıştırıldığı iddia edilmez. Tekrarlar benzersiz test toplamına eklenmez.

İlk runtime koşusu 6 başarılı/2 başarısız: yeni test stale command için yanlış 409 bekliyordu. Mevcut sözleşme VersionMismatchError → **412**; beklenti düzeltildi, production kodu değiştirilmedi. İlk lint üç test-helper stil/type assertion hatası bildirdi; düzeltildi ve tekrar geçti. Başarısız loglar saklandı. Sahte başarı, gecikme toleransı artışı veya güvenlik kontrolü bypass'ı yapılmadı.

Kanıt dizini: `docs/verification/evidence/process-recovery-20261005/`; kaynak, compiled runtime modülleri ve log SHA-256 manifesti eklenir.

## Sınırlar ve kalan kabul

- Session setup mevcut test fixture'ıyla oluşturulmuş **preview session**, authorization test internal JWT + sid'dir. Gerçek müşteri SSO login veya vendor secure launch acceptance'ı değildir; public session-create/bare URL launch endpoint eklenmedi.
- Ayrı process'ler aynı makinede, real test container servisleriyle çalışır. Kubernetes node kaybı, çok-host network partition, PostgreSQL failover/quorum, Redis cluster kaybı veya bölgesel felaket ölçülmedi.
- Kanıt HTTP ile onaylanmış iki persist=true runtime alanının API process kaybında kurtarılmasıdır. PCI/non-persist ephemeral değerler, bütün script/config/campaign/audit backup kapsamı veya uçuş halindeki onaylanmamış istekler için sıfır kayıp beyanı değildir.
- İlk core profile'da kapalı collaboration, dış/vendor ve canlı AI bu kabulün içinde sunulmaz.
- Kalan gerçek kapılar: aynı release digest ile staging clean-install; 2000 ayrı session karma REST/render/socket soak; load altında process loss/reconnect/expression budget; durable ACK/replication/RPO/RTO kapsamı; backup + encryption key/audit restore; upgrade/rollback ve bağımsız güvenlik kabulü.

Mevcut development servisleri ve müşteri verisi değiştirilmedi. Yeni production deploy/commit/publish yapılmadı.
