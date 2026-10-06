# ADR 0033 — ASVS kanıt sınırı, strict CSP ve hosted secure fields

Durum: kabul edildi. Tarih: 2026-10-03.

ASVS 4.0.3 sürümünün tüm kimlikleri pinli envantere alınır. Kaynak kodu, yazılmış test,
yürütülen test ve deployment/organizasyon kanıtı birbirinden ayrılır. Çalıştırılmayan
bir kontrol PASS sayılmaz. Kimlik/session/tenant/crypto/API/PII kritik alanları L3
hedeflidir; uyumluluk ancak madde bazlı bağımsız doğrulamayla ileri sürülür.

Web edge yanıt bazında nginx request_id nonce üretir; HTML önbelleğe alınmaz.
Vite işareti server substitution ile değiştirilir. React text escaping korunur;
HTML richContent DOMPurify fragment → allowlisted React tree olur. Trusted Types
varsayılan bypass policy yoktur. Integrity-checked plugin'in statik srcDoc bootstrap'ı
tek kullanımlık policy input sınırından geçirilir; sandbox policy ağ/DOM sink kapalıdır.

Secure component ham değer taşımaz: farklı origin'de PSP iframe ve bağlı imzalı receipt
kullanır. Server-owned tenant public-key profili, ES256/EdDSA, kısa ömür, exact
issuer/audience/tenant/session/field, jti Redis NX replay gate'i gerekir. Provider
veya Redis yoksa fail closed. PSP'nin kendisi scope/kimliği doğrular; PCI sertifikası
ve capture origin dağıtımı operatör kanıtıdır. Mevcut script secure input UI'sı
provider yoksa artık kullanılamaz; bu bilinçli güvenlik davranışıdır.

PII snapshot/cache AES-GCM envelope korunur; V2 tenant KEK HKDF-SHA256 ile ayrıştırılır, V1 kayıtlar lazy migration için okunur. Hassas authoring defaults ve plaintext
read-model projeksiyonu yasaktır. Eski yayınlar operator-controlled migration ister.
Arama index'i bu sürümde yoktur; eklendiğinde tenant/domain-separated blind index gerekir.

Runtime Node 22 distroless Debian 12/nonroot; builder aynı Debian/libc ailesi.
CI HIGH/CRITICAL advisories'i unfixed olsa bile bloklar, SBOM ve passive isolated ZAP
ekler. Seccomp/read-only deployment şablonu admission policy ile zorunlu kılınmalıdır.
