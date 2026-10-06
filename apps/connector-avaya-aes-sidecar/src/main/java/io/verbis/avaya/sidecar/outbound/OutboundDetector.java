package io.verbis.avaya.sidecar.outbound;

import io.verbis.avaya.sidecar.envelope.AvayaEnvelope;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Recognises dialer calls from data the dialer attaches to the call:
 * - POM: UUI / intrinsics keys `POM_CMP` (campaign), `POM_CID` (contact id), `POM_CL` (list);
 * - Proactive Contact: `PC_JOB` (job), `PC_REC` (record), `PC_LIST` (calling list).
 * Key names are configurable per deployment (docs/connectors/avaya.md §Outbound, assumption O1).
 * Any other `k=v` pairs become record fields.
 */
public final class OutboundDetector {
  private final String system;

  public OutboundDetector(String system) {
    this.system = system == null ? "none" : system;
  }

  public AvayaEnvelope detect(AvayaEnvelope envelope) {
    if ("none".equals(system) || envelope.outbound() != null) return envelope;
    Map<String, String> data = new LinkedHashMap<>(envelope.intrinsics());
    if (envelope.uui() != null && "ascii".equals(envelope.uuiEncoding())) {
      for (String pair : envelope.uui().split("\\|")) {
        int at = pair.indexOf('=');
        if (at > 0) data.putIfAbsent(pair.substring(0, at).trim(), pair.substring(at + 1).trim());
      }
    }
    String campaign = data.remove("pom".equals(system) ? "POM_CMP" : "PC_JOB");
    String record = data.remove("pom".equals(system) ? "POM_CID" : "PC_REC");
    String list = data.remove("pom".equals(system) ? "POM_CL" : "PC_LIST");
    if (campaign == null || record == null) return envelope;
    Map<String, Object> fields = new LinkedHashMap<>();
    data.forEach((k, v) -> { if (fields.size() < 100 && k.length() <= 64) fields.put(k, v.length() > 1_000 ? v.substring(0, 1_000) : v); });
    return envelope.withOutbound(new AvayaEnvelope.Outbound(system, campaign, list, record, fields));
  }
}
