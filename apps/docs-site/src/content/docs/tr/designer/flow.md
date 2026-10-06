---
title: "Flow tasarımı"
---

Flow sayfaların hangi sırada açılacağını belirler. Entry/start düğümünden başlayın; her sayfa,
karar, action, servis ve subflow için edge tanımlayın. Karar kollarında öncelik/varsayılan kolu
belirgin olsun; sınırsız loop oluşturmayın. Servis timeout/error kolu agent’ı çıkmazda bırakmasın.

![Sayfa, servis ve kararın şematik akışı](/guides/flow-tr.svg)

Subflow ortak operasyonu kapsüller; giriş/çıkış değişkenlerini tanımlayın. Ortak ekran kitabından
sayfayı linked sürüm olarak pinleyebilir veya detached copy alabilirsiniz. Linked ortak ekranı
iki veya daha fazla kampanyanın scriptinde kullanın; paylaşılan sürüm değişince mevcut yayınlanmış
scriptlerin pin’leri kendiliğinden değişmez. Yeni sürümü inceleyip tekrar yayınlayın.

Validate paneli eksik referans, ulaşılamayan düğüm/sayfa ve schema hatalarını gösterir. Runtime
kullanıcının URL’sinden flow seçmez; server seçilmiş/pinlenmiş document’i yürütür.
