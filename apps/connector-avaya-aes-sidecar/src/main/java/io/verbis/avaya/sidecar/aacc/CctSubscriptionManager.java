package io.verbis.avaya.sidecar.aacc;

import java.net.URI;
import java.time.Duration;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Creates, renews and removes the CCT WS-BaseNotification subscription (M-28), so operators no
 * longer register the callback by hand. The callback URL carries a signed token
 * ({@link NotifyTokenSigner}); a notification is authentic only while its subscription is active
 * (revoked on unsubscribe or re-subscribe, fail closed). The subscription manager URL returned by
 * CCT must stay on the CCT host over https. NOT verified against a real AACC/CCT: operation shapes
 * follow OASIS WS-BaseNotification 1.3 (docs/connectors/avaya.md, assumption C4).
 */
public final class CctSubscriptionManager implements AutoCloseable {
  private static final Logger log = LoggerFactory.getLogger(CctSubscriptionManager.class);
  private static final String WSNT = "http://docs.oasis-open.org/wsn/b-2";

  public record Response(int status, String body) {}

  public interface SoapTransport {
    Response post(URI url, String soapAction, String body) throws Exception;
  }

  /** Periodic task scheduler; the returned runnable cancels it. */
  public interface Scheduler {
    Runnable every(Duration period, Runnable task);
  }

  private final SoapTransport transport;
  private final URI cct;
  private final URI callbackBase;
  private final NotifyTokenSigner signer;
  private final Duration ttl;
  private final Scheduler scheduler;
  private final Supplier<String> ids;
  private String activeId;
  private URI managerUrl;
  private Runnable cancel;

  public CctSubscriptionManager(SoapTransport transport, URI cct, URI callbackBase, NotifyTokenSigner signer, Duration ttl, Scheduler scheduler, Supplier<String> ids) {
    if (!"https".equals(cct.getScheme()) || !"https".equals(callbackBase.getScheme())) throw new IllegalArgumentException("CCT and callback URLs must be https");
    if (ttl.compareTo(Duration.ofSeconds(60)) < 0) throw new IllegalArgumentException("ttl must be at least 60 s");
    this.transport = transport;
    this.cct = cct;
    this.callbackBase = callbackBase;
    this.signer = signer;
    this.ttl = ttl;
    this.scheduler = scheduler;
    this.ids = ids;
  }

  public synchronized void start() {
    if (cancel != null) return;
    cancel = scheduler.every(ttl.dividedBy(2), this::tick);
    subscribe();
  }

  public synchronized boolean active() {
    return activeId != null;
  }

  /** Whether notifications bearing this local subscription id may be accepted. */
  public synchronized boolean isActive(String subscriptionId) {
    return subscriptionId != null && subscriptionId.equals(activeId);
  }

  private synchronized void tick() {
    if (activeId == null || !renew()) subscribe();
  }

  private void subscribe() {
    String id = ids.get();
    String callback = callbackBase.toString().replaceAll("/+$", "") + "/aacc/notify/" + signer.issue(id);
    String previousId = activeId;
    URI previousManager = managerUrl;
    try {
      Response response = transport.post(cct, WSNT + "/Subscribe", SoapXml.envelope(WSNT,
          "<wsnt:Subscribe xmlns:wsnt=\"" + WSNT + "\" xmlns:wsa=\"http://www.w3.org/2005/08/addressing\"><wsnt:ConsumerReference><wsa:Address>"
              + SoapXml.escape(callback) + "</wsa:Address></wsnt:ConsumerReference><wsnt:InitialTerminationTime>" + duration() + "</wsnt:InitialTerminationTime></wsnt:Subscribe>"));
      if (response.status() / 100 != 2) throw new IllegalStateException("subscribe status " + response.status());
      var reference = SoapXml.first(SoapXml.parse(response.body()), "SubscriptionReference");
      String address = reference == null ? null : SoapXml.text(reference, "Address");
      URI manager = address == null ? null : URI.create(address);
      if (manager == null || !"https".equals(manager.getScheme()) || !cct.getHost().equalsIgnoreCase(manager.getHost()))
        throw new IllegalStateException("subscription manager is not on the CCT host");
      activeId = id; // the previous callback token is revoked from this point on
      managerUrl = manager;
      if (previousId != null && previousManager != null) unsubscribe(previousManager);
    } catch (Exception e) {
      log.warn("CCT subscribe failed: {}", e.getClass().getSimpleName());
      activeId = null;
      managerUrl = null;
    }
  }

  private boolean renew() {
    try {
      Response response = transport.post(managerUrl, WSNT + "/Renew", SoapXml.envelope(WSNT,
          "<wsnt:Renew xmlns:wsnt=\"" + WSNT + "\"><wsnt:TerminationTime>" + duration() + "</wsnt:TerminationTime></wsnt:Renew>"));
      return response.status() / 100 == 2;
    } catch (Exception e) {
      log.warn("CCT renew failed: {}", e.getClass().getSimpleName());
      return false;
    }
  }

  private void unsubscribe(URI manager) {
    try {
      transport.post(manager, WSNT + "/Unsubscribe", SoapXml.envelope(WSNT, "<wsnt:Unsubscribe xmlns:wsnt=\"" + WSNT + "\"/>"));
    } catch (Exception e) {
      log.warn("CCT unsubscribe failed: {}", e.getClass().getSimpleName());
    }
  }

  private String duration() {
    return "PT" + ttl.toSeconds() + "S";
  }

  @Override
  public synchronized void close() {
    if (cancel != null) cancel.run();
    cancel = null;
    URI manager = managerUrl;
    activeId = null; // revoke first: fail closed even if CCT is unreachable
    managerUrl = null;
    if (manager != null) unsubscribe(manager);
  }
}
