package io.verbis.avaya.sidecar;

import io.verbis.avaya.sidecar.config.SidecarProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

/** Avaya sidecar: AES JTAPI / AACC CCMM+CCT / POM / Proactive Contact → NATS (ADR-0020). */
@SpringBootApplication
@EnableConfigurationProperties(SidecarProperties.class)
public class SidecarApplication {
  public static void main(String[] args) {
    SpringApplication.run(SidecarApplication.class, args);
  }
}
