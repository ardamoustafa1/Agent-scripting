---
title: "Demo hazırlığı"
---

İzole yerel development veritabanında `pnpm seed:demo` çalıştırın. Bu komut başka tenantları
silmez/güncellemez, üretim/uzak DB’yi reddeder ve var olan demo bundle’ını yeniden yazmaz.
Demo kullanıcıları example.invalid adresleri ve fixture kimlikleri kullanır; parola/token oluşturmaz.
SSO girişlerini kendi demo IdP’nizde eşleyin. Dört kampanya: kredi kartı, tarife, tahsilat, anket.

Kaynaklar mock’tur; servis çağrısında gerçek müşteriye veya production sisteme bağlanılmaz.
Admin simülatöründe `demo-agent-1` ve demo queue seçin; autoConnect veya Connect ile çağrıyı ilerletin.
Hazır senaryolar `prisma/demo/scenarios.json` içindedir. Kodun bu oturumda çalıştırılması yapılmadı.
Analitikte DEMO_DATE ve önceki altı günü seçin; sentetik completed/abandoned sonuçlarını gösterin.
3 dakikalık konuşma ve aksiyon akışı repodaki `docs/DEMO.md` dosyasındadır.
