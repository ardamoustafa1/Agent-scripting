# connector-avaya-aes-sidecar

Java 21 + Spring Boot sidecar for the Avaya connectors. See
[docs/connectors/avaya.md](../../docs/connectors/avaya.md) and
[ADR-0020](../../docs/adr/0020-avaya-connectors.md).

One sidecar process serves one Verbis connector. Choose the platform with `SIDECAR_SOURCE`:

| `SIDECAR_SOURCE` | What it does                                                                                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aes`            | Avaya Aura AES over JTAPI/TSAPI. It observes agent stations and VDNs and reads the UCID, UUI, VDN and skill.                                                                  |
| `aacc`           | Avaya Aura Contact Center. It receives CCT WS-Notification pushes on `POST /aacc/notify` and uses CCMM web services for contact intrinsics, contact details and CloseContact. |
| `replay`         | Replays recorded envelopes. For development and tests only.                                                                                                                   |

Outbound is an add-on to either platform (`OUTBOUND_SYSTEM=pom|pc`):

- the dialer record is recognised from UUI or intrinsics;
- the result goes to POM web services or to the Proactive Contact Agent API.

Envelopes are published to NATS JetStream (`verbis.connector.avaya.<connectorId>.event.v1`).
Commands and verify requests arrive on request/reply subjects.

```bash
gradle test                                         # unit + Testcontainers NATS (Docker)
gradle bootJar -Pavaya.jtapi=/opt/avaya/ecsjtapia.jar   # with the Avaya JTAPI SDK (DevConnect)
docker build --build-arg JTAPI=lib/ecsjtapia.jar -t verbis/avaya-sidecar .
```

Example settings are in `infra/avaya/*.env.example`. Passwords and tokens are always mounted
files; they are never put in environment variables.
