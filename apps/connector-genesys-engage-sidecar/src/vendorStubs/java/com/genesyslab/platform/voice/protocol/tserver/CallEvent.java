package com.genesyslab.platform.voice.protocol.tserver;

import com.genesyslab.platform.commons.collections.KeyValueCollection;
import com.genesyslab.platform.commons.protocol.Message;
import com.genesyslab.platform.voice.protocol.ConnectionId;

/** Compile-only stub (see README.md). */
public abstract class CallEvent implements Message {
  public int messageId() { throw new UnsupportedOperationException("stub"); }
  public String getThisDN() { throw new UnsupportedOperationException("stub"); }
  public KeyValueCollection getUserData() { throw new UnsupportedOperationException("stub"); }
  public ConnectionId getConnID() { throw new UnsupportedOperationException("stub"); }
  public CallType getCallType() { throw new UnsupportedOperationException("stub"); }
  public String getANI() { throw new UnsupportedOperationException("stub"); }
  public String getDNIS() { throw new UnsupportedOperationException("stub"); }
  public String getThisQueue() { throw new UnsupportedOperationException("stub"); }
  public int getEventSequenceNumber() { throw new UnsupportedOperationException("stub"); }
}
