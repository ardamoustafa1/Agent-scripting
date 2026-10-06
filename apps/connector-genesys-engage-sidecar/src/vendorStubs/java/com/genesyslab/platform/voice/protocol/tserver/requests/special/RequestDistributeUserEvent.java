package com.genesyslab.platform.voice.protocol.tserver.requests.special;

import com.genesyslab.platform.commons.collections.KeyValueCollection;
import com.genesyslab.platform.commons.protocol.Message;
import com.genesyslab.platform.voice.protocol.ConnectionId;

/** Compile-only stub (see README.md). */
public class RequestDistributeUserEvent implements Message {
  public int messageId() { throw new UnsupportedOperationException("stub"); }
  public static RequestDistributeUserEvent create() { throw new UnsupportedOperationException("stub"); }
  public void setThisDN(String dn) { throw new UnsupportedOperationException("stub"); }
  public void setConnID(ConnectionId connId) { throw new UnsupportedOperationException("stub"); }
  public void setUserData(KeyValueCollection userData) { throw new UnsupportedOperationException("stub"); }
}
