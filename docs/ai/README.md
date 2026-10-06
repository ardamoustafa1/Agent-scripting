# Tenant AI assistant

AI is **off by default**. Configure the deployment catalogue and a locally hosted PII detector,
then use Admin → AI to select an approved provider/residency/model and an existing Secret reference.
No provider credential, prompt, response or extracted document is persisted in application logging,
audit events, an idempotency response cache, or the AI ledger. The browser retains suggestions only
in component memory. Explicitly approved script drafts and agent notes use their existing storage,
classification, lifecycle approval and audit paths.

## Deployment

1. Deploy the migration `20261003180000_ai` through the normal API migration command. It enables
   FORCE RLS for the monthly usage and call ledger. This session did not apply the migration.
2. Build API (`pnpm --filter @verbis/api build`); DOCX/PDF extraction uses the compiled, static
   `import-worker.js` in a worker with a 5-second timeout and 256 MB old-generation heap budget.
   Worker heap limits do not cap native allocations: production upload parsing also needs
   deployment/container memory limits. DOCX only (no legacy DOC/macros), ≤1.5 MB compressed, ≤2 MB verified expansion; PDF ≤100 pages,
   ≤64,000 extracted characters. Image-only PDFs require an upstream, tenant-approved OCR workflow.
   The current PDF.js version has removed the old `isEvalSupported` option. No PDF action is executed.
3. Set deployment variables, without putting credentials in the catalogue:

```dotenv
AI_ENABLED=false
AI_ENDPOINTS_JSON=[]
AI_REDACTOR_JSON=
```

Example approved endpoint catalogue (documentation IPs only):

```json
[
 {"id":"claude-approved","provider":"anthropic","url":"https://api.anthropic.com/v1/messages","residency":"contract-approved-region","models":["operator-approved-model"],"addresses":["203.0.113.10"]},
 {"id":"azure-eu","provider":"azure","url":"https://approved-resource.openai.azure.com/openai/v1/chat/completions","residency":"EU regional deployment","models":["approved-deployment-name"],"addresses":["203.0.113.11"]},
 {"id":"local-tr","provider":"onprem","url":"https://model.internal.example/v1/chat/completions","residency":"TR on-prem","models":["approved-local-model"],"addresses":["10.40.0.10"]}
]
```

Addresses are exact **operator-maintained** DNS pins, checked before opening a socket. Update pins
when provider DNS changes. HTTPS, certificate validation, response bounds and no redirects apply.
RFC1918 destinations are accepted only when pinned; loopback, link-local and cloud metadata addresses
remain denied. Private endpoints need a trusted TLS certificate. A tenant cannot add network targets.
Residency labels reflect operator/vendor contractual attestation, not inferred geography. In Azure,
choose a regional deployment rather than assuming a Global/DataZone deployment provides the same
residency. Verify provider retention, training-use and cross-border terms before approving a catalogue
entry. [Azure REST](https://learn.microsoft.com/en-us/azure/foundry/openai/latest),
[Claude API](https://platform.claude.com/docs/en/api/overview).

4. Deploy a **local** PII recognizer (for example your reviewed Turkish/English NER + classification
   service). `AI_REDACTOR_JSON` is `{"url":"https://pii.internal.example/redact","addresses":["10.40.0.20"]}`.
   It receives `{text,locale}` and must return `{text,count,complete:true}`. It must recognize names,
   addresses, identifiers, financial and contact details, never log input, never call a remote model,
   never restore masked data, and return `complete:false` on uncertain/unsupported input. It should
   preserve JSON keys, component IDs, variable identifiers and safe expression syntax. Traffic to it
   is operator-pinned RFC1918 HTTPS only. Regex masking runs before and after local recognition.
   **This repo provides the transport/contract and fail-closed gate, not a trained NER service.**
   No regex-only fallback is allowed; detector failure prevents the LLM call. Accuracy must be
   independently evaluated on synthetic TR/EN adversarial fixtures before enabling a tenant.
5. Store the provider key in Secrets (`api_key`), select its metadata in Admin → AI, configure the
   model/deployment, monthly token/budget quotas, tariff in integer micro-USD per million tokens, and
   maximum output tokens. Then turn on deployment and tenant switches; separately enable agent AI.
   Tenant rates are accounting estimates, not provider invoices or live pricing.

## Authorization and review

Designer Studio `/ai` requires Script creation permission. Existing script-aware API callers can
supply `scriptId`, checked against scoped campaign Script read permission. Submitted documents are
structurally/semantically validated; generated drafts are validated again. Scenarios require a valid
source document and are checked with the script validator before returning. Word/PDF import is only
available for draft generation. Improved text and translation can be copied after review; scenario
JSON can be reviewed and imported through the existing preview scenario authoring workflow. A
reviewed draft creates a Script and a draft version; it never invokes publication.

Agent API calls require SSO, ownership/update permission and a securely launched interaction session.
Replies/objections are chat/email only while active/paused. Summaries are wrap-up/completed/abandoned;
voice summaries require an available transcript. Source transcript, allowed current-page objection
IDs and campaign disposition codes come from the server. The browser cannot substitute interaction
identities or open a session by URL. Model-invented disposition/node references are rejected.
Replies are copied by an explicit click; summaries/dispositions become editable draft preferences.
No reply is sent and no outcome is submitted automatically. Observer/offline tabs cannot apply.

Content lives in a JSON `UNTRUSTED_DATA` user message, distinct from server-owned system instructions.
No tool API is provided. Zod validates every model response; invalid JSON, schema or references fail
closed with RFC7807 and metered audit. This reduces injection impact; it does not claim an LLM can
never follow hostile prose. Human review is the execution boundary. Legal checklists are counsel
review suggestions, never a compliance certification.

## Quotas, audit and recovery

The suggestion route explicitly owns short tenant transactions; database connections never span
redactor/provider network I/O. Reservation and append-only audit commit before the provider call.
Reservations use conservative UTF-8 byte token bounds, configured output limits and immutable tariff
values. Atomic conditional updates enforce token and monetary quotas, plus four in-flight calls per
tenant. `(tenant_id,request_id)` is unique: duplicates never create another billable call and outputs
are not stored for replay. No automatic provider retries occur.

Provider usage reconciles the reservation, including calls with invalid output. Unknown usage keeps
the full reservation; over-reported usage disables tenant AI, records actual usage and requires admin
review. Budget controls cannot undo charges from a dishonest/incorrect upstream usage report. Month
assignment is fixed when reserving, including calls finishing across midnight. Audit has masked input
hash, provider/residency, model, task, token counts and accounted cost; no original content.

If a process crashes, the quota reservation remains charged. Admin's reconciliation action marks
reservations older than five minutes unknown and frees concurrency slots, without refunding spend.
Audit is hash-chained through the existing writer. Operators should reconcile provider invoices and
retain minimal call metadata under the tenant's policy; no raw AI transcript archive is introduced.

## Tests (written; not run)

```sh
pnpm test:ai
pnpm test:ai --integration
pnpm test:ai --e2e
pnpm --filter @verbis/ui exec vitest run src/components/ai-assistant.spec.tsx
```

Unit tests cover disabled defaults, secret boundaries, provider contracts, injection separation,
output validation, SSRF pins, masking and human-review separation. Integration code checks FORCE RLS
and concurrent quota reservation. Playwright checks no write/publication during generation, CSRF and
axe. Real provider keys, local NER accuracy, migration execution, browsers and tests were not exercised.
