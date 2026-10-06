---
title: "Web service integration"
---

1. An integration engineer creates a REST, SOAP or GraphQL source. Its base URL/endpoint must meet
   the tenant allow-list; avoid private addresses, redirects and credentials in query strings.
2. Define input/output JSON Schema, request/response mapping and success/empty/error/delay mocks.
   Select only declared response fields; never map secret values.
3. Store credentials in the Secret store; definitions carry Secret UUID references only. Browser
   code receives no credentials.
4. Set timeout, retry, concurrency, breaker and cache budgets. Use an isolated/disabled cache policy
   for PII and configure classification/redaction paths.
5. Select the saved datasource ID and pinned version in Designer, map input expressions and output
   variables, and connect both error handling and retry navigation.
6. Preview mock mapping first. Live tests require dev/test profiles and execute permission;
   production promotion needs a different approver.

Demo sources set `mock.enabled=true`; `.invalid` endpoints never become external calls. These mocks
are not production services. Before retrying payments/orders/write-back, configure upstream idempotency.
