---
title: "Avaya AXP"
---

Adapter kind: `workspaces`.

AXP Workspaces widget’ı approved HTTPS originlerde bundle edin. Workspace identity ve server verifier bağını kurun. Native wrap-up eşlemesi ve kanal izinlerini doğrulayın; genel attribute write-back ilan edilmez.

## Kurulum adımları

1. Vendor lisansı, API/SDK sürümü, kanal izinleri ve test tenant’ını hazırlayın; destek matrisi yalnız kodun ilan ettiği capability’dir.
2. Verbis admin’de adapter/kind config’i oluşturun. Vendor auth ve NATS credentials yalnız Secret store referansı olsun.
3. Yukarıdaki vendor kurulumunu ve [ortak bridge kurulumunu](/tr/connectors/setup/) tamamlayın. Hub/bridge için farklı tenant-scoped TLS/NATS yetkisi verin.
4. External queue/skill/campaign ID’lerini Verbis kampanyasına map edin; connector event’i campaign UUID seçmez. Agent platform ID’lerini doğrulanmış Verbis kullanıcılarıyla eşleyin.
5. Transfer, end, stale participant, duplicate event/command ve wrap-up senaryolarını izole sandbox’ta kabul edin; başarısız verifier launch’ı kapatır.

Örnek Secret UUID/domain değerlerini gerçek tenant referanslarıyla değiştirin. [Kaynak kurulum notları](/connector-source/avaya.md). Lisanslı SDK/auth facade ve gerçek vendor sandbox kabulü production ön koşuludur; testler bu oturumda çalıştırılmadı.
