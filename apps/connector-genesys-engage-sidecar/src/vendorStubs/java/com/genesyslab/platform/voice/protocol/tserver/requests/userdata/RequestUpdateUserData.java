package com.genesyslab.platform.voice.protocol.tserver.requests.userdata;

import com.genesyslab.platform.commons.collections.KeyValueCollection;
import com.genesyslab.platform.commons.protocol.Message;
import com.genesyslab.platform.voice.protocol.ConnectionId;

/** Compile-only stub (see README.md). */
public class RequestUpdateUserData implements Message {
  public int messageId() { throw new UnsupportedOperationException("stub"); }
  public static RequestUpdateUserData create(String dn, ConnectionId connId, KeyValueCollection userData) { throw new UnsupportedOperationException("stub"); }
}
