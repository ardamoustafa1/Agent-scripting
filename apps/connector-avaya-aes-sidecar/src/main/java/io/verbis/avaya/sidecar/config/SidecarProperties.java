package io.verbis.avaya.sidecar.config;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** Non-secret settings; passwords/tokens are mounted files (`*-file`). */
@ConfigurationProperties(prefix = "verbis.sidecar")
public record SidecarProperties(String connectorId, String source, boolean allowReplay, Nats nats, Replay replay, Aes aes, Aacc aacc, Outbound outbound) {
  public record Nats(List<String> servers, String credsFile, String stream, boolean createStream) {}

  public record Replay(String file) {}

  public record Aes(String tlink, String servers, String user, String passwordFile, List<String> extensions, List<String> vdns, String uuiEncoding) {}

  public record Aacc(String ccmmUrl, String ccmmUser, String ccmmPasswordFile, String notifySecretFile, List<String> intrinsicsAllowList,
      String cctUrl, String cctUser, String cctPasswordFile, String callbackBaseUrl, Integer subscriptionTtlSeconds) {}

  public record Outbound(String system, String pcHost, int pcPort, String pcUser, String pcPasswordFile, String pomUrl) {}
}
