package com.genesyslab.platform.voice.protocol.tserver.requests.dn;

import com.genesyslab.platform.commons.protocol.Message;
import com.genesyslab.platform.voice.protocol.tserver.AddressType;
import com.genesyslab.platform.voice.protocol.tserver.ControlMode;
import com.genesyslab.platform.voice.protocol.tserver.RegisterMode;

/** Compile-only stub (see README.md). */
public class RequestRegisterAddress implements Message {
  public int messageId() { throw new UnsupportedOperationException("stub"); }
  public static RequestRegisterAddress create(String dn, RegisterMode mode, ControlMode control, AddressType type) { throw new UnsupportedOperationException("stub"); }
}
