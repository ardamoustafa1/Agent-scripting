---
title: "Roller, audit ve güvenlik"
---

System roller: tenant_admin, security_auditor, script_designer, script_approver, integration_engineer,
campaign_manager, supervisor, agent, report_viewer. super_admin platform scope’una aittir. Kullanıcıya
kampanya/team/site kapsamı verin; görev ayrımı ve self-approval engellerini koruyun.

Audit ekranında UTC tarih, action, actor, outcome ve correlation ID ile filtreleyin. Zincir
verification’ı ilgili aralıkta çalıştırın; başarısız doğrulama alarmdır, kayıt silerek düzeltilmez.
Audit export ve hassas okuma da kaydedilir. Key rotation’da eski verification public key’lerini koruyun.

Güvenlik: exact HTTPS app/frame originleri, secure cookie, CSRF, short-lived launch grant, mTLS service
client, Secret store, SSRF allow-list, PII/PAN sınıflandırması ve legal hold/retention. Simulator production’da
kapalıdır. Break-glass hesabı zorunlu MFA/TOTP ve ayrı yetkili prosedür ister; demo seed bunu açmaz.
