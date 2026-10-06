---
title: "My first script"
---

## 1. Create the draft

Sign into Designer through SSO with `script_designer`. Choose **New script**, name it **My First Offer**,
choose Turkish and Voice, then create the first version. Palette, canvas and property panel edit the same draft.

![Schematic three-panel designer layout](/guides/designer-layout-en.svg)

_This is a labelled schematic, not a real screenshot. Capture instructions are in the docs-site README._

## 2. Place the screen

Drag `heading`, `scriptText`, `textInput` and `nextButton` onto Welcome. The palette **Add** action
provides a keyboard path. Two-way bind `textInput.value` to a public session variable named
`customerAlias`. Classify actual customer names as PII. Fill TR and EN message keys together;
never put customer data in literal props.

## 3. Add a rule and web service

Create boolean `eligible`. In the rule builder, select `vars.eligible == true`. Select a saved
**mock** REST service, pin its version and map the response to a variable. Preview makes no external
request; live testing requires a separately approved sandbox profile. [Web services](/en/designer/web-services/).

## 4. Connect the flow

Connect Welcome → service → decision → Offer / Alternative → End. Connect both decision branches,
service error handling and back navigation. Next buttons use the flow next action. [Flow](/en/designer/flow/).

## 5. Preview, approve and publish

Fix validation errors and try eligible/ineligible/error fixtures. Mock preview creates no real
interaction or write-back. Submit with change note and semver; a separate `script_approver` reviews
it. Publish with the appropriate permission, then assign the published version to a campaign.
[Testing and publishing](/en/designer/testing-publishing/).

Start a simulator call and accept its secure launch offer as the correct agent. Never open a
script by putting its ID in a URL. Backend verifies tenant, assignment, current participation and
single-use code.
