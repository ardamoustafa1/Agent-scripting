# ADR 0057 — In-script knowledge base

Status: Accepted · 2026-10-22 · Product owner request: "2. Script içinde bilgi bankası. Ajan
sayfadan çıkmadan soruya cevap bulsun. Şu anki `knowledgeLink` bileşeni sadece bir bağlantı."
Builds on [ADR-0032](0032-tenant-ai-and-human-review.md) (AI path),
[ADR-0052](0052-live-agent-ai.md) (transcript triggers) and
[ADR-0056](0056-runtime-data-source-calls-authorized-by-the-session.md) (session-authorized reads).

## Context

An agent who needs an answer during a call has two options today: the `knowledgeLink` component
opens an external page in a new tab (the agent leaves the script), and the side panel's
"Knowledge base" tab lists whatever strings a connector put in `interaction.context.knowledge`.
Neither lets the agent search, read an answer next to the script, or get a grounded answer to a
question. Competitors ship this as "agent assist": searchable articles beside the guidance,
articles surfaced by what the customer says, and an AI answer that cites them.

## Decision

### 1. Knowledge articles are tenant content in Verbis

- New tenant-owned aggregate `KnowledgeArticle` (`knowledge_articles`, RLS, soft delete never
  used): `key` (stable kebab-case, unique per tenant, immutable), `title` (≤ 160), `body`
  (≤ 20,000 characters), `tags` (≤ 10 × ≤ 40), `locale` (BCP 47), `status`
  (`draft` | `published` | `archived`), `version` (optimistic lock), `publishedAt`, author
  columns.
- Scripts and triggers reference an article by `key`, like data sources (`tenant-datasource:<key>`)
  rather than by row id, so a script stays readable and survives package export/import into a
  tenant that has articles with the same keys.
- **Body format.** Plain text with three line rules: a blank line starts a paragraph, a line
  starting with `## ` is a subheading, lines starting with `- ` (or `1. `) form a list. It is
  parsed into a small block tree (`parseArticleBody`, `@verbis/shared-types`) and rendered as
  React elements; there is no HTML, no links and no `dangerouslySetInnerHTML` (SECURITY §5.2).
- **Lifecycle.** Create → `draft`. `publish` (from draft or archived) and `archive` (from draft or
  published). Edits are allowed in any state; editing a published article changes what agents see
  at once (the audit trail keeps the before/after text). Articles are reference material, not
  script wording: legal and must-read text stays in the versioned script.
- **Authorization.** New matrix resource `knowledge` → subject `KnowledgeArticle` with `read`,
  `create`, `update`, `publish`, `manage`. `script_designer` reads, creates and updates;
  `script_approver` reads and publishes/archives; `tenant_admin` has all. Articles are
  tenant-wide (no campaign scope in this version).
- **Audit and events.** `knowledge.article.created`, `.updated`, `.published`, `.archived` with
  redacted before/after in the same transaction, plus outbox events
  `verbis.knowledge.article.<verb>.v1` carrying ids and metadata only.

### 2. Search

- Title, tags and body are folded with the same Turkish-aware `foldText` the transcript triggers
  use (`@verbis/script-schema`) into search columns, and a generated weighted `tsvector`
  (`simple` configuration: title A, tags B, body C) with a GIN index serves the query.
- The query is folded into words (letters and digits only, at most 12), so no user text reaches
  the tsquery syntax. Words of three or more letters match as prefixes ("iade" finds "iadesi").
  All words must match; when that finds nothing, a ranked any-word search without common
  Turkish/English stop words runs instead. Results are ranked by `ts_rank_cd`; snippets are cut
  in the application around the first matching word.
- Search text is never stored, logged, audited or sent to analytics: agents type customers'
  words into it.

### 3. Agents read through their own session

- `POST /v1/sessions/{id}/desktop/knowledge/search` (`{ q, limit }`, a POST so the words never
  sit in a URL) and `GET /v1/sessions/{id}/desktop/knowledge/{key}` return **published** articles
  only. They follow
  ADR-0056: the caller must be the SSO owner of an `active`, `paused` or `wrapup` interaction
  session it may read; no `KnowledgeArticle` permission is needed, and none is granted to the
  `agent` role. Reading an article is not audited (it is not personal data).
- Authoring uses `/v1/knowledge-articles` (all states, `read:KnowledgeArticle`), with
  `GET …/search` and `GET …/by-key/{key}` for pickers. The designer canvas and preview show
  published articles only, exactly what an agent would see.

### 4. Where agents see articles

- **Side panel "Knowledge base" tab**: search box, results with snippets, an in-place reader
  ("Back to results"), and the connector-provided `context.knowledge` items below. Alt+K opens
  the tab and focuses the search box (same rules as the other Alt shortcuts).
- **`knowledgePanel` screen component**: placed on a page by the designer; shows up to 10 pinned
  articles (by key) as expandable sections that are read in place, and optionally a search box
  over the published knowledge base. Content is fetched live; a missing or unpublished article shows a neutral
  placeholder, never an error that blocks the page. `knowledgeLink` stays for external pages.
- **Trigger action `suggestArticle`** (`articleKey`): a transcript trigger can offer an article
  ("The customer mentioned a refund — open *Refund policy*?"). Opening it resolves the prompt as
  accepted and shows the article in the side panel; nothing opens by itself.

### 5. AI answer grounded in articles

- New AI task `answer` on the ADR-0032 path (tenant AI and `agentEnabled`, PII gate, quota,
  audit, human approval). Input: the agent's question (the agent may start from the last customer
  line of a voice transcript, editing it before sending).
- The service retrieves the five best published articles with the search above (no hits → the
  service answers "not found" without a model call and without spending quota). The model sees
  them as untrusted data (title + body, at most 4,000 characters each, 12,000 in total) and must
  answer `{ answer, articleKeys }`. Keys outside the retrieved set are rejected; an answer without
  a citation is shown as "not found in the knowledge base".
- The agent sees the answer with links to its sources, marked as an AI suggestion to check before
  telling the customer. Nothing is sent to the customer or written into the script.

## Consequences

- Additive: no script `schemaVersion` bump (new component type and trigger action), no API version
  bump. Documents without the new component or action, and tenants without articles, behave as
  before.
- A script that references a key with no published article still validates and publishes; the
  designer's article picker marks a key with no article (or one not published). Runtime shows a
  neutral "not published right now" note.
- Follow-ups: external knowledge sources (Confluence, ServiceNow, SharePoint) through connectors;
  campaign or team visibility of articles; article view and "no result" counts in analytics
  (without query text); semantic (embedding) search, which needs `pgvector` and its own ADR;
  review/approval with separation of duties for articles.
