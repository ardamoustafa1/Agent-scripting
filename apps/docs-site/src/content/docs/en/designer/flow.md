---
title: "Flow design"
---

A flow determines screen order. Start at the entry node and connect every page, decision, action,
service and subflow. Make branch/default precedence explicit and avoid unbounded loops. Service
timeout/error branches must leave an actionable path.

![Schematic page-service-decision flow](/guides/flow-en.svg)

Subflows encapsulate shared operations with declared input/output variables. Link a pinned version
from the shared screen library or take a detached copy. Reuse linked pages across multiple campaign
scripts. Updating a shared version never silently changes published script pins: review and publish
new versions explicitly.

Validation reports missing references, unreachable nodes/pages and schema errors. Runtime never
selects a flow from caller URL parameters; the server-selected pinned document is executed.
