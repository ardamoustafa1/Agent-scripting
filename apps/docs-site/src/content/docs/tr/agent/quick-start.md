---
title: "Agent kısa rehberi"
---

1. SSO ile giriş yapın; yetkili kampanyanızı ve connection durumunu kontrol edin.
2. Çağrı/chat geldiğinde güvenli launch teklifini kabul edin. Uygun ekran otomatik seçilir.
3. Zorunlu metni okuyup işaretleyin, alanları doldurun ve İleri ile ilerleyin. Salt okunur/çevrimdışı
   uyarısında komut tekrar göndermeyin; bağlantının dönmesini bekleyin.
4. Görüşme sonunda sonucu seçin, gerekiyorsa notu yazın ve wrap-up’ı tamamlayın. Write-back sonucu
   başarısızsa supervisor’a gösterin; aynı işlemi farklı pencereden tekrar yapmayın.

![Güvenli çağrıdan wrap-up’a şematik görünüm](/guides/agent-tr.svg)

| Kısayol | Davranış |
| --- | --- |
| Ctrl + / | Yardım/kısayol paneli |
| Alt + Sol ok | Önceki sayfa |
| Enter | İleri; aktif ve çevrimiçi oturumda, uygun focus bağlamında |
| Tab / Shift + Tab | Alanlar arasında ileri/geri focus |

Enter textarea, dialog, combobox veya buton/link focus’unu ele geçirmez. Input doğrulaması veya
mustRead tamamlanmadan ilerleme engellenebilir. URL’ye müşteri/script/kampanya ID’si eklemek launch
yetkisi vermez; bir başkasının session linkini kullanmayın. Gerçek ekran görüntüsü capture kabulü bekler.
