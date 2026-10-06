package io.verbis.avaya.sidecar.outbound;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Avaya Proactive Contact Agent API message framing (assumption O3, docs/connectors/avaya.md):
 * `<keyword><RS><type><RS><origin><RS><invokeId><RS><count>[<RS><data>…]<LF>` with RS = 0x1E,
 * type C (command), A (ack), D (data), R (response), N (notification); origin is the client name.
 */
public final class PcAgentProtocol {
  public static final char RS = 0x1E;
  public static final char LF = '\n';

  private PcAgentProtocol() {}

  public record Message(String keyword, char type, String origin, String invokeId, List<String> data) {}

  public static byte[] command(String keyword, String origin, String invokeId, String... data) {
    for (String part : data) if (part.indexOf(RS) >= 0 || part.indexOf(LF) >= 0) throw new IllegalArgumentException("separator in data");
    StringBuilder out = new StringBuilder(keyword).append(RS).append('C').append(RS).append(origin).append(RS).append(invokeId).append(RS).append(data.length);
    for (String part : data) out.append(RS).append(part);
    return out.append(LF).toString().getBytes(StandardCharsets.US_ASCII);
  }

  public static Message parse(String line) {
    String[] parts = line.replace("\n", "").split(String.valueOf(RS), -1);
    if (parts.length < 5 || parts[1].length() != 1) throw new IllegalArgumentException("not a PC agent message");
    int count = Integer.parseInt(parts[4]);
    List<String> data = new ArrayList<>();
    for (int i = 0; i < count && 5 + i < parts.length; i++) data.add(parts[5 + i]);
    return new Message(parts[0], parts[1].charAt(0), parts[2], parts[3], List.copyOf(data));
  }
}
