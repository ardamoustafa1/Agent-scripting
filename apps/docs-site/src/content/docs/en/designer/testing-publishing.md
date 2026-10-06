---
title: "Testing, approval and publishing"
---

- Validate schema/semantics and inspect TR/EN text, keyboard access and light/dark modes.
- Try success/failure decisions, empty responses, timeout and service-error branches with mocks.
- Preview is a separate session kind, not a real interaction, connector command or production write-back.
- Submit with semver and change note. An old review round cannot approve a revised submission.
- Separate authorship and approval. Published checksums are pinned; active agents keep their starting version.
- Campaign managers configure pinned/latestPublished policy, channel/locale/queue/skill conditions and priority.
- Accept simulator→agent→wrap-up in an isolated demo. Failed write-back remains visible and retries idempotently.

Rollback is also an authorized, audited publication. A new version never silently replaces an active agent document.
