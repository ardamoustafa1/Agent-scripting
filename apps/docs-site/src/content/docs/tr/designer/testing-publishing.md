---
title: "Test, onay ve yayın"
---

- Taslağı schema + semantic validation’dan geçirin; TR/EN alanlarını, keyboard ve ışık/koyu temayı inceleyin.
- Mock senaryolarıyla olumlu/olumsuz karar, boş response, timeout ve servis error kolunu deneyin.
- Preview ayrı session türüdür; gerçek interaction, connector komutu veya production write-back değildir.
- Değişiklik notu ve semver ile submit edin. Review round değişince eski onay yeni revizyonu onaylamaz.
- Tasarlayan ile onaylayan görevlerini ayırın. Yayın checksum ile pinlenir; agent oturumları başladıkları sürümü korur.
- Campaign manager Assignment’ta pinned veya latestPublished politikasını, channel/locale/queue/skill koşullarını ve priority’yi ayarlar.
- Simülatör→agent→wrap-up kabulünü izole demo ortamında tamamlayın; başarısız write-back kuyrukta görünür ve idempotent yeniden denenir.

Önceki sürüme dönüş de yetkili, audit’li bir yayındır. Yeni sürüm mevcut agent’ın document’ini sessizce değiştirmez.
