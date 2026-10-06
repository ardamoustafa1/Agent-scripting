package io.verbis.engage.sidecar.envelope;

import com.fasterxml.jackson.annotation.JsonInclude;

/** Agent reference; the hub picks the configured identity (employeeId by default). */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record EngageAgent(String employeeId, String userName, String agentLoginId, String dn, String place) {

  public String identity(String kind) {
    return switch (kind) {
      case "userName" -> userName;
      case "agentLoginId" -> agentLoginId;
      default -> employeeId;
    };
  }
}
