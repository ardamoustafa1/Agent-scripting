# Connector capabilities

Bu tablo connector kodunun ilan ettiği desteği gösterir; kanal lisansı, deployment sürümü ve aşağıdaki koşullar ayrıca geçerlidir. Marketplace fixture testleri yazıldı, çalıştırılmadı; vendor facade/sandbox doğrulaması sürüyor.

| Connector / kind | Kanal | Write-back | Wrap-up | Kayıt kontrolü |
|---|---|---|---|---|
| Genesys Cloud / cloud | voice, chat, email, sms, whatsapp, social, callback | Participant attributes | Codes | Pause/resume |
| Genesys Engage / workspace, sidecar | voice, chat, email, sms, whatsapp, social | Attached data | Disposition / outbound result | Hayır |
| Avaya AES / sidecar | voice | Hayır | Outbound result / recorder tag (config) | Recorder hook (config) |
| Avaya AACC / sidecar | voice, email, chat, sms, social | Intrinsics | Disposition | Recorder hook (config) |
| Avaya AXP / workspaces | voice, chat, email, sms, whatsapp, social | Hayır | Wrap-up | Recorder hook (config) |
| Amazon Connect / contact-events | voice, chat, email, callback | Contact attributes (InitialContactId) | Native code store yok; ACW event alınır | Voice Suspend/ResumeContactRecording, IAM + active recording gerekir |
| Cisco Webex / desktop-widget | voice, chat, email | CAD / call variables (writable fields) | Native disposition facade | İlan edilmez |
| Cisco UCCE/PCCE / finesse-gadget | voice | callVariable1..10 + user.* ECC | Native wrap-up reason facade | İlan edilmez |
| NICE CXone / agent-api | voice, chat, email, sms | Contact custom data facade | Disposition facade | İlan edilmez |
| Five9 / desktop-toolkit | voice, chat, email | Call variables facade | Disposition facade | İlan edilmez |
| Twilio Flex / flex-plugin (generic) | voice, chat, sms, whatsapp | TaskRouter attributes merge | Complete/disposition facade | İlan edilmez |
| Salesforce / salesforce-open-cti (generic) | voice context; telephony upstream | Hayır (CRM launch-only) | Upstream CTI | Upstream CTI |
| Dynamics 365 / dynamics-cif (generic) | voice context; telephony upstream | Hayır (CRM launch-only) | Upstream CTI | Upstream CTI |
| Generic / webhook | voice, chat, email, sms, whatsapp, social, video, callback | Signed callback (config) | Signed callback (config) | Hayır |
| Generic / simulator | voice, chat, email, sms, whatsapp, social, video, callback | Simulated | Simulated | Simulated |

CRMler CTI sağlayıcısı değildir; CRM record ownership launch kanıtı olamaz. Tüm yeni connectorlar transfer/end/freshness kontrolleri ve server bridge üzerinden yeniden doğrulama uygular. Flex/CRM generic kinds mevcut DB enumunu genişletmez. [Ortak kurulum](SETUP.md), platform rehberleri ve SDK portları destek koşullarının kaynağıdır.
