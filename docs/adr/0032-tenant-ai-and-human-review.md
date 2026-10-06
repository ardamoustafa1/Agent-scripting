# ADR-0032: Tenant AI, local PII recognition and review boundary

Status: accepted for implementation, deployment verification pending. Date: 2026-10-03.

AI is opt-in at deployment and tenant level; agent guidance has a separate switch. Approved endpoint
catalogues carry provider, TLS origin/path, exact DNS address pins, models and operator-attested data
residency. Tenants choose entries and their own encrypted Secret references, never arbitrary URLs.
Claude Messages, Azure OpenAI v1 Chat Completions and OpenAI-compatible on-prem adapters use a common
completion/usage contract. A local, independently reviewed recognizer must certify input redaction;
pattern masking alone cannot claim to identify arbitrary names/addresses. Missing recognition blocks
calls rather than sending unreviewed PII. The recognizer implementation is a deployment dependency.

All responses are suggestions with human approval required. Validated ScriptDocuments may become
drafts only after review. Scenario output uses synthetic schema; agent references are constrained to
the authoritative pinned script/campaign. No generation path publishes, executes tools, sends a
message or submits an outcome. Prompts use an untrusted-data user message and no tool interfaces.

**Narrow transaction exception:** the AI suggestion route uses `OwnTenantTransactions` instead of a
request-long transaction. LLM calls can exceed the normal 15-second DB timeout; holding a DB transaction
would exhaust the pool and roll back audit after a provider has already billed. This explicitly marked
route keeps RLS/ABAC on every SQL operation, commits a reservation + audit, performs network I/O without
SQL, then commits usage + completion audit. Other routes retain the normal unit of work. Generic
idempotency replay is disabled so it cannot retain source or output; a unique request ID in the ledger
prevents duplicate spend. A crashed call retains quota and is administratively marked unknown.

Monthly integer token/micro-USD ledgers use tenant FORCE RLS and conditional row updates. Usage
underreporting cannot be proven locally; upstream discrepancies disable tenant AI and are audited.
Quotas represent configured tariff estimates, not vendor invoice guarantees. No raw model content is
stored in AI ledger/audit. Existing Script and Session permissions apply; configuration/usage require
Tenant management, Secret configuration also requires Secret management. A provider-residency choice
is contractual/operator-attested, not a geographic claim derived from its hostname.

DOCX/PDF extraction uses a static local worker, bounded file/page/expansion sizes, heap and deadline.
No uploaded code is imported; no OCR or legacy DOC is introduced. See [deployment guide](../ai/README.md).

Tests are authored and explicitly unexecuted per the user's instruction. Live provider integration,
local recognizer recall, deployment/migration and browser/axe acceptance remain pending.
