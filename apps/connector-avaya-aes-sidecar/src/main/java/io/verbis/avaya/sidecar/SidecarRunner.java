package io.verbis.avaya.sidecar;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.nats.client.Connection;
import io.nats.client.Nats;
import io.nats.client.Options;
import io.verbis.avaya.sidecar.aacc.AaccCtiSource;
import io.verbis.avaya.sidecar.aacc.AaccMapper;
import io.verbis.avaya.sidecar.aacc.CcmmClient;
import io.verbis.avaya.sidecar.aacc.CctNotificationController;
import io.verbis.avaya.sidecar.aacc.CctSubscriptionManager;
import io.verbis.avaya.sidecar.aacc.HttpSoapTransport;
import io.verbis.avaya.sidecar.aacc.NotifyTokenSigner;
import io.verbis.avaya.sidecar.config.SidecarProperties;
import io.verbis.avaya.sidecar.config.SourcePolicy;
import io.verbis.avaya.sidecar.cti.CtiSource;
import io.verbis.avaya.sidecar.cti.ParticipantRegistry;
import io.verbis.avaya.sidecar.cti.replay.ReplayCtiSource;
import io.verbis.avaya.sidecar.nats.NatsBridge;
import io.verbis.avaya.sidecar.outbound.OutboundClient;
import io.verbis.avaya.sidecar.outbound.OutboundDetector;
import io.verbis.avaya.sidecar.outbound.PcAgentClient;
import io.verbis.avaya.sidecar.outbound.PomWebServiceClient;
import java.io.FileInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;

/** Wires the configured source (aes | aacc | replay) + outbound client → NATS bridge. */
@Component
public class SidecarRunner implements ApplicationRunner, HealthIndicator, CctNotificationController.AaccEndpoint, AutoCloseable {
  private final SidecarProperties props;
  private final ObjectMapper mapper;
  private Connection connection;
  private CtiSource source;
  private NatsBridge bridge;
  private NotifyTokenSigner signer;
  private CctSubscriptionManager subscriptions;
  private java.util.concurrent.ScheduledExecutorService renewals;
  private String sourceName;

  public SidecarRunner(SidecarProperties props, ObjectMapper mapper) {
    this.props = props;
    this.mapper = mapper;
  }

  @Override
  public void run(ApplicationArguments args) throws Exception {
    sourceName = SourcePolicy.resolve(props.source(), props.allowReplay());
    var options = Options.builder().servers(props.nats().servers().toArray(String[]::new)).connectionName("verbis-avaya-sidecar-" + props.connectorId()).maxReconnects(-1).reconnectWait(Duration.ofSeconds(2));
    if (props.nats().credsFile() != null && !props.nats().credsFile().isBlank()) options.authHandler(Nats.credentials(props.nats().credsFile()));
    connection = Nats.connect(options.build());
    if (props.nats().createStream()) NatsBridge.ensureStream(connection, props.nats().stream());
    String identity = "aacc".equals(sourceName) ? "handle" : "loginId";
    var registry = new ParticipantRegistry(System.getenv().getOrDefault("SIDECAR_AGENT_IDENTITY", identity));
    OutboundClient outbound = outbound();
    var detector = new OutboundDetector(props.outbound() == null ? "none" : props.outbound().system());
    source = switch (sourceName) {
      case "aacc" -> {
        var aacc = props.aacc();
        // Fail closed: no signing secret / CCT / callback URL => the sidecar refuses to start.
        signer = new NotifyTokenSigner(Files.readString(Path.of(aacc.notifySecretFile())).trim().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        renewals = java.util.concurrent.Executors.newSingleThreadScheduledExecutor(r -> {
          var t = new Thread(r, "cct-subscription");
          t.setDaemon(true);
          return t;
        });
        subscriptions = new CctSubscriptionManager(
            new HttpSoapTransport(aacc.cctUser(), aacc.cctPasswordFile() == null || aacc.cctPasswordFile().isBlank() ? null : Files.readString(Path.of(aacc.cctPasswordFile())).trim()),
            java.net.URI.create(aacc.cctUrl()), java.net.URI.create(aacc.callbackBaseUrl()), signer,
            java.time.Duration.ofSeconds(aacc.subscriptionTtlSeconds() == null ? 3600 : aacc.subscriptionTtlSeconds()),
            (period, task) -> {
              var handle = renewals.scheduleWithFixedDelay(task, period.toSeconds(), period.toSeconds(), java.util.concurrent.TimeUnit.SECONDS);
              return () -> handle.cancel(false);
            },
            () -> java.util.UUID.randomUUID().toString());
        yield new AaccCtiSource(new AaccMapper(aacc.intrinsicsAllowList() == null ? List.of() : aacc.intrinsicsAllowList()),
            new CcmmClient(aacc.ccmmUrl(), aacc.ccmmUser(), Files.readString(Path.of(aacc.ccmmPasswordFile())).trim()), registry, detector, outbound);
      }
      case "aes" -> {
        // JTAPI adapter: compiled only with the Avaya JTAPI SDK (see build.gradle.kts).
        Class<?> type = Class.forName("io.verbis.avaya.sidecar.aes.AesJtapiSource");
        yield (CtiSource) type.getConstructor(SidecarProperties.Aes.class, ParticipantRegistry.class, OutboundDetector.class, OutboundClient.class).newInstance(props.aes(), registry, detector, outbound);
      }
      case SourcePolicy.REPLAY -> new ReplayCtiSource(
          props.replay().file() == null || props.replay().file().isBlank() ? List.of() : ReplayCtiSource.read(new FileInputStream(props.replay().file()), mapper), registry, outbound);
      default -> throw new IllegalStateException("unsupported source");
    };
    bridge = new NatsBridge(connection, mapper, source, props.connectorId());
    bridge.start();
    source.start(bridge::publish);
    if (subscriptions != null) subscriptions.start();
  }

  private OutboundClient outbound() throws Exception {
    var o = props.outbound();
    if (o == null || o.system() == null) return null;
    return switch (o.system()) {
      case "pom" -> new PomWebServiceClient(o.pomUrl(), "Bearer " + Files.readString(Path.of(System.getenv().getOrDefault("POM_TOKEN_FILE", "/run/secrets/pom-token"))).trim());
      case "pc" -> new PcAgentClient(o.pcHost(), o.pcPort(), o.pcUser(), o.pcPasswordFile());
      default -> null;
    };
  }

  @Override
  public boolean enabled() {
    return source instanceof AaccCtiSource;
  }

  @Override
  public boolean authentic(String token) {
    return signer != null && subscriptions != null && signer.verify(token).filter(subscriptions::isActive).isPresent();
  }

  @Override
  public AaccCtiSource source() {
    return (AaccCtiSource) source;
  }

  @Override
  public Health health() {
    boolean nats = connection != null && connection.getStatus() == Connection.Status.CONNECTED;
    boolean cti = source != null && source.connected() && (subscriptions == null || subscriptions.active());
    return (nats && cti ? Health.up() : Health.down()).withDetail("nats", nats).withDetail("cti", cti).withDetail("source", sourceName == null ? "unset" : sourceName).build();
  }

  @Override
  public void close() throws Exception {
    if (subscriptions != null) subscriptions.close();
    if (renewals != null) renewals.shutdownNow();
    if (source != null) source.close();
    if (bridge != null) bridge.close();
    if (connection != null) connection.close();
  }
}
