---
title: "Expression functions"
---

Generated from the expression registry; authored tests verify examples. No JavaScript execution. The `now()` example injects 2026-10-03T09:00:00Z.

## upper

`upper(string) → string` · 1–1 arguments

```text
upper("verbis")
```

Result: `"VERBIS"`

## lower

`lower(string) → string` · 1–1 arguments

```text
lower("VERBIS")
```

Result: `"verbis"`

## trim

`trim(string) → string` · 1–1 arguments

```text
trim("  demo  ")
```

Result: `"demo"`

## contains

`contains(unknown, unknown) → boolean` · 2–2 arguments

```text
contains([1,2,3], 2)
```

Result: `true`

## startsWith

`startsWith(string, string) → boolean` · 2–2 arguments

```text
startsWith("demo-script", "demo")
```

Result: `true`

## format

`format(string) → string` · 1–32 arguments

```text
format("Hello {0}", "Demo")
```

Result: `"Hello Demo"`

## mask

`mask(string, number, string) → string` · 1–3 arguments

```text
mask("DEMO-REF", 3)
```

Result: `"*****REF"`

## padStart

`padStart(string, number, string) → string` · 2–3 arguments

```text
padStart("7", 3, "0")
```

Result: `"007"`

## round

`round(number, number) → number` · 1–2 arguments

```text
round(12.345, 2)
```

Result: `12.35`

## formatCurrency

`formatCurrency(number, string, string) → string` · 1–3 arguments

```text
formatCurrency(1500, "tr", "TRY")
```

Result: `"1.500,00 ₺"`

## now

`now() → string` · 0–0 arguments

```text
now()
```

Result: `"2026-10-03T09:00:00.000Z"`

## addDays

`addDays(string, number) → string` · 2–2 arguments

```text
addDays("2026-10-03", 2)
```

Result: `"2026-10-05T00:00:00.000Z"`

## diff

`diff(string, string, string) → number` · 2–3 arguments

```text
diff("2026-10-05", "2026-10-03", "days")
```

Result: `2`

## formatDate

`formatDate(string, string) → string` · 1–2 arguments

```text
formatDate("2026-10-03", "dd.MM.yyyy")
```

Result: `"03.10.2026"`

## isBusinessDay

`isBusinessDay(string, array) → boolean` · 1–2 arguments

```text
isBusinessDay("2026-10-05", [])
```

Result: `true`

Validation checks syntax/checksum only; it does not verify a person, account or telephone.

## age

`age(string, string) → number` · 1–2 arguments

```text
age("2000-01-01", "2026-10-03")
```

Result: `26`

## count

`count(array) → number` · 1–1 arguments

```text
count([1,2,3])
```

Result: `3`

## sum

`sum(array, unknown) → number` · 1–2 arguments

```text
sum([{amount:10},{amount:20}], x => x.amount)
```

Result: `30`

Lambda is accepted only in the allowlisted collection argument slot.

## filter

`filter(array, unknown) → array` · 2–2 arguments

```text
filter([1,2,3], x => x > 1)
```

Result: `[2,3]`

Lambda is accepted only in the allowlisted collection argument slot.

## map

`map(array, unknown) → array` · 2–2 arguments

```text
map([1,2], x => x * 2)
```

Result: `[2,4]`

Lambda is accepted only in the allowlisted collection argument slot.

## find

`find(array, unknown) → unknown` · 2–2 arguments

```text
find([1,2,3], x => x > 1)
```

Result: `2`

Lambda is accepted only in the allowlisted collection argument slot.

## any

`any(array, unknown) → boolean` · 2–2 arguments

```text
any([1,2], x => x > 1)
```

Result: `true`

Lambda is accepted only in the allowlisted collection argument slot.

## all

`all(array, unknown) → boolean` · 2–2 arguments

```text
all([1,2], x => x > 0)
```

Result: `true`

Lambda is accepted only in the allowlisted collection argument slot.

## isEmail

`isEmail(string) → boolean` · 1–1 arguments

```text
isEmail("demo@example.invalid")
```

Result: `true`

Validation checks syntax/checksum only; it does not verify a person, account or telephone.

## isPhoneTR

`isPhoneTR(string) → boolean` · 1–1 arguments

```text
isPhoneTR("invalid")
```

Result: `false`

Validation checks syntax/checksum only; it does not verify a person, account or telephone.

## isTCKN

`isTCKN(string) → boolean` · 1–1 arguments

```text
isTCKN("invalid")
```

Result: `false`

Validation checks syntax/checksum only; it does not verify a person, account or telephone.

## isIBAN

`isIBAN(string) → boolean` · 1–1 arguments

```text
isIBAN("invalid")
```

Result: `false`

Validation checks syntax/checksum only; it does not verify a person, account or telephone.

## isVKN

`isVKN(string) → boolean` · 1–1 arguments

```text
isVKN("invalid")
```

Result: `false`

Validation checks syntax/checksum only; it does not verify a person, account or telephone.

## luhn

`luhn(string) → boolean` · 1–1 arguments

```text
luhn("invalid")
```

Result: `false`

Validation checks syntax/checksum only; it does not verify a person, account or telephone.

## regexTest

`regexTest(string, string, string) → boolean` · 2–3 arguments

```text
regexTest("demo-42", "^demo-[0-9]+$")
```

Result: `true`

## if

`if(unknown, unknown, unknown) → unknown` · 3–3 arguments

```text
if(true, "yes", "no")
```

Result: `"yes"`

## switch

`switch(unknown) → unknown` · 4–32 arguments

```text
switch("gold", "gold", 10, 0)
```

Result: `10`

## exists

`exists(unknown) → boolean` · 1–1 arguments

```text
exists(null)
```

Result: `false`

## between

`between(unknown, array) → boolean` · 2–2 arguments

```text
between(5, [1,10])
```

Result: `true`

## before

`before(string, string) → boolean` · 2–2 arguments

```text
before("2026-10-03", "2026-10-05")
```

Result: `true`

## after

`after(string, string) → boolean` · 2–2 arguments

```text
after("2026-10-05", "2026-10-03")
```

Result: `true`

## toNumber

`toNumber(unknown) → number` · 1–1 arguments

```text
toNumber("42")
```

Result: `42`

## toString

`toString(unknown) → string` · 1–1 arguments

```text
toString(42)
```

Result: `"42"`

## parseJSON

`parseJSON(string) → unknown` · 1–1 arguments

```text
parseJSON("{\"ok\":true}")
```

Result: `{"ok":true}`


