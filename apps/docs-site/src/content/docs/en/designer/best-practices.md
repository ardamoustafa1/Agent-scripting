---
title: "Best practices"
---

Keep screens short with one decision and clear next/back actions. Mark required spoken text
mustRead; keep consent separate from disclosure. Provide heading hierarchy, labels, visible focus,
keyboard paths and non-color status cues. Use classified secure components for PII/PAN; never move
such values into public literals, preview fixtures, logs or audit diffs.

Share version-pinned screens. Avoid network calls on each keystroke: use debounce, manual triggers
and bounded caches. Keep service responses small and typed. Give agents a speakable error and retry
path. Test mutually exclusive campaign conditions; lower priority wins. Publish with a precise change note.
