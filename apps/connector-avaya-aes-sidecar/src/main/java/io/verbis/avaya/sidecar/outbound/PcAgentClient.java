package io.verbis.avaya.sidecar.outbound;

import io.verbis.avaya.sidecar.cti.CtiCommandException;
import io.verbis.avaya.sidecar.envelope.AvayaCommand;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicInteger;
import javax.net.ssl.SSLSocketFactory;

/**
 * Proactive Contact result feedback over the Agent API (TLS socket). Logs on with a dedicated
 * application account, then per result: `AGTSetDataField` for record fields and
 * `AGTFinishedItem` with the completion code (assumption O3/O4). Synchronous and serialized.
 */
public final class PcAgentClient implements OutboundClient, AutoCloseable {
  private final String host;
  private final int port;
  private final String user;
  private final Path passwordFile;
  private final AtomicInteger invoke = new AtomicInteger();
  private Socket socket;
  private BufferedReader in;
  private OutputStream out;

  public PcAgentClient(String host, int port, String user, String passwordFile) {
    this.host = host;
    this.port = port;
    this.user = user;
    this.passwordFile = Path.of(passwordFile);
  }

  @Override
  public synchronized void result(AvayaCommand.OutboundResult result) throws CtiCommandException {
    try {
      ensureLoggedOn();
      for (var field : result.fields().entrySet()) call("AGTSetDataField", "C", field.getKey(), String.valueOf(field.getValue()));
      call("AGTFinishedItem", result.completionCode());
    } catch (CtiCommandException e) {
      throw e;
    } catch (Exception e) {
      close();
      throw new CtiCommandException("avaya_pc_unavailable", true, e.getClass().getSimpleName());
    }
  }

  private void ensureLoggedOn() throws Exception {
    if (socket != null && socket.isConnected() && !socket.isClosed()) return;
    socket = SSLSocketFactory.getDefault().createSocket(host, port);
    socket.setSoTimeout(10_000);
    in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII));
    out = socket.getOutputStream();
    call("AGTLogon", user, Files.readString(passwordFile).trim());
  }

  /** Sends one command and waits for its final response (R); a non-zero result code fails. */
  private void call(String keyword, String... data) throws Exception {
    String id = String.valueOf(invoke.incrementAndGet());
    out.write(PcAgentProtocol.command(keyword, "verbis", id, data));
    out.flush();
    while (true) {
      String line = in.readLine();
      if (line == null) throw new java.io.EOFException("PC closed the connection");
      var message = PcAgentProtocol.parse(line);
      if (!id.equals(message.invokeId()) || message.type() != 'R') continue;
      String code = message.data().isEmpty() ? "0" : message.data().get(0);
      if (!"0".equals(code) && !"M00000".equals(code)) throw new CtiCommandException("avaya_pc_refused", false, keyword + " " + code);
      return;
    }
  }

  @Override
  public synchronized void close() {
    try {
      if (socket != null) socket.close();
    } catch (Exception ignored) {
      // closing
    }
    socket = null;
  }
}
