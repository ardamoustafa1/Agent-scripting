---
title: "İlk scriptim"
---

## 1. Taslağı oluşturun

SSO ile Designer’a girin; `script_designer` rolünüz olmalı. Script listesinde **Yeni script** seçin,
adı **İlk Teklifim**, dili **Türkçe**, kanalı **Voice** yapın. İlk sürümü oluşturun. Sol palet,
ortadaki canvas ve sağ özellik paneli aynı taslağı düzenler.

![Canvas ve üç panelin şematik görünümü](/guides/designer-layout-tr.svg)

_Görsel şematiktir; gerçek ekran görüntüsü değildir. Gerçek capture komutu docs-site README’dedir._

## 2. Ekranı yerleştirin

Karşılama sayfasına `heading`, `scriptText`, `textInput` ve `nextButton` sürükleyin. Keyboard yolu
olarak paletin **Ekle** eylemini de kullanabilirsiniz. `textInput.value` alanını `customerAlias`
adında public/session değişkenine iki yönlü bağlayın. Gerçek müşteri adı için public yerine PII
sınıflandırması seçin. TR ve EN mesaj anahtarlarını birlikte doldurun; literal müşteri verisi yazmayın.

## 3. Kural ve web servis ekleyin

`eligible` boolean değişkeni oluşturun. Kural builder’da `vars.eligible == true` koşulunu seçin.
Entegrasyonlar bölümünde kaydedilmiş **mock** REST servisini seçin; sürüm numarasını pinleyin,
response alanını değişkene map edin. Önizleme dış sisteme istek göndermez. Test çağrısı için ayrıca
onaylı sandbox profili gerekir. [Web servis rehberi](/tr/designer/web-services/).

## 4. Flow’u bağlayın

Karşılama → servis çağrısı → karar → Teklif / Alternatif → Bitiş düğümlerini bağlayın. Kararın
her iki kolunu, servis hata kolunu ve dönüş yolunu tanımlayın. Ekran sayfasındaki İleri butonu
flow’un next eylemini kullanır. [Flow rehberi](/tr/designer/flow/).

## 5. Önizleyin, onaylayın, yayınlayın

Doğrulama panelindeki hataları düzeltin; uygun/uygun değil ve servis hata fixture’larını deneyin.
Salt mock preview gerçek çağrı veya write-back üretmez. Değişiklik notu ve semver ile incelemeye
gönderin. Ayrı `script_approver` kullanıcı onaylasın; yetkili kullanıcı yayınlasın. Kampanya yöneticisi
yayınlanmış sürümü kampanyaya atasın. [Test ve yayın](/tr/designer/testing-publishing/).

İlk gerçek ekranı script ID içeren URL ile açmayın: admin simülatöründen çağrı başlatın, doğru agent
hesabında güvenli launch teklifini kabul edin. Tenant, assignment, güncel katılımcı ve tek kullanımlık
kod backend tarafından doğrulanır.
