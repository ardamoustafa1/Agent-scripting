package com.genesyslab.platform.commons.protocol;

/** Compile-only stub (see README.md). */
public abstract class ClientChannel {
  public void setClientName(String name) { throw new UnsupportedOperationException("stub"); }
  public void setMessageHandler(MessageHandler handler) { throw new UnsupportedOperationException("stub"); }
  public void open() throws Exception { throw new UnsupportedOperationException("stub"); }
  public void close() throws Exception { throw new UnsupportedOperationException("stub"); }
  public void send(Message message) throws Exception { throw new UnsupportedOperationException("stub"); }
  public ChannelState getState() { throw new UnsupportedOperationException("stub"); }
}
