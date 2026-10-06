---
title: "Component reference"
---

Generated from the component registry. All text uses TR/EN i18n keys; sensitive values never belong in literal props.

## box

Category: `core`

Events: —

Bindable props: `direction`, `gap`, `padding`, `grid`, `wrap`, `scroll`, `align`, `justify`, `border`, `background`

| Property | Editor | Bindable |
| --- | --- | --- |

```json
{
  "id": "demo-box",
  "type": "box",
  "props": {}
}
```
## button

Category: `core`

Events: `onPress`

Bindable props: `labelKey`, `iconKey`, `disabled`, `loading`, `variant`

| Property | Editor | Bindable |
| --- | --- | --- |

```json
{
  "id": "demo-button",
  "type": "button",
  "props": {}
}
```
## webService

Category: `core`

Events: `onSuccess`, `onError`

Bindable props: `visible`, `ds`

| Property | Editor | Bindable |
| --- | --- | --- |

```json
{
  "id": "demo-webservice",
  "type": "webService",
  "props": {}
}
```
## scriptText

Category: `script`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `textKey`, `params`, `emphasis`, `mustRead`, `acknowledged`, `value`, `tone`

| Property | Editor | Bindable |
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

Category: `script`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `textKey`, `purposeKey`, `noticeVersion`, `disabled`, `value`

| Property | Editor | Bindable |
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

Category: `script`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `textKey`, `purposeKey`, `noticeVersion`, `disabled`, `value`

| Property | Editor | Bindable |
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

Category: `script`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `textKey`, `params`, `emphasis`, `mustRead`, `acknowledged`, `value`, `tone`

| Property | Editor | Bindable |
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

Category: `script`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `textKey`, `params`, `emphasis`, `mustRead`, `acknowledged`, `value`, `tone`

| Property | Editor | Bindable |
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

Category: `script`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `textKey`, `params`, `emphasis`, `mustRead`, `acknowledged`, `value`, `tone`

| Property | Editor | Bindable |
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

Category: `script`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `textKey`, `params`, `emphasis`, `mustRead`, `acknowledged`, `value`, `tone`

| Property | Editor | Bindable |
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

Category: `script`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `textKey`, `params`, `emphasis`, `mustRead`, `acknowledged`, `value`, `tone`

| Property | Editor | Bindable |
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

Category: `script`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `textKey`, `params`, `emphasis`, `mustRead`, `acknowledged`, `value`, `tone`

| Property | Editor | Bindable |
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

Category: `script`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `textKey`, `params`, `emphasis`, `mustRead`, `acknowledged`, `value`, `tone`

| Property | Editor | Bindable |
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

Category: `script`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `textKey`, `params`, `emphasis`, `mustRead`, `acknowledged`, `value`, `tone`

| Property | Editor | Bindable |
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

Category: `input`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Property | Editor | Bindable |
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

Category: `input`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Property | Editor | Bindable |
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

Category: `input`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Property | Editor | Bindable |
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

Category: `input`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Property | Editor | Bindable |
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

Category: `input`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Property | Editor | Bindable |
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

Category: `input`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Property | Editor | Bindable |
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

Category: `input`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Property | Editor | Bindable |
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

Category: `input`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Property | Editor | Bindable |
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

Category: `input`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Property | Editor | Bindable |
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

Category: `input`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Property | Editor | Bindable |
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

Category: `input`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Property | Editor | Bindable |
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

Category: `input`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Property | Editor | Bindable |
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

Category: `input`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Property | Editor | Bindable |
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

Category: `input`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Property | Editor | Bindable |
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

Category: `input`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Property | Editor | Bindable |
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

Category: `input`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Property | Editor | Bindable |
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

Category: `input`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Property | Editor | Bindable |
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

Category: `input`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Property | Editor | Bindable |
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

Category: `input`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `checked`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`, `value`

**Secure input:** values are write-only; use a classified variable.

| Property | Editor | Bindable |
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

Category: `input`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `checked`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`, `value`

**Secure input:** values are write-only; use a classified variable.

| Property | Editor | Bindable |
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

Category: `input`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `checked`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`, `value`

**Secure input:** values are write-only; use a classified variable.

| Property | Editor | Bindable |
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

Category: `input`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `checked`, `options`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`, `value`

**Secure input:** values are write-only; use a classified variable.

| Property | Editor | Bindable |
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

Category: `structure`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `columns`, `gap`, `value`, `open`, `orientation`, `size`, `arrayVariable`, `itemKey`, `limit`

| Property | Editor | Bindable |
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

Category: `structure`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `columns`, `gap`, `value`, `open`, `orientation`, `size`, `arrayVariable`, `itemKey`, `limit`

| Property | Editor | Bindable |
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

Category: `structure`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `columns`, `gap`, `value`, `open`, `orientation`, `size`, `arrayVariable`, `itemKey`, `limit`

| Property | Editor | Bindable |
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

Category: `structure`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `columns`, `gap`, `value`, `open`, `orientation`, `size`, `arrayVariable`, `itemKey`, `limit`

| Property | Editor | Bindable |
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

Category: `structure`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `columns`, `gap`, `value`, `open`, `orientation`, `size`, `arrayVariable`, `itemKey`, `limit`

| Property | Editor | Bindable |
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

Category: `structure`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `columns`, `gap`, `value`, `open`, `orientation`, `size`, `arrayVariable`, `itemKey`, `limit`

| Property | Editor | Bindable |
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

Category: `structure`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `columns`, `gap`, `value`, `open`, `orientation`, `size`, `arrayVariable`, `itemKey`, `limit`

| Property | Editor | Bindable |
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

Category: `structure`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `columns`, `gap`, `value`, `open`, `orientation`, `size`, `arrayVariable`, `itemKey`, `limit`

| Property | Editor | Bindable |
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

Category: `structure`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `columns`, `gap`, `value`, `open`, `orientation`, `size`, `arrayVariable`, `itemKey`, `limit`

| Property | Editor | Bindable |
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

Category: `structure`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `columns`, `gap`, `value`, `open`, `orientation`, `size`, `arrayVariable`, `itemKey`, `limit`

| Property | Editor | Bindable |
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

Category: `structure`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `columns`, `gap`, `value`, `open`, `orientation`, `size`, `arrayVariable`, `itemKey`, `limit`

| Property | Editor | Bindable |
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

Category: `data`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `ds`, `output`, `trigger`, `debounceMs`, `queryVariable`, `value`, `rows`, `columns`, `rowKey`, `labelField`, `valueField`, `chartType`

| Property | Editor | Bindable |
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

Category: `data`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `ds`, `output`, `trigger`, `debounceMs`, `queryVariable`, `value`, `rows`, `columns`, `rowKey`, `labelField`, `valueField`, `chartType`

| Property | Editor | Bindable |
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

Category: `data`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `ds`, `output`, `trigger`, `debounceMs`, `queryVariable`, `value`, `rows`, `columns`, `rowKey`, `labelField`, `valueField`, `chartType`

| Property | Editor | Bindable |
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

Category: `data`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `ds`, `output`, `trigger`, `debounceMs`, `queryVariable`, `value`, `rows`, `columns`, `rowKey`, `labelField`, `valueField`, `chartType`

| Property | Editor | Bindable |
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

Category: `data`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `ds`, `output`, `trigger`, `debounceMs`, `queryVariable`, `value`, `rows`, `columns`, `rowKey`, `labelField`, `valueField`, `chartType`

| Property | Editor | Bindable |
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

Category: `data`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `ds`, `output`, `trigger`, `debounceMs`, `queryVariable`, `value`, `rows`, `columns`, `rowKey`, `labelField`, `valueField`, `chartType`

| Property | Editor | Bindable |
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

Category: `data`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `ds`, `output`, `trigger`, `debounceMs`, `queryVariable`, `value`, `rows`, `columns`, `rowKey`, `labelField`, `valueField`, `chartType`

| Property | Editor | Bindable |
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

Category: `data`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `ds`, `output`, `trigger`, `debounceMs`, `queryVariable`, `value`, `rows`, `columns`, `rowKey`, `labelField`, `valueField`, `chartType`

| Property | Editor | Bindable |
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

Category: `action`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `variant`, `size`, `loading`, `confirm`, `iconKey`, `outcome`, `code`, `target`, `value`, `scheduledAt`, `timeZone`

| Property | Editor | Bindable |
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

Category: `action`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `variant`, `size`, `loading`, `confirm`, `iconKey`, `outcome`, `code`, `target`, `value`, `scheduledAt`, `timeZone`

| Property | Editor | Bindable |
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

Category: `action`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `variant`, `size`, `loading`, `confirm`, `iconKey`, `outcome`, `code`, `target`, `value`, `scheduledAt`, `timeZone`

| Property | Editor | Bindable |
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

Category: `action`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `variant`, `size`, `loading`, `confirm`, `iconKey`, `outcome`, `code`, `target`, `value`, `scheduledAt`, `timeZone`

| Property | Editor | Bindable |
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

Category: `action`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `variant`, `size`, `loading`, `confirm`, `iconKey`, `outcome`, `code`, `target`, `value`, `scheduledAt`, `timeZone`

| Property | Editor | Bindable |
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

Category: `action`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `variant`, `size`, `loading`, `confirm`, `iconKey`, `outcome`, `code`, `target`, `value`, `scheduledAt`, `timeZone`

| Property | Editor | Bindable |
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

Category: `action`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `variant`, `size`, `loading`, `confirm`, `iconKey`, `outcome`, `code`, `target`, `value`, `scheduledAt`, `timeZone`

| Property | Editor | Bindable |
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

Category: `action`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `variant`, `size`, `loading`, `confirm`, `iconKey`, `outcome`, `code`, `target`, `value`, `scheduledAt`, `timeZone`

| Property | Editor | Bindable |
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

Category: `media`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `altKey`, `durationSec`, `timer`, `value`, `tone`, `max`, `feature`

| Property | Editor | Bindable |
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

Category: `media`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `altKey`, `durationSec`, `timer`, `value`, `tone`, `max`, `feature`

| Property | Editor | Bindable |
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

Category: `media`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `altKey`, `durationSec`, `timer`, `value`, `tone`, `max`, `feature`

| Property | Editor | Bindable |
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

Category: `media`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `altKey`, `durationSec`, `timer`, `value`, `tone`, `max`, `feature`

| Property | Editor | Bindable |
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

Category: `media`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `altKey`, `durationSec`, `timer`, `value`, `tone`, `max`, `feature`

| Property | Editor | Bindable |
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

Category: `media`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `checked`, `value`, `min`, `max`, `step`, `maxLength`, `currency`, `mask`, `country`

| Property | Editor | Bindable |
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

Category: `media`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `altKey`, `durationSec`, `timer`, `value`, `tone`, `max`, `feature`

| Property | Editor | Bindable |
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

Category: `media`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `altKey`, `durationSec`, `timer`, `value`, `tone`, `max`, `feature`

| Property | Editor | Bindable |
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

Category: `media`

Events: `onPress`, `onChange`, `onBlur`, `onRead`, `onSuccess`, `onError`, `onElapsed`, `onClear`

Bindable props: `labelKey`, `titleKey`, `descriptionKey`, `hintKey`, `placeholderKey`, `required`, `disabled`, `itemPath`, `altKey`, `durationSec`, `timer`, `value`, `tone`, `max`, `feature`

| Property | Editor | Bindable |
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

