---
title: "Kurallar ve expression dili"
---

## Veri dili, JavaScript değil

Root context alanları runtime tarafından sağlanır; expression içine kod, token veya secret yazılmaz.
`vars.limit > 0 ? formatCurrency(vars.limit, "tr", "TRY") : "—"` gibi saf ifadeler kullanın. Eksik property `null`
olur; eksik root identifier hatadır. Nullable her adımda `?.` ve varsayılan için `??` kullanın.

```text
vars.eligible && between(vars.score, [50,100])
session.customer?.segment ?? "standard"
sum(vars.items, item => item.amount)
```

Aritmetik sayı tipleriyle çalışır; string toplama yalnız iki string için birleştirme yapar. Mantık
ve `if`/`switch` kısa devre yapar. Tek parametreli lambda yalnız collection fonksiyonlarında geçerlidir.
Tüm fonksiyonlar, tip/argüman sayıları ve örnekleri [fonksiyon referansında](/tr/designer/functions/).

## Builder kuralları

```json
{"all":[{"fact":"vars.eligible","op":"eq","value":true},{"fact":"vars.score","op":"gte","value":50}]}
```

AND/OR/NOT gruplarını ayrı kararlar için kullanın. Builder’ın temsil edemediği geçerli ifadeler
`$expr` yaprağı olarak korunur. UI görünürlük kuralı yetkilendirme yerine geçmez.

## Sınırlar ve hata davranışı

En fazla 2.000 kaynak karakteri, derinlik 32, 10.000 adım, 50 ms, container başına 1.000 eleman ve
64 KiB çıktı; limitler yalnız daraltılabilir. `now()` saatini host enjekte eder; enjekte edilmezse
Unix epoch döner. Tarihler ISO date veya açık UTC `Z` olmalıdır. `formatCurrency` TR/EN için
belirlenmiş ayraçları kullanır. Regex RE2 tabanlıdır; lookaround/backreference kullanmayın.
Validatörler biçim/checksum denetler, kimlik veya banka hesabını teyit etmez. Hata kolu tanımlayın.
