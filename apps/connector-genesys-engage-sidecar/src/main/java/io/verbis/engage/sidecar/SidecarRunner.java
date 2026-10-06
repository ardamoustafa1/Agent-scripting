package io.verbis.engage.sidecar;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.nats.client.Connection;
import io.nats.client.Nats;
import io.nats.client.Options;
import io.verbis.engage.sidecar.config.SidecarProperties;
import io.verbis.engage.sidecar.config.SourcePolicy;
import io.verbis.engage.sidecar.cti.CtiSource;
import io.verbis.engage.sidecar.cti.ParticipantRegistry;
import io.verbis.engage.sidecar.cti.replay.ReplayCtiSource;
import io.verbis.engage.sidecar.nats.NatsBridge;
import java.io.FileInputStream;
import java.time.Duration;
import java.util.List;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;

/** Wires source → bridge on startup; health = NATS connected and the CTI source connected. */
@Component
public class SidecarRunner implements ApplicationRunner, HealthIndicator, AutoCloseable {
  private final SidecarProperties props;
  private final ObjectMapper mapper;
  private Connection connection;
  private CtiSource source;
  private NatsBridge bridge;
  private String sourceName;

  public SidecarRunner(SidecarProperties props, ObjectMapper mapper) {
    this.props = props;
    this.mapper = mapper;
  }

  @Override
  public void run(ApplicationArguments args) throws Exception {
    sourceName = SourcePolicy.resolve(props.source(), props.allowReplay());
    var options = Options.builder()
        .servers(props.nats().servers().toArray(String[]::new))
        .connectionName("verbis-engage-sidecar-" + props.connectorId())
        .maxReconnects(-1)
        .reconnectWait(Duration.ofSeconds(2));
    if (props.nats().credsFile() != null && !props.nats().credsFile().isBlank())
      options.authHandler(Nats.credentials(props.nats().credsFile()));
    connection = Nats.connect(options.build());
    if (props.nats().createStream()) NatsBridge.ensureStream(connection, props.nats().stream());
    var registry = new ParticipantRegistry(props.agentIdentity());
    source = createSource(registry);
    bridge = new NatsBridge(connection, mapper, source, props.connectorId());
    bridge.start();
    source.start(bridge::publish);
  }

  private CtiSource createSource(ParticipantRegistry registry) throws Exception {
    if (SourcePolicy.REPLAY.equals(sourceName)) {
      String file = props.replay().file();
      List<io.verbis.engage.sidecar.envelope.EngageEnvelope> envelopes =
          file == null || file.isBlank() ? List.of() : ReplayCtiSource.read(new FileInputStream(file), mapper);
      return new ReplayCtiSource(envelopes, registry);
    }
    // Platform SDK adapter: compiled only with the licensed PSDK (see build.gradle.kts).
    Class<?> type = Class.forName("io.verbis.engage.sidecar.cti.psdk.PsdkCtiSource");
    return (CtiSource) type.getConstructor(SidecarProperties.class, ParticipantRegistry.class).newInstance(props, registry);
  }

  @Override
  public Health health() {
    boolean nats = connection != null && connection.getStatus() == Connection.Status.CONNECTED;
    boolean cti = source != null && source.connected();
    return (nats && cti ? Health.up() : Health.down()).withDetail("nats", nats).withDetail("cti", cti).withDetail("source", sourceName == null ? "unset" : sourceName).build();
  }

  @Override
  public void close() throws Exception {
    if (source != null) source.close();
    if (bridge != null) bridge.close();
    if (connection != null) connection.close();
  }
}
