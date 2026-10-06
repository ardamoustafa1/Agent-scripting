package io.verbis.engage.sidecar.config;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** Non-secret settings; secrets come from files (NATS creds, Config Server password). */
@ConfigurationProperties(prefix = "verbis.sidecar")
public record SidecarProperties(
    String connectorId,
    String source,
    String agentIdentity,
    Nats nats,
    Replay replay,
    Psdk psdk) {

  public record Nats(List<String> servers, String credsFile, String stream, boolean createStream) {}

  public record Replay(String file) {}

  public record Endpoint(String name, String host, int port, String backupHost, int backupPort) {}

  public record ConfigServer(String host, int port, String user, String passwordFile) {}

  public record Psdk(
      String applicationName,
      Endpoint tserver,
      Endpoint ixnServer,
      ConfigServer configServer,
      List<String> dns,
      List<String> userDataAllowList) {}
}
