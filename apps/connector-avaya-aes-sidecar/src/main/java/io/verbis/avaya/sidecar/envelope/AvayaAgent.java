package io.verbis.avaya.sidecar.envelope;

import com.fasterxml.jackson.annotation.JsonInclude;

/** Agent reference: ACD login id, station extension, AACC agent handle. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AvayaAgent(String loginId, String extension, String handle) {}
