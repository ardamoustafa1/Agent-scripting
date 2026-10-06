package io.verbis.engage.sidecar.cti.psdk;

import com.genesyslab.platform.commons.protocol.Message;
import com.genesyslab.platform.openmedia.protocol.interactionserver.events.*;
import io.verbis.engage.sidecar.envelope.EngageAgent;
import io.verbis.engage.sidecar.envelope.EngageEnvelope;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Interaction Server reporting events → envelopes (chat, email, SMS, WhatsApp, social).
 * Reporting events carry the interaction id, media type, agent/place and the user data
 * (`Subject`, `FromAddress`, `FirstName` …). Email bodies and chat transcripts are read from UCS
 * on demand (follow-up), not pushed through events.
 */
final class IxnMapper {
  private final String server;
  private final ConfigDirectory directory;
  private final List<String> allowList;
  private final AtomicLong sequence = new AtomicLong();

  IxnMapper(String server, ConfigDirectory directory, List<String> allowList) {
    this.server = server;
    this.directory = directory;
    this.allowList = allowList;
  }

  EngageEnvelope map(Message message) {
    String event;
    if (message instanceof EventAgentInvited) event = "ringing";
    else if (message instanceof EventPartyAdded) event = "established";
    else if (message instanceof EventPartyRemoved) event = "released";
    else if (message instanceof EventProcessingStopped) event = "markedDone";
    else if (message instanceof EventRevoked) event = "abandoned";
    else if (message instanceof EventPropertiesChanged) event = "attachedDataChanged";
    else return null;
    var reporting = new ReportingView(message);
    if (reporting.interactionId() == null) return null;
    EngageAgent agent = directory.agentById(reporting.agentId());
    var userData = EngageEnvelope.flatten(PsdkCtiSource.toMap(reporting.userData()), allowList);
    String media = media(reporting.mediaType());
    EngageEnvelope.Email email = "email".equals(media)
        ? new EngageEnvelope.Email(String.valueOf(userData.getOrDefault("FromAddress", "")), List.of(), String.valueOf(userData.getOrDefault("Subject", "")), "")
        : null;
    EngageEnvelope.Chat chat = "chat".equals(media) || "webchat".equals(media)
        ? new EngageEnvelope.Chat(userData.get("FirstName") instanceof String s ? s : null, List.of())
        : null;
    return new EngageEnvelope(
        EngageEnvelope.SCHEMA,
        server + ":" + reporting.interactionId() + ":" + event + ":" + sequence.incrementAndGet(),
        "ixn",
        event,
        Instant.now().toString(),
        reporting.interactionId(),
        null,
        media,
        "Inbound",
        agent,
        null,
        null,
        null,
        reporting.queue(),
        userData,
        email,
        chat);
  }

  private static String media(String type) {
    if (type == null) return "workitem";
    return switch (type.toLowerCase()) {
      case "chat", "email", "sms", "whatsapp", "webchat", "facebook", "twitter" -> type.toLowerCase();
      default -> "workitem";
    };
  }
}
