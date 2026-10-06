package io.verbis.avaya.sidecar;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.verbis.avaya.sidecar.config.SourcePolicy;
import org.junit.jupiter.api.Test;

class SourcePolicyTest {
  @Test
  void requiresAnExplicitSource() {
    assertThatThrownBy(() -> SourcePolicy.resolve(null, true)).isInstanceOf(IllegalStateException.class).hasMessageContaining("required");
    assertThatThrownBy(() -> SourcePolicy.resolve("  ", true)).isInstanceOf(IllegalStateException.class).hasMessageContaining("required");
  }

  @Test
  void rejectsUnknownSourcesInsteadOfFallingBackToReplay() {
    assertThatThrownBy(() -> SourcePolicy.resolve("replay-typo", true)).isInstanceOf(IllegalStateException.class).hasMessageContaining("unknown");
    assertThatThrownBy(() -> SourcePolicy.resolve("AES", true)).isInstanceOf(IllegalStateException.class);
  }

  @Test
  void refusesReplayUnlessExplicitlyAllowed() {
    assertThatThrownBy(() -> SourcePolicy.resolve("replay", false)).isInstanceOf(IllegalStateException.class).hasMessageContaining("SIDECAR_ALLOW_REPLAY");
    assertThat(SourcePolicy.resolve("replay", true)).isEqualTo("replay");
  }

  @Test
  void acceptsPlatformSources() {
    for (String source : SourcePolicy.PLATFORM_SOURCES) assertThat(SourcePolicy.resolve(" " + source + " ", false)).isEqualTo(source);
  }
}
