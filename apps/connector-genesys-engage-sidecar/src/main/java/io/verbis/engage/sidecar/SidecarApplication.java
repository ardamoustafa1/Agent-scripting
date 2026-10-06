package io.verbis.engage.sidecar;

import io.verbis.engage.sidecar.config.SidecarProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

/** Genesys Engage sidecar: Platform SDK → NATS (ADR-0019). No WDE, no agent-state changes. */
@SpringBootApplication
@EnableConfigurationProperties(SidecarProperties.class)
public class SidecarApplication {
  public static void main(String[] args) {
    SpringApplication.run(SidecarApplication.class, args);
  }
}
