# ADR 0053 — TCKN, VKN and IBAN are agent-typed KVKK fields; only card numbers use hosted capture

Status: Accepted · 2026-10-20 · Decided by the product owner after a live authoring review. Partially supersedes the secure-field rule in [SCRIPT_MODEL](../SCRIPT_MODEL.md#screen-component-catalog-step-27) and [SECURITY](../SECURITY.md) (hosted capture for every "secure" input).

## Context

`tcknInput`, `vknInput`, `ibanInput` and `creditCardInput` shared one implementation: a hosted
capture iframe on a separate origin (`SecureInput`, ADR-0039/ADR-0045). The value never entered
Verbis DOM or state; only a receipt did. Without a tenant capture provider the control rendered
`components.secureUnavailable` and accepted no input.

That is the right model for card numbers (PCI DSS scope reduction). It does not fit Turkish
identity and banking identifiers:

- They are personal data under KVKK, not cardholder data. KVKK requires purpose limitation,
  minimisation, access control and masking; it does not require a separate capture origin.
- Identity verification by TCKN is a core contact-centre task. With no provider configured the
  field is unusable in the designer preview, demos and most deployments, and no provider ships
  with Verbis.
- The runtime already classifies by sensitivity: `RuntimeStore.setVariable(key, value, 'pii')`
  raises a variable to PII regardless of its declaration, and logging/audit/persistence redaction
  is driven by that classification.

## Decision

1. **Card numbers only use hosted capture.** `SECURE_INPUT_TYPES` is `creditCardInput`. Its
   behaviour, schema (`SecureInputSchema`), PCI classification, memory-only retention and receipt
   validation are unchanged.
2. **TCKN, VKN and IBAN are personal-ID inputs.** They render as ordinary inputs with the
   existing validators (`isTCKN`, `isVKN`, `isIBAN`). Writes go through
   `setVariable(binding, value, 'pii')`, so the bound variable is PII even if an author declared
   it `internal`. The property panel marks their `value` as sensitive.
3. **Masked at rest on screen.** When the field does not have focus, it shows only the last four
   characters (`•••••••1234`). Input is normalised (digits only for TCKN/VKN, upper case without
   spaces for IBAN) and `autocomplete` is off.
4. **Existing documents.** A node that explicitly stores `secure: true` keeps the hosted capture
   path, so a tenant that already relies on a provider sees no change. New nodes default to the
   typed path.
5. **No other control is weakened.** PII redaction in logs, audit diffs, SessionEvents and
   analytics; `persist: false` by default; PCI rules; the "no URL-parameter launch" rule; and
   designer health checks for unclassified sensitive variables stay as they are.

## Consequences

- Agents can verify identity in every environment, including designer preview and demos.
- The raw identifier is present in the agent browser while the session is active, like a phone
  number or address. Deployments that must keep TCKN out of the agent browser can still store
  `secure: true` on the node and configure a capture provider.
- Tests: component behaviour (typed entry, normalisation, masking, PII write, validator) and the
  existing secure-input tests now target `creditCardInput`.
