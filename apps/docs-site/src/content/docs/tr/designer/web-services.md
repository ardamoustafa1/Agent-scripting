---
title: "Web servis entegrasyonu"
---

1. Entegrasyon yetkilisi REST, SOAP veya GraphQL kaynağını oluşturur. Base URL/endpoint tenant
   allow-listesine uygun olur; private IP, redirect ve credential query string’lerini kullanmayın.
2. Input/output JSON Schema, request/response mapping ve mock success/empty/error/delay senaryolarını
   tanımlayın. Response mapping yalnız schema içindeki alanları çıkarır; secret değerini map etmeyin.
3. Kimlik bilgisini Secret store’a yazın; tanım yalnız Secret UUID referansı taşır. Browser secret almaz.
4. Timeout, retry, concurrency, breaker ve cache limitlerini belirleyin. PII için cache kapalı/izole
   politikayı kullanın; alan sınıflandırması ve redaction paths ekleyin.
5. Designer’da kaydedilmiş datasource ID + sürüm pin’ini seçin. `inputs` ifadelerini ve output→variable
   eşlemesini yapın. Servis düğümüne error kolu ve kullanıcının tekrar deneyebileceği yolu bağlayın.
6. Mock preview ile önce başarılı/hatalı mapping’i kontrol edin. Live test yalnız dev/test profiline
   ve execute yetkisine izin verir. Prod profil terfisini farklı bir yetkili onaylar.

Demo seed’i tüm örnek kaynakları `mock.enabled=true` ile oluşturur; DNS erişilemeyen `.invalid`
endpointleri dış çağrıya dönüşmez. Runtime mock davranışı bir production servisi değildir.
Idempotency gerektiren ödeme/sipariş/write-back işleminde retry’den önce upstream anahtarını belirleyin.
