package io.verbis.engage.sidecar.cti;

/** Stable machine code + retry hint, answered to the hub as `{ok:false, code, retryable}`. */
public class CtiCommandException extends Exception {
  private final String code;
  private final boolean retryable;

  public CtiCommandException(String code, boolean retryable, String message) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }

  public String code() {
    return code;
  }

  public boolean retryable() {
    return retryable;
  }
}
