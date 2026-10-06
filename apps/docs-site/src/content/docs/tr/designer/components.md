---
title: "Component referansı"
---

Component registry’den üretilmiştir. Tüm metinler TR/EN i18n anahtarı kullanır; hassas değerler literal props içinde tutulmaz.

## box

Kategori: `core`

Olaylar: —

Bağlanabilir alanlar: `direction`, `gap`, `padding`, `grid`, `wrap`, `scroll`, `align`, `justify`, `border`, `background`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |

```json
{
  "id": "demo-box",
  "type": "box",
  "props": {}
}
```
## button

Kategori: `core`

Olaylar: `onPress`

Bağlanabilir alanlar: `labelKey`, `iconKey`, `disabled`, `loading`, `variant`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |

```json
{
  "id": "demo-button",
  "type": "button",
  "props": {}
}
```
## webService

Kategori: `core`

Olaylar: `onSuccess`, `onError`

Bağlanabilir alanlar: `visible`, `ds`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |

```json
{
  "id": "demo-webservice",
  "type": "webService",
  "props": {}
}
```
## scriptText

Kategori: `script`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `textKey`, `params`, `emphasis`, `mustRead`, `acknowledged`, `value`, `tone`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `textKey` | i18nKey | ✓ |
| `params` | json | ✓ |
| `blocks` | json | — |
| `emphasis` | select | ✓ |
| `mustRead` | boolean | ✓ |
| `acknowledged` | boolean | ✓ |
| `value` | text | ✓ |
| `options` | json | — |
| `tone` | select | ✓ |
| `url` | asset | — |

```json
{
  "id": "demo-scripttext",
  "type": "scriptText",
  "props": {}
}
```
## privacyNotice

Kategori: `script`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `textKey`, `purposeKey`, `noticeVersion`, `disabled`, `value`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `textKey` | i18nKey | ✓ |
| `purposeKey` | i18nKey | ✓ |
| `noticeVersion` | text | ✓ |
| `disabled` | boolean | ✓ |
| `value` | text | ✓ |

```json
{
  "id": "demo-privacynotice",
  "type": "privacyNotice",
  "props": {}
}
```
## explicitConsent

Kategori: `script`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `textKey`, `purposeKey`, `noticeVersion`, `disabled`, `value`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `textKey` | i18nKey | ✓ |
| `purposeKey` | i18nKey | ✓ |
| `noticeVersion` | text | ✓ |
| `disabled` | boolean | ✓ |
| `value` | text | ✓ |

```json
{
  "id": "demo-explicitconsent",
  "type": "explicitConsent",
  "props": {
    "labelKey": "components.consentLabel",
    "value": false
  }
}
```
## callout

Kategori: `script`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `textKey`, `params`, `emphasis`, `mustRead`, `acknowledged`, `value`, `tone`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `textKey` | i18nKey | ✓ |
| `params` | json | ✓ |
| `blocks` | json | — |
| `emphasis` | select | ✓ |
| `mustRead` | boolean | ✓ |
| `acknowledged` | boolean | ✓ |
| `value` | text | ✓ |
| `options` | json | — |
| `tone` | select | ✓ |
| `url` | asset | — |

```json
{
  "id": "demo-callout",
  "type": "callout",
  "props": {}
}
```
## objectionHandler

Kategori: `script`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `textKey`, `params`, `emphasis`, `mustRead`, `acknowledged`, `value`, `tone`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `textKey` | i18nKey | ✓ |
| `params` | json | ✓ |
| `blocks` | json | — |
| `emphasis` | select | ✓ |
| `mustRead` | boolean | ✓ |
| `acknowledged` | boolean | ✓ |
| `value` | text | ✓ |
| `options` | json | — |
| `tone` | select | ✓ |
| `url` | asset | — |

```json
{
  "id": "demo-objectionhandler",
  "type": "objectionHandler",
  "props": {}
}
```
## checklist

Kategori: `script`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `textKey`, `params`, `emphasis`, `mustRead`, `acknowledged`, `value`, `tone`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `textKey` | i18nKey | ✓ |
| `params` | json | ✓ |
| `blocks` | json | — |
| `emphasis` | select | ✓ |
| `mustRead` | boolean | ✓ |
| `acknowledged` | boolean | ✓ |
| `value` | text | ✓ |
| `options` | json | — |
| `tone` | select | ✓ |
| `url` | asset | — |

```json
{
  "id": "demo-checklist",
  "type": "checklist",
  "props": {}
}
```
## knowledgeLink

Kategori: `script`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `textKey`, `params`, `emphasis`, `mustRead`, `acknowledged`, `value`, `tone`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `textKey` | i18nKey | ✓ |
| `params` | json | ✓ |
| `blocks` | json | — |
| `emphasis` | select | ✓ |
| `mustRead` | boolean | ✓ |
| `acknowledged` | boolean | ✓ |
| `value` | text | ✓ |
| `options` | json | — |
| `tone` | select | ✓ |
| `url` | asset | — |

```json
{
  "id": "demo-knowledgelink",
  "type": "knowledgeLink",
  "props": {}
}
```
## text

Kategori: `script`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `textKey`, `params`, `emphasis`, `mustRead`, `acknowledged`, `value`, `tone`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `textKey` | i18nKey | ✓ |
| `params` | json | ✓ |
| `blocks` | json | — |
| `emphasis` | select | ✓ |
| `mustRead` | boolean | ✓ |
| `acknowledged` | boolean | ✓ |
| `value` | text | ✓ |
| `options` | json | — |
| `tone` | select | ✓ |
| `url` | asset | — |

```json
{
  "id": "demo-text",
  "type": "text",
  "props": {}
}
```
## heading

Kategori: `script`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `textKey`, `params`, `emphasis`, `mustRead`, `acknowledged`, `value`, `tone`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `textKey` | i18nKey | ✓ |
| `params` | json | ✓ |
| `blocks` | json | — |
| `emphasis` | select | ✓ |
| `mustRead` | boolean | ✓ |
| `acknowledged` | boolean | ✓ |
| `value` | text | ✓ |
| `options` | json | — |
| `tone` | select | ✓ |
| `url` | asset | — |

```json
{
  "id": "demo-heading",
  "type": "heading",
  "props": {}
}
```
## richContent

Kategori: `script`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `textKey`, `params`, `emphasis`, `mustRead`, `acknowledged`, `value`, `tone`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `textKey` | i18nKey | ✓ |
| `params` | json | ✓ |
| `blocks` | json | — |
| `emphasis` | select | ✓ |
| `mustRead` | boolean | ✓ |
| `acknowledged` | boolean | ✓ |
| `value` | text | ✓ |
| `options` | json | — |
| `tone` | select | ✓ |
| `url` | asset | — |

```json
{
  "id": "demo-richcontent",
  "type": "richContent",
  "props": {}
}
```
## alert

Kategori: `script`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `textKey`, `params`, `emphasis`, `mustRead`, `acknowledged`, `value`, `tone`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `textKey` | i18nKey | ✓ |
| `params` | json | ✓ |
| `blocks` | json | — |
| `emphasis` | select | ✓ |
| `mustRead` | boolean | ✓ |
| `acknowledged` | boolean | ✓ |
| `value` | text | ✓ |
| `options` | json | — |
| `tone` | select | ✓ |
| `url` | asset | — |

```json
{
  "id": "demo-alert",
  "type": "alert",
  "props": {}
}
```
## textInput

Kategori: `input`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `checked` | text | ✓ |
| `value` | text | ✓ |
| `options` | json | ✓ |
| `min` | number | ✓ |
| `max` | number | ✓ |
| `step` | number | ✓ |
| `maxLength` | number | ✓ |
| `currency` | select | ✓ |
| `mask` | text | ✓ |
| `secure` | boolean | — |
| `country` | select | ✓ |

```json
{
  "id": "demo-textinput",
  "type": "textInput",
  "props": {}
}
```
## textArea

Kategori: `input`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `checked` | text | ✓ |
| `value` | text | ✓ |
| `options` | json | ✓ |
| `min` | number | ✓ |
| `max` | number | ✓ |
| `step` | number | ✓ |
| `maxLength` | number | ✓ |
| `currency` | select | ✓ |
| `mask` | text | ✓ |
| `secure` | boolean | — |
| `country` | select | ✓ |

```json
{
  "id": "demo-textarea",
  "type": "textArea",
  "props": {}
}
```
## numberInput

Kategori: `input`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `checked` | text | ✓ |
| `value` | text | ✓ |
| `options` | json | ✓ |
| `min` | number | ✓ |
| `max` | number | ✓ |
| `step` | number | ✓ |
| `maxLength` | number | ✓ |
| `currency` | select | ✓ |
| `mask` | text | ✓ |
| `secure` | boolean | — |
| `country` | select | ✓ |

```json
{
  "id": "demo-numberinput",
  "type": "numberInput",
  "props": {}
}
```
## currencyInput

Kategori: `input`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `checked` | text | ✓ |
| `value` | text | ✓ |
| `options` | json | ✓ |
| `min` | number | ✓ |
| `max` | number | ✓ |
| `step` | number | ✓ |
| `maxLength` | number | ✓ |
| `currency` | select | ✓ |
| `mask` | text | ✓ |
| `secure` | boolean | — |
| `country` | select | ✓ |

```json
{
  "id": "demo-currencyinput",
  "type": "currencyInput",
  "props": {}
}
```
## select

Kategori: `input`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `checked` | text | ✓ |
| `value` | text | ✓ |
| `options` | json | ✓ |
| `min` | number | ✓ |
| `max` | number | ✓ |
| `step` | number | ✓ |
| `maxLength` | number | ✓ |
| `currency` | select | ✓ |
| `mask` | text | ✓ |
| `secure` | boolean | — |
| `country` | select | ✓ |

```json
{
  "id": "demo-select",
  "type": "select",
  "props": {}
}
```
## multiSelect

Kategori: `input`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `checked` | text | ✓ |
| `value` | text | ✓ |
| `options` | json | ✓ |
| `min` | number | ✓ |
| `max` | number | ✓ |
| `step` | number | ✓ |
| `maxLength` | number | ✓ |
| `currency` | select | ✓ |
| `mask` | text | ✓ |
| `secure` | boolean | — |
| `country` | select | ✓ |

```json
{
  "id": "demo-multiselect",
  "type": "multiSelect",
  "props": {}
}
```
## radioGroup

Kategori: `input`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `checked` | text | ✓ |
| `value` | text | ✓ |
| `options` | json | ✓ |
| `min` | number | ✓ |
| `max` | number | ✓ |
| `step` | number | ✓ |
| `maxLength` | number | ✓ |
| `currency` | select | ✓ |
| `mask` | text | ✓ |
| `secure` | boolean | — |
| `country` | select | ✓ |

```json
{
  "id": "demo-radiogroup",
  "type": "radioGroup",
  "props": {}
}
```
## checkboxGroup

Kategori: `input`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `checked` | text | ✓ |
| `value` | text | ✓ |
| `options` | json | ✓ |
| `min` | number | ✓ |
| `max` | number | ✓ |
| `step` | number | ✓ |
| `maxLength` | number | ✓ |
| `currency` | select | ✓ |
| `mask` | text | ✓ |
| `secure` | boolean | — |
| `country` | select | ✓ |

```json
{
  "id": "demo-checkboxgroup",
  "type": "checkboxGroup",
  "props": {}
}
```
## checkbox

Kategori: `input`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `checked` | text | ✓ |
| `value` | text | ✓ |
| `options` | json | ✓ |
| `min` | number | ✓ |
| `max` | number | ✓ |
| `step` | number | ✓ |
| `maxLength` | number | ✓ |
| `currency` | select | ✓ |
| `mask` | text | ✓ |
| `secure` | boolean | — |
| `country` | select | ✓ |

```json
{
  "id": "demo-checkbox",
  "type": "checkbox",
  "props": {}
}
```
## toggle

Kategori: `input`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `checked` | text | ✓ |
| `value` | text | ✓ |
| `options` | json | ✓ |
| `min` | number | ✓ |
| `max` | number | ✓ |
| `step` | number | ✓ |
| `maxLength` | number | ✓ |
| `currency` | select | ✓ |
| `mask` | text | ✓ |
| `secure` | boolean | — |
| `country` | select | ✓ |

```json
{
  "id": "demo-toggle",
  "type": "toggle",
  "props": {}
}
```
## datePicker

Kategori: `input`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `checked` | text | ✓ |
| `value` | text | ✓ |
| `options` | json | ✓ |
| `min` | number | ✓ |
| `max` | number | ✓ |
| `step` | number | ✓ |
| `maxLength` | number | ✓ |
| `currency` | select | ✓ |
| `mask` | text | ✓ |
| `secure` | boolean | — |
| `country` | select | ✓ |

```json
{
  "id": "demo-datepicker",
  "type": "datePicker",
  "props": {}
}
```
## timePicker

Kategori: `input`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `checked` | text | ✓ |
| `value` | text | ✓ |
| `options` | json | ✓ |
| `min` | number | ✓ |
| `max` | number | ✓ |
| `step` | number | ✓ |
| `maxLength` | number | ✓ |
| `currency` | select | ✓ |
| `mask` | text | ✓ |
| `secure` | boolean | — |
| `country` | select | ✓ |

```json
{
  "id": "demo-timepicker",
  "type": "timePicker",
  "props": {}
}
```
## rating

Kategori: `input`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `checked` | text | ✓ |
| `value` | text | ✓ |
| `options` | json | ✓ |
| `min` | number | ✓ |
| `max` | number | ✓ |
| `step` | number | ✓ |
| `maxLength` | number | ✓ |
| `currency` | select | ✓ |
| `mask` | text | ✓ |
| `secure` | boolean | — |
| `country` | select | ✓ |

```json
{
  "id": "demo-rating",
  "type": "rating",
  "props": {}
}
```
## slider

Kategori: `input`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `checked` | text | ✓ |
| `value` | text | ✓ |
| `options` | json | ✓ |
| `min` | number | ✓ |
| `max` | number | ✓ |
| `step` | number | ✓ |
| `maxLength` | number | ✓ |
| `currency` | select | ✓ |
| `mask` | text | ✓ |
| `secure` | boolean | — |
| `country` | select | ✓ |

```json
{
  "id": "demo-slider",
  "type": "slider",
  "props": {}
}
```
## phoneInput

Kategori: `input`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `checked` | text | ✓ |
| `value` | text | ✓ |
| `options` | json | ✓ |
| `min` | number | ✓ |
| `max` | number | ✓ |
| `step` | number | ✓ |
| `maxLength` | number | ✓ |
| `currency` | select | ✓ |
| `mask` | text | ✓ |
| `secure` | boolean | — |
| `country` | select | ✓ |

```json
{
  "id": "demo-phoneinput",
  "type": "phoneInput",
  "props": {}
}
```
## emailInput

Kategori: `input`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `checked` | text | ✓ |
| `value` | text | ✓ |
| `options` | json | ✓ |
| `min` | number | ✓ |
| `max` | number | ✓ |
| `step` | number | ✓ |
| `maxLength` | number | ✓ |
| `currency` | select | ✓ |
| `mask` | text | ✓ |
| `secure` | boolean | — |
| `country` | select | ✓ |

```json
{
  "id": "demo-emailinput",
  "type": "emailInput",
  "props": {}
}
```
## maskedInput

Kategori: `input`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `checked` | text | ✓ |
| `value` | text | ✓ |
| `options` | json | ✓ |
| `min` | number | ✓ |
| `max` | number | ✓ |
| `step` | number | ✓ |
| `maxLength` | number | ✓ |
| `currency` | select | ✓ |
| `mask` | text | ✓ |
| `secure` | boolean | — |
| `country` | select | ✓ |

```json
{
  "id": "demo-maskedinput",
  "type": "maskedInput",
  "props": {}
}
```
## addressInput

Kategori: `input`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `checked` | text | ✓ |
| `value` | text | ✓ |
| `options` | json | ✓ |
| `min` | number | ✓ |
| `max` | number | ✓ |
| `step` | number | ✓ |
| `maxLength` | number | ✓ |
| `currency` | select | ✓ |
| `mask` | text | ✓ |
| `secure` | boolean | — |
| `country` | select | ✓ |

```json
{
  "id": "demo-addressinput",
  "type": "addressInput",
  "props": {}
}
```
## tcknInput

Kategori: `input`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `checked`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`, `value`

**Güvenli giriş:** değer okunmaz/geri gösterilmez; sınıflandırılmış değişken kullanın.

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `checked` | text | ✓ |
| `options` | json | ✓ |
| `min` | number | ✓ |
| `max` | number | ✓ |
| `step` | number | ✓ |
| `maxLength` | number | ✓ |
| `currency` | select | ✓ |
| `mask` | text | ✓ |
| `country` | select | ✓ |
| `secure` | boolean | — |
| `value` | text | ✓ |

```json
{
  "id": "demo-tckninput",
  "type": "tcknInput",
  "props": {}
}
```
## vknInput

Kategori: `input`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `checked`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`, `value`

**Güvenli giriş:** değer okunmaz/geri gösterilmez; sınıflandırılmış değişken kullanın.

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `checked` | text | ✓ |
| `options` | json | ✓ |
| `min` | number | ✓ |
| `max` | number | ✓ |
| `step` | number | ✓ |
| `maxLength` | number | ✓ |
| `currency` | select | ✓ |
| `mask` | text | ✓ |
| `country` | select | ✓ |
| `secure` | boolean | — |
| `value` | text | ✓ |

```json
{
  "id": "demo-vkninput",
  "type": "vknInput",
  "props": {}
}
```
## ibanInput

Kategori: `input`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `checked`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`, `value`

**Güvenli giriş:** değer okunmaz/geri gösterilmez; sınıflandırılmış değişken kullanın.

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `checked` | text | ✓ |
| `options` | json | ✓ |
| `min` | number | ✓ |
| `max` | number | ✓ |
| `step` | number | ✓ |
| `maxLength` | number | ✓ |
| `currency` | select | ✓ |
| `mask` | text | ✓ |
| `country` | select | ✓ |
| `secure` | boolean | — |
| `value` | text | ✓ |

```json
{
  "id": "demo-ibaninput",
  "type": "ibanInput",
  "props": {}
}
```
## creditCardInput

Kategori: `input`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `checked`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`, `value`

**Güvenli giriş:** değer okunmaz/geri gösterilmez; sınıflandırılmış değişken kullanın.

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `checked` | text | ✓ |
| `options` | json | ✓ |
| `min` | number | ✓ |
| `max` | number | ✓ |
| `step` | number | ✓ |
| `maxLength` | number | ✓ |
| `currency` | select | ✓ |
| `mask` | text | ✓ |
| `country` | select | ✓ |
| `secure` | boolean | — |
| `value` | text | ✓ |

```json
{
  "id": "demo-creditcardinput",
  "type": "creditCardInput",
  "props": {}
}
```
## section

Kategori: `structure`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `columns`, `gap`, `value`, `open`, `orientation`, `size`, `arrayVariable`, `itemKey`, `limit`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `columns` | number | ✓ |
| `gap` | select | ✓ |
| `items` | json | — |
| `value` | text | ✓ |
| `open` | boolean | ✓ |
| `orientation` | select | ✓ |
| `size` | text | ✓ |
| `arrayVariable` | variable | ✓ |
| `itemKey` | text | ✓ |
| `limit` | number | ✓ |

```json
{
  "id": "demo-section",
  "type": "section",
  "props": {}
}
```
## card

Kategori: `structure`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `columns`, `gap`, `value`, `open`, `orientation`, `size`, `arrayVariable`, `itemKey`, `limit`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `columns` | number | ✓ |
| `gap` | select | ✓ |
| `items` | json | — |
| `value` | text | ✓ |
| `open` | boolean | ✓ |
| `orientation` | select | ✓ |
| `size` | text | ✓ |
| `arrayVariable` | variable | ✓ |
| `itemKey` | text | ✓ |
| `limit` | number | ✓ |

```json
{
  "id": "demo-card",
  "type": "card",
  "props": {}
}
```
## columns

Kategori: `structure`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `columns`, `gap`, `value`, `open`, `orientation`, `size`, `arrayVariable`, `itemKey`, `limit`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `columns` | number | ✓ |
| `gap` | select | ✓ |
| `items` | json | — |
| `value` | text | ✓ |
| `open` | boolean | ✓ |
| `orientation` | select | ✓ |
| `size` | text | ✓ |
| `arrayVariable` | variable | ✓ |
| `itemKey` | text | ✓ |
| `limit` | number | ✓ |

```json
{
  "id": "demo-columns",
  "type": "columns",
  "props": {}
}
```
## tabs

Kategori: `structure`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `columns`, `gap`, `value`, `open`, `orientation`, `size`, `arrayVariable`, `itemKey`, `limit`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `columns` | number | ✓ |
| `gap` | select | ✓ |
| `items` | json | — |
| `value` | text | ✓ |
| `open` | boolean | ✓ |
| `orientation` | select | ✓ |
| `size` | text | ✓ |
| `arrayVariable` | variable | ✓ |
| `itemKey` | text | ✓ |
| `limit` | number | ✓ |

```json
{
  "id": "demo-tabs",
  "type": "tabs",
  "props": {}
}
```
## accordion

Kategori: `structure`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `columns`, `gap`, `value`, `open`, `orientation`, `size`, `arrayVariable`, `itemKey`, `limit`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `columns` | number | ✓ |
| `gap` | select | ✓ |
| `items` | json | — |
| `value` | text | ✓ |
| `open` | boolean | ✓ |
| `orientation` | select | ✓ |
| `size` | text | ✓ |
| `arrayVariable` | variable | ✓ |
| `itemKey` | text | ✓ |
| `limit` | number | ✓ |

```json
{
  "id": "demo-accordion",
  "type": "accordion",
  "props": {}
}
```
## stepper

Kategori: `structure`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `columns`, `gap`, `value`, `open`, `orientation`, `size`, `arrayVariable`, `itemKey`, `limit`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `columns` | number | ✓ |
| `gap` | select | ✓ |
| `items` | json | — |
| `value` | text | ✓ |
| `open` | boolean | ✓ |
| `orientation` | select | ✓ |
| `size` | text | ✓ |
| `arrayVariable` | variable | ✓ |
| `itemKey` | text | ✓ |
| `limit` | number | ✓ |

```json
{
  "id": "demo-stepper",
  "type": "stepper",
  "props": {}
}
```
## wizard

Kategori: `structure`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `columns`, `gap`, `value`, `open`, `orientation`, `size`, `arrayVariable`, `itemKey`, `limit`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `columns` | number | ✓ |
| `gap` | select | ✓ |
| `items` | json | — |
| `value` | text | ✓ |
| `open` | boolean | ✓ |
| `orientation` | select | ✓ |
| `size` | text | ✓ |
| `arrayVariable` | variable | ✓ |
| `itemKey` | text | ✓ |
| `limit` | number | ✓ |

```json
{
  "id": "demo-wizard",
  "type": "wizard",
  "props": {}
}
```
## modal

Kategori: `structure`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `columns`, `gap`, `value`, `open`, `orientation`, `size`, `arrayVariable`, `itemKey`, `limit`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `columns` | number | ✓ |
| `gap` | select | ✓ |
| `items` | json | — |
| `value` | text | ✓ |
| `open` | boolean | ✓ |
| `orientation` | select | ✓ |
| `size` | text | ✓ |
| `arrayVariable` | variable | ✓ |
| `itemKey` | text | ✓ |
| `limit` | number | ✓ |

```json
{
  "id": "demo-modal",
  "type": "modal",
  "props": {}
}
```
## divider

Kategori: `structure`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `columns`, `gap`, `value`, `open`, `orientation`, `size`, `arrayVariable`, `itemKey`, `limit`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `columns` | number | ✓ |
| `gap` | select | ✓ |
| `items` | json | — |
| `value` | text | ✓ |
| `open` | boolean | ✓ |
| `orientation` | select | ✓ |
| `size` | text | ✓ |
| `arrayVariable` | variable | ✓ |
| `itemKey` | text | ✓ |
| `limit` | number | ✓ |

```json
{
  "id": "demo-divider",
  "type": "divider",
  "props": {}
}
```
## spacer

Kategori: `structure`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `columns`, `gap`, `value`, `open`, `orientation`, `size`, `arrayVariable`, `itemKey`, `limit`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `columns` | number | ✓ |
| `gap` | select | ✓ |
| `items` | json | — |
| `value` | text | ✓ |
| `open` | boolean | ✓ |
| `orientation` | select | ✓ |
| `size` | text | ✓ |
| `arrayVariable` | variable | ✓ |
| `itemKey` | text | ✓ |
| `limit` | number | ✓ |

```json
{
  "id": "demo-spacer",
  "type": "spacer",
  "props": {}
}
```
## repeater

Kategori: `structure`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `columns`, `gap`, `value`, `open`, `orientation`, `size`, `arrayVariable`, `itemKey`, `limit`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `columns` | number | ✓ |
| `gap` | select | ✓ |
| `items` | json | — |
| `value` | text | ✓ |
| `open` | boolean | ✓ |
| `orientation` | select | ✓ |
| `size` | text | ✓ |
| `arrayVariable` | variable | ✓ |
| `itemKey` | text | ✓ |
| `limit` | number | ✓ |

```json
{
  "id": "demo-repeater",
  "type": "repeater",
  "props": {}
}
```
## lookup

Kategori: `data`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `ds`, `output`, `trigger`, `debounceMs`, `queryVariable`, `value`, `rows`, `columns`, `rowKey`, `labelField`, `valueField`, `chartType`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `ds` | text | ✓ |
| `output` | text | ✓ |
| `trigger` | select | ✓ |
| `debounceMs` | number | ✓ |
| `queryVariable` | variable | ✓ |
| `value` | text | ✓ |
| `rows` | json | ✓ |
| `columns` | json | ✓ |
| `rowKey` | text | ✓ |
| `labelField` | text | ✓ |
| `valueField` | text | ✓ |
| `chartType` | select | ✓ |

```json
{
  "id": "demo-lookup",
  "type": "lookup",
  "props": {}
}
```
## autoComplete

Kategori: `data`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `ds`, `output`, `trigger`, `debounceMs`, `queryVariable`, `value`, `rows`, `columns`, `rowKey`, `labelField`, `valueField`, `chartType`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `ds` | text | ✓ |
| `output` | text | ✓ |
| `trigger` | select | ✓ |
| `debounceMs` | number | ✓ |
| `queryVariable` | variable | ✓ |
| `value` | text | ✓ |
| `rows` | json | ✓ |
| `columns` | json | ✓ |
| `rowKey` | text | ✓ |
| `labelField` | text | ✓ |
| `valueField` | text | ✓ |
| `chartType` | select | ✓ |

```json
{
  "id": "demo-autocomplete",
  "type": "autoComplete",
  "props": {}
}
```
## dataGrid

Kategori: `data`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `ds`, `output`, `trigger`, `debounceMs`, `queryVariable`, `value`, `rows`, `columns`, `rowKey`, `labelField`, `valueField`, `chartType`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `ds` | text | ✓ |
| `output` | text | ✓ |
| `trigger` | select | ✓ |
| `debounceMs` | number | ✓ |
| `queryVariable` | variable | ✓ |
| `value` | text | ✓ |
| `rows` | json | ✓ |
| `columns` | json | ✓ |
| `rowKey` | text | ✓ |
| `labelField` | text | ✓ |
| `valueField` | text | ✓ |
| `chartType` | select | ✓ |

```json
{
  "id": "demo-datagrid",
  "type": "dataGrid",
  "props": {}
}
```
## keyValueList

Kategori: `data`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `ds`, `output`, `trigger`, `debounceMs`, `queryVariable`, `value`, `rows`, `columns`, `rowKey`, `labelField`, `valueField`, `chartType`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `ds` | text | ✓ |
| `output` | text | ✓ |
| `trigger` | select | ✓ |
| `debounceMs` | number | ✓ |
| `queryVariable` | variable | ✓ |
| `value` | text | ✓ |
| `rows` | json | ✓ |
| `columns` | json | ✓ |
| `rowKey` | text | ✓ |
| `labelField` | text | ✓ |
| `valueField` | text | ✓ |
| `chartType` | select | ✓ |

```json
{
  "id": "demo-keyvaluelist",
  "type": "keyValueList",
  "props": {}
}
```
## customerCard

Kategori: `data`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `ds`, `output`, `trigger`, `debounceMs`, `queryVariable`, `value`, `rows`, `columns`, `rowKey`, `labelField`, `valueField`, `chartType`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `ds` | text | ✓ |
| `output` | text | ✓ |
| `trigger` | select | ✓ |
| `debounceMs` | number | ✓ |
| `queryVariable` | variable | ✓ |
| `value` | text | ✓ |
| `rows` | json | ✓ |
| `columns` | json | ✓ |
| `rowKey` | text | ✓ |
| `labelField` | text | ✓ |
| `valueField` | text | ✓ |
| `chartType` | select | ✓ |

```json
{
  "id": "demo-customercard",
  "type": "customerCard",
  "props": {}
}
```
## timeline

Kategori: `data`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `ds`, `output`, `trigger`, `debounceMs`, `queryVariable`, `value`, `rows`, `columns`, `rowKey`, `labelField`, `valueField`, `chartType`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `ds` | text | ✓ |
| `output` | text | ✓ |
| `trigger` | select | ✓ |
| `debounceMs` | number | ✓ |
| `queryVariable` | variable | ✓ |
| `value` | text | ✓ |
| `rows` | json | ✓ |
| `columns` | json | ✓ |
| `rowKey` | text | ✓ |
| `labelField` | text | ✓ |
| `valueField` | text | ✓ |
| `chartType` | select | ✓ |

```json
{
  "id": "demo-timeline",
  "type": "timeline",
  "props": {}
}
```
## chart

Kategori: `data`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `ds`, `output`, `trigger`, `debounceMs`, `queryVariable`, `value`, `rows`, `columns`, `rowKey`, `labelField`, `valueField`, `chartType`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `ds` | text | ✓ |
| `output` | text | ✓ |
| `trigger` | select | ✓ |
| `debounceMs` | number | ✓ |
| `queryVariable` | variable | ✓ |
| `value` | text | ✓ |
| `rows` | json | ✓ |
| `columns` | json | ✓ |
| `rowKey` | text | ✓ |
| `labelField` | text | ✓ |
| `valueField` | text | ✓ |
| `chartType` | select | ✓ |

```json
{
  "id": "demo-chart",
  "type": "chart",
  "props": {}
}
```
## table

Kategori: `data`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `ds`, `output`, `trigger`, `debounceMs`, `queryVariable`, `value`, `rows`, `columns`, `rowKey`, `labelField`, `valueField`, `chartType`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `ds` | text | ✓ |
| `output` | text | ✓ |
| `trigger` | select | ✓ |
| `debounceMs` | number | ✓ |
| `queryVariable` | variable | ✓ |
| `value` | text | ✓ |
| `rows` | json | ✓ |
| `columns` | json | ✓ |
| `rowKey` | text | ✓ |
| `labelField` | text | ✓ |
| `valueField` | text | ✓ |
| `chartType` | select | ✓ |

```json
{
  "id": "demo-table",
  "type": "table",
  "props": {}
}
```
## actionButton

Kategori: `action`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `variant`, `size`, `loading`, `confirm`, `iconKey`, `outcome`, `code`, `target`, `value`, `scheduledAt`, `timeZone`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `variant` | text | ✓ |
| `size` | text | ✓ |
| `loading` | boolean | ✓ |
| `confirm` | text | ✓ |
| `iconKey` | text | ✓ |
| `outcome` | text | ✓ |
| `code` | text | ✓ |
| `target` | text | ✓ |
| `value` | text | ✓ |
| `options` | json | — |
| `scheduledAt` | text | ✓ |
| `timeZone` | text | ✓ |

```json
{
  "id": "demo-actionbutton",
  "type": "actionButton",
  "props": {}
}
```
## nextButton

Kategori: `action`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `variant`, `size`, `loading`, `confirm`, `iconKey`, `outcome`, `code`, `target`, `value`, `scheduledAt`, `timeZone`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `variant` | text | ✓ |
| `size` | text | ✓ |
| `loading` | boolean | ✓ |
| `confirm` | text | ✓ |
| `iconKey` | text | ✓ |
| `outcome` | text | ✓ |
| `code` | text | ✓ |
| `target` | text | ✓ |
| `value` | text | ✓ |
| `options` | json | — |
| `scheduledAt` | text | ✓ |
| `timeZone` | text | ✓ |

```json
{
  "id": "demo-nextbutton",
  "type": "nextButton",
  "props": {}
}
```
## backButton

Kategori: `action`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `variant`, `size`, `loading`, `confirm`, `iconKey`, `outcome`, `code`, `target`, `value`, `scheduledAt`, `timeZone`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `variant` | text | ✓ |
| `size` | text | ✓ |
| `loading` | boolean | ✓ |
| `confirm` | text | ✓ |
| `iconKey` | text | ✓ |
| `outcome` | text | ✓ |
| `code` | text | ✓ |
| `target` | text | ✓ |
| `value` | text | ✓ |
| `options` | json | — |
| `scheduledAt` | text | ✓ |
| `timeZone` | text | ✓ |

```json
{
  "id": "demo-backbutton",
  "type": "backButton",
  "props": {}
}
```
## buttonGroup

Kategori: `action`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `variant`, `size`, `loading`, `confirm`, `iconKey`, `outcome`, `code`, `target`, `value`, `scheduledAt`, `timeZone`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `variant` | text | ✓ |
| `size` | text | ✓ |
| `loading` | boolean | ✓ |
| `confirm` | text | ✓ |
| `iconKey` | text | ✓ |
| `outcome` | text | ✓ |
| `code` | text | ✓ |
| `target` | text | ✓ |
| `value` | text | ✓ |
| `options` | json | — |
| `scheduledAt` | text | ✓ |
| `timeZone` | text | ✓ |

```json
{
  "id": "demo-buttongroup",
  "type": "buttonGroup",
  "props": {}
}
```
## dispositionPicker

Kategori: `action`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `variant`, `size`, `loading`, `confirm`, `iconKey`, `outcome`, `code`, `target`, `value`, `scheduledAt`, `timeZone`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `variant` | text | ✓ |
| `size` | text | ✓ |
| `loading` | boolean | ✓ |
| `confirm` | text | ✓ |
| `iconKey` | text | ✓ |
| `outcome` | text | ✓ |
| `code` | text | ✓ |
| `target` | text | ✓ |
| `value` | text | ✓ |
| `options` | json | — |
| `scheduledAt` | text | ✓ |
| `timeZone` | text | ✓ |

```json
{
  "id": "demo-dispositionpicker",
  "type": "dispositionPicker",
  "props": {}
}
```
## outcomeSubmit

Kategori: `action`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `variant`, `size`, `loading`, `confirm`, `iconKey`, `outcome`, `code`, `target`, `value`, `scheduledAt`, `timeZone`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `variant` | text | ✓ |
| `size` | text | ✓ |
| `loading` | boolean | ✓ |
| `confirm` | text | ✓ |
| `iconKey` | text | ✓ |
| `outcome` | text | ✓ |
| `code` | text | ✓ |
| `target` | text | ✓ |
| `value` | text | ✓ |
| `options` | json | — |
| `scheduledAt` | text | ✓ |
| `timeZone` | text | ✓ |

```json
{
  "id": "demo-outcomesubmit",
  "type": "outcomeSubmit",
  "props": {}
}
```
## transferHint

Kategori: `action`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `variant`, `size`, `loading`, `confirm`, `iconKey`, `outcome`, `code`, `target`, `value`, `scheduledAt`, `timeZone`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `variant` | text | ✓ |
| `size` | text | ✓ |
| `loading` | boolean | ✓ |
| `confirm` | text | ✓ |
| `iconKey` | text | ✓ |
| `outcome` | text | ✓ |
| `code` | text | ✓ |
| `target` | text | ✓ |
| `value` | text | ✓ |
| `options` | json | — |
| `scheduledAt` | text | ✓ |
| `timeZone` | text | ✓ |

```json
{
  "id": "demo-transferhint",
  "type": "transferHint",
  "props": {}
}
```
## callbackScheduler

Kategori: `action`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `variant`, `size`, `loading`, `confirm`, `iconKey`, `outcome`, `code`, `target`, `value`, `scheduledAt`, `timeZone`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `variant` | text | ✓ |
| `size` | text | ✓ |
| `loading` | boolean | ✓ |
| `confirm` | text | ✓ |
| `iconKey` | text | ✓ |
| `outcome` | text | ✓ |
| `code` | text | ✓ |
| `target` | text | ✓ |
| `value` | text | ✓ |
| `options` | json | — |
| `scheduledAt` | text | ✓ |
| `timeZone` | text | ✓ |

```json
{
  "id": "demo-callbackscheduler",
  "type": "callbackScheduler",
  "props": {}
}
```
## image

Kategori: `media`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `altKey`, `durationSec`, `timer`, `value`, `tone`, `max`, `feature`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `url` | asset | — |
| `poster` | text | — |
| `altKey` | i18nKey | ✓ |
| `captionsUrl` | asset | — |
| `durationSec` | number | ✓ |
| `timer` | text | ✓ |
| `value` | text | ✓ |
| `tone` | select | ✓ |
| `max` | number | ✓ |
| `feature` | text | ✓ |

```json
{
  "id": "demo-image",
  "type": "image",
  "props": {}
}
```
## video

Kategori: `media`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `altKey`, `durationSec`, `timer`, `value`, `tone`, `max`, `feature`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `url` | asset | — |
| `poster` | text | — |
| `altKey` | i18nKey | ✓ |
| `captionsUrl` | asset | — |
| `durationSec` | number | ✓ |
| `timer` | text | ✓ |
| `value` | text | ✓ |
| `tone` | select | ✓ |
| `max` | number | ✓ |
| `feature` | text | ✓ |

```json
{
  "id": "demo-video",
  "type": "video",
  "props": {}
}
```
## iframe

Kategori: `media`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `altKey`, `durationSec`, `timer`, `value`, `tone`, `max`, `feature`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `url` | asset | — |
| `poster` | text | — |
| `altKey` | i18nKey | ✓ |
| `captionsUrl` | asset | — |
| `durationSec` | number | ✓ |
| `timer` | text | ✓ |
| `value` | text | ✓ |
| `tone` | select | ✓ |
| `max` | number | ✓ |
| `feature` | text | ✓ |

```json
{
  "id": "demo-iframe",
  "type": "iframe",
  "props": {}
}
```
## timer

Kategori: `media`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `altKey`, `durationSec`, `timer`, `value`, `tone`, `max`, `feature`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `url` | asset | — |
| `poster` | text | — |
| `altKey` | i18nKey | ✓ |
| `captionsUrl` | asset | — |
| `durationSec` | number | ✓ |
| `timer` | text | ✓ |
| `value` | text | ✓ |
| `tone` | select | ✓ |
| `max` | number | ✓ |
| `feature` | text | ✓ |

```json
{
  "id": "demo-timer",
  "type": "timer",
  "props": {}
}
```
## countdown

Kategori: `media`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `altKey`, `durationSec`, `timer`, `value`, `tone`, `max`, `feature`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `url` | asset | — |
| `poster` | text | — |
| `altKey` | i18nKey | ✓ |
| `captionsUrl` | asset | — |
| `durationSec` | number | ✓ |
| `timer` | text | ✓ |
| `value` | text | ✓ |
| `tone` | select | ✓ |
| `max` | number | ✓ |
| `feature` | text | ✓ |

```json
{
  "id": "demo-countdown",
  "type": "countdown",
  "props": {}
}
```
## note

Kategori: `media`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `checked` | text | ✓ |
| `value` | text | ✓ |
| `options` | json | — |
| `min` | number | ✓ |
| `max` | number | ✓ |
| `step` | number | ✓ |
| `maxLength` | number | ✓ |
| `currency` | select | ✓ |
| `mask` | text | ✓ |
| `secure` | boolean | — |
| `country` | select | ✓ |

```json
{
  "id": "demo-note",
  "type": "note",
  "props": {}
}
```
## badge

Kategori: `media`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `altKey`, `durationSec`, `timer`, `value`, `tone`, `max`, `feature`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `url` | asset | — |
| `poster` | text | — |
| `altKey` | i18nKey | ✓ |
| `captionsUrl` | asset | — |
| `durationSec` | number | ✓ |
| `timer` | text | ✓ |
| `value` | text | ✓ |
| `tone` | select | ✓ |
| `max` | number | ✓ |
| `feature` | text | ✓ |

```json
{
  "id": "demo-badge",
  "type": "badge",
  "props": {}
}
```
## progressIndicator

Kategori: `media`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `altKey`, `durationSec`, `timer`, `value`, `tone`, `max`, `feature`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `url` | asset | — |
| `poster` | text | — |
| `altKey` | i18nKey | ✓ |
| `captionsUrl` | asset | — |
| `durationSec` | number | ✓ |
| `timer` | text | ✓ |
| `value` | text | ✓ |
| `tone` | select | ✓ |
| `max` | number | ✓ |
| `feature` | text | ✓ |

```json
{
  "id": "demo-progressindicator",
  "type": "progressIndicator",
  "props": {}
}
```
## signature

Kategori: `media`

Olaylar: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bağlanabilir alanlar: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `altKey`, `durationSec`, `timer`, `value`, `tone`, `max`, `feature`

| Özellik | Editör | Bağlanabilir |
| --- | --- | --- |
| `labelKey` | i18nKey | ✓ |
| `titleKey` | i18nKey | ✓ |
| `descriptionKey` | i18nKey | ✓ |
| `hintKey` | i18nKey | ✓ |
| `placeholderKey` | i18nKey | ✓ |
| `required` | boolean | ✓ |
| `disabled` | boolean | ✓ |
| `validation` | json | — |
| `itemPath` | text | ✓ |
| `url` | asset | — |
| `poster` | text | — |
| `altKey` | i18nKey | ✓ |
| `captionsUrl` | asset | — |
| `durationSec` | number | ✓ |
| `timer` | text | ✓ |
| `value` | text | ✓ |
| `tone` | select | ✓ |
| `max` | number | ✓ |
| `feature` | text | ✓ |

```json
{
  "id": "demo-signature",
  "type": "signature",
  "props": {}
}
```

