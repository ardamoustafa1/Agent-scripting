# A tablosu — yerel kabul kanıtları

2026-10-06: son sıralı lint → typecheck → build → test → Chromium e2e koşusu.
`workspace-tests-latest.log` son root testidir; Turbo cache hit sonuçları logda görünür.
`oauth-red.log` kasıtlı başarısız regression kanıtıdır, final kabul sayılmaz;
`oauth-green.log` düzeltmeden sonraki başarılı koşudur.

- `coverage.json`: 18 workspace kapsam raporu ve güvenlik yolu sonuçları.
- `chromium-summary.json` / `e2e-final.log`: Designer 260, Admin 48, Agent 37, Docs 12; skip/flaky/error 0.
- `browser-budgets.log`: 500.000 byte normal chunk sınırı, ayrı istek yapılan ELK worker istisnası.
- `recovery-api-real.log`: gerçek PostgreSQL/Redis REST/Yjs conflict kurtarma regresyonu.
- `deploy.log`, `helm-lint.log`, `nginx.log`, `helm-nginx.log`: deployment guard ve iki Nginx syntax kontrolü.
- Üç `*-actual.png`: incelenmiş açık/koyu desktop ve yüksek kontrast mobile örnekleri.
- `manifest.json`: kanıtların ve birleşik yerel çalışma ağacındaki değişmiş kaynakların SHA-256 envanteri. Önceki yetkili değişiklikleri de içerir; tek bu A işiyle ilişkilendirme veya commit iddiası taşımaz.

Uzak repo/branch protection/CI, canlı vendor/PSP/staging ve yatay Yjs oda çoğaltma kabulü değildir.
Detay: [doğrulama raporu](../../OPEN_ITEMS_2026-10-06.md).
