---
title: "Expression fonksiyonları"
---

Bu liste expression registry’den üretilir; örneklerin doğrulanması test koduna aittir. JavaScript çalıştırılmaz. `now()` örneği için saat 2026-10-03T09:00:00Z olarak enjekte edilir.

## upper

`upper(string) → string` · 1–1 argüman

```text
upper("verbis")
```

Sonuç: `"VERBIS"`

## lower

`lower(string) → string` · 1–1 argüman

```text
lower("VERBIS")
```

Sonuç: `"verbis"`

## trim

`trim(string) → string` · 1–1 argüman

```text
trim("  demo  ")
```

Sonuç: `"demo"`

## contains

`contains(unknown, unknown) → boolean` · 2–2 argüman

```text
contains([1,2,3], 2)
```

Sonuç: `true`

## startsWith

`startsWith(string, string) → boolean` · 2–2 argüman

```text
startsWith("demo-script", "demo")
```

Sonuç: `true`

## format

`format(string) → string` · 1–32 argüman

```text
format("Hello {0}", "Demo")
```

Sonuç: `"Hello Demo"`

## mask

`mask(string, number, string) → string` · 1–3 argüman

```text
mask("DEMO-REF", 3)
```

Sonuç: `"*****REF"`

## padStart

`padStart(string, number, string) → string` · 2–3 argüman

```text
padStart("7", 3, "0")
```

Sonuç: `"007"`

## round

`round(number, number) → number` · 1–2 argüman

```text
round(12.345, 2)
```

Sonuç: `12.35`

## formatCurrency

`formatCurrency(number, string, string) → string` · 1–3 argüman

```text
formatCurrency(1500, "tr", "TRY")
```

Sonuç: `"1.500,00 ₺"`

## now

`now() → string` · 0–0 argüman

```text
now()
```

Sonuç: `"2026-10-03T09:00:00.000Z"`

## addDays

`addDays(string, number) → string` · 2–2 argüman

```text
addDays("2026-10-03", 2)
```

Sonuç: `"2026-10-05T00:00:00.000Z"`

## diff

`diff(string, string, string) → number` · 2–3 argüman

```text
diff("2026-10-05", "2026-10-03", "days")
```

Sonuç: `2`

## formatDate

`formatDate(string, string) → string` · 1–2 argüman

```text
formatDate("2026-10-03", "dd.MM.yyyy")
```

Sonuç: `"03.10.2026"`

## isBusinessDay

`isBusinessDay(string, array) → boolean` · 1–2 argüman

```text
isBusinessDay("2026-10-05", [])
```

Sonuç: `true`

Doğrulama yalnız biçim/checksum denetimidir; gerçek kişi, hesap veya telefon doğrulaması değildir.

## age

`age(string, string) → number` · 1–2 argüman

```text
age("2000-01-01", "2026-10-03")
```

Sonuç: `26`

## count

`count(array) → number` · 1–1 argüman

```text
count([1,2,3])
```

Sonuç: `3`

## sum

`sum(array, unknown) → number` · 1–2 argüman

```text
sum([{amount:10},{amount:20}], x => x.amount)
```

Sonuç: `30`

Lambda yalnız bu fonksiyonun izin verilen collection argümanında kullanılabilir.

## filter

`filter(array, unknown) → array` · 2–2 argüman

```text
filter([1,2,3], x => x > 1)
```

Sonuç: `[2,3]`

Lambda yalnız bu fonksiyonun izin verilen collection argümanında kullanılabilir.

## map

`map(array, unknown) → array` · 2–2 argüman

```text
map([1,2], x => x * 2)
```

Sonuç: `[2,4]`

Lambda yalnız bu fonksiyonun izin verilen collection argümanında kullanılabilir.

## find

`find(array, unknown) → unknown` · 2–2 argüman

```text
find([1,2,3], x => x > 1)
```

Sonuç: `2`

Lambda yalnız bu fonksiyonun izin verilen collection argümanında kullanılabilir.

## any

`any(array, unknown) → boolean` · 2–2 argüman

```text
any([1,2], x => x > 1)
```

Sonuç: `true`

Lambda yalnız bu fonksiyonun izin verilen collection argümanında kullanılabilir.

## all

`all(array, unknown) → boolean` · 2–2 argüman

```text
all([1,2], x => x > 0)
```

Sonuç: `true`

Lambda yalnız bu fonksiyonun izin verilen collection argümanında kullanılabilir.

## isEmail

`isEmail(string) → boolean` · 1–1 argüman

```text
isEmail("demo@example.invalid")
```

Sonuç: `true`

Doğrulama yalnız biçim/checksum denetimidir; gerçek kişi, hesap veya telefon doğrulaması değildir.

## isPhoneTR

`isPhoneTR(string) → boolean` · 1–1 argüman

```text
isPhoneTR("invalid")
```

Sonuç: `false`

Doğrulama yalnız biçim/checksum denetimidir; gerçek kişi, hesap veya telefon doğrulaması değildir.

## isTCKN

`isTCKN(string) → boolean` · 1–1 argüman

```text
isTCKN("invalid")
```

Sonuç: `false`

Doğrulama yalnız biçim/checksum denetimidir; gerçek kişi, hesap veya telefon doğrulaması değildir.

## isIBAN

`isIBAN(string) → boolean` · 1–1 argüman

```text
isIBAN("invalid")
```

Sonuç: `false`

Doğrulama yalnız biçim/checksum denetimidir; gerçek kişi, hesap veya telefon doğrulaması değildir.

## isVKN

`isVKN(string) → boolean` · 1–1 argüman

```text
isVKN("invalid")
```

Sonuç: `false`

Doğrulama yalnız biçim/checksum denetimidir; gerçek kişi, hesap veya telefon doğrulaması değildir.

## luhn

`luhn(string) → boolean` · 1–1 argüman

```text
luhn("invalid")
```

Sonuç: `false`

Doğrulama yalnız biçim/checksum denetimidir; gerçek kişi, hesap veya telefon doğrulaması değildir.

## regexTest

`regexTest(string, string, string) → boolean` · 2–3 argüman

```text
regexTest("demo-42", "^demo-[0-9]+$")
```

Sonuç: `true`

## if

`if(unknown, unknown, unknown) → unknown` · 3–3 argüman

```text
if(true, "yes", "no")
```

Sonuç: `"yes"`

## switch

`switch(unknown) → unknown` · 4–32 argüman

```text
switch("gold", "gold", 10, 0)
```

Sonuç: `10`

## exists

`exists(unknown) → boolean` · 1–1 argüman

```text
exists(null)
```

Sonuç: `false`

## between

`between(unknown, array) → boolean` · 2–2 argüman

```text
between(5, [1,10])
```

Sonuç: `true`

## before

`before(string, string) → boolean` · 2–2 argüman

```text
before("2026-10-03", "2026-10-05")
```

Sonuç: `true`

## after

`after(string, string) → boolean` · 2–2 argüman

```text
after("2026-10-05", "2026-10-03")
```

Sonuç: `true`

## toNumber

`toNumber(unknown) → number` · 1–1 argüman

```text
toNumber("42")
```

Sonuç: `42`

## toString

`toString(unknown) → string` · 1–1 argüman

```text
toString(42)
```

Sonuç: `"42"`

## parseJSON

`parseJSON(string) → unknown` · 1–1 argüman

```text
parseJSON("{\"ok\":true}")
```

Sonuç: `{"ok":true}`


