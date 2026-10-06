package io.verbis.avaya.sidecar.config;

import java.util.Set;

/**
 * Fail-closed CTI source selection (audit T-08). The source must be configured explicitly; an
 * unknown value aborts startup instead of silently falling back, and the recorded-event replay
 * source is refused unless dev/test explicitly opts in with SIDECAR_ALLOW_REPLAY=true.
 */
public final class SourcePolicy {
  public static final String REPLAY = "replay";
  public static final Set<String> PLATFORM_SOURCES = Set.of("aes", "aacc");

  private SourcePolicy() {}

  public static String resolve(String source, boolean allowReplay) {
    if (source == null || source.isBlank())
      throw new IllegalStateException("SIDECAR_SOURCE is required (one of " + PLATFORM_SOURCES + ")");
    String value = source.trim();
    if (REPLAY.equals(value)) {
      if (!allowReplay)
        throw new IllegalStateException("SIDECAR_SOURCE=replay is for dev/test only; set SIDECAR_ALLOW_REPLAY=true to use it");
      return value;
    }
    if (!PLATFORM_SOURCES.contains(value))
      throw new IllegalStateException("unknown SIDECAR_SOURCE; expected one of " + PLATFORM_SOURCES + " or replay");
    return value;
  }
}
