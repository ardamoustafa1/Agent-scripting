package io.verbis.avaya.sidecar.aacc;

import static org.assertj.core.api.Assertions.assertThat;

import io.verbis.avaya.sidecar.aacc.CctSubscriptionManager.Response;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Queue;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** WS-BaseNotification flow against a fake CCT (unverified against a real AACC/CCT). */
class CctSubscriptionManagerTest {
  private static final URI CCT = URI.create("https://cct.example.test:9443/ws/notification");
  private static final URI CALLBACK = URI.create("https://verbis.example.test");
  private final NotifyTokenSigner signer = new NotifyTokenSigner("0123456789abcdef0123456789abcdef".getBytes(StandardCharsets.UTF_8));
  private final List<String[]> calls = new ArrayList<>();
  private final Queue<Response> replies = new ArrayDeque<>();
  private final List<Runnable> ticks = new ArrayList<>();
  private final AtomicInteger cancelled = new AtomicInteger();
  private final AtomicInteger ids = new AtomicInteger();
  private CctSubscriptionManager manager;

  private static Response subscribed(String address) {
    return new Response(200, "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\"><s:Body><wsnt:SubscribeResponse xmlns:wsnt=\"http://docs.oasis-open.org/wsn/b-2\" xmlns:wsa=\"http://www.w3.org/2005/08/addressing\"><wsnt:SubscriptionReference><wsa:Address>"
        + address + "</wsa:Address></wsnt:SubscriptionReference></wsnt:SubscribeResponse></s:Body></s:Envelope>");
  }

  private static final Response OK = new Response(200, "<ok/>");
  private static final String MANAGER = "https://cct.example.test:9443/ws/subscriptions/42";

  @BeforeEach
  void setUp() {
    manager = new CctSubscriptionManager(
        (url, action, body) -> {
          calls.add(new String[] {url.toString(), action, body});
          Response next = replies.poll();
          if (next == null) throw new java.io.IOException("no reply scripted");
          return next;
        },
        CCT, CALLBACK, signer, Duration.ofSeconds(3600),
        (period, task) -> {
          assertThat(period).isEqualTo(Duration.ofSeconds(1800));
          ticks.add(task);
          return cancelled::incrementAndGet;
        },
        () -> "sub-" + ids.incrementAndGet());
  }

  @Test
  void subscribesWithASignedCallbackAndSchedulesRenewal() {
    replies.add(subscribed(MANAGER));
    manager.start();
    assertThat(calls).hasSize(1);
    assertThat(calls.get(0)[0]).isEqualTo(CCT.toString());
    assertThat(calls.get(0)[1]).endsWith("/Subscribe");
    String body = calls.get(0)[2];
    assertThat(body).contains("https://verbis.example.test/aacc/notify/").contains("PT3600S");
    String token = body.substring(body.indexOf("/aacc/notify/") + "/aacc/notify/".length(), body.indexOf("</", body.indexOf("/aacc/notify/")));
    assertThat(signer.verify(token)).contains("sub-1");
    assertThat(manager.isActive("sub-1")).isTrue();
    assertThat(manager.active()).isTrue();
    assertThat(ticks).hasSize(1);
  }

  @Test
  void refusesASubscriptionManagerOnAnotherHostAndStaysInactive() {
    replies.add(subscribed("https://evil.example.test/ws/subscriptions/1"));
    manager.start();
    assertThat(manager.active()).isFalse();
    assertThat(manager.isActive("sub-1")).isFalse();
  }

  @Test
  void renewsOnTheSubscriptionManagerUrl() {
    replies.add(subscribed(MANAGER));
    manager.start();
    replies.add(OK);
    ticks.get(0).run();
    assertThat(calls.get(1)[0]).isEqualTo(MANAGER);
    assertThat(calls.get(1)[1]).endsWith("/Renew");
    assertThat(manager.isActive("sub-1")).isTrue();
  }

  @Test
  void resubscribesWhenRenewFailsAndRevokesTheOldCallback() {
    replies.add(subscribed(MANAGER));
    manager.start();
    replies.add(new Response(500, "fault"));
    replies.add(subscribed("https://cct.example.test:9443/ws/subscriptions/43"));
    ticks.get(0).run();
    assertThat(calls.get(2)[1]).endsWith("/Subscribe");
    assertThat(manager.isActive("sub-1")).isFalse();
    assertThat(manager.isActive("sub-2")).isTrue();
  }

  @Test
  void retriesSubscribeOnTheNextTickAfterAnOutage() {
    manager.start(); // no scripted reply => transport failure
    assertThat(manager.active()).isFalse();
    replies.add(subscribed(MANAGER));
    ticks.get(0).run();
    assertThat(manager.active()).isTrue();
  }

  @Test
  void unsubscribesOnStopAndDeactivatesEvenIfCctIsUnreachable() {
    replies.add(subscribed(MANAGER));
    manager.start();
    replies.add(OK);
    manager.close();
    assertThat(calls.get(1)[0]).isEqualTo(MANAGER);
    assertThat(calls.get(1)[1]).endsWith("/Unsubscribe");
    assertThat(manager.isActive("sub-1")).isFalse();
    assertThat(cancelled.get()).isEqualTo(1);

    replies.add(subscribed(MANAGER));
    var second = new CctSubscriptionManager((u, a, b) -> {
      if (b.contains("Unsubscribe")) throw new java.io.IOException("down");
      return subscribed(MANAGER);
    }, CCT, CALLBACK, signer, Duration.ofSeconds(3600), (p, t) -> () -> {}, () -> "x");
    second.start();
    second.close();
    assertThat(second.isActive("x")).isFalse();
  }

  @Test
  void rejectsInsecureUrlsAndNullIds() {
    org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class, () -> new CctSubscriptionManager(
        (u, a, b) -> OK, URI.create("http://cct.example.test/ws"), CALLBACK, signer, Duration.ofSeconds(60), (p, t) -> () -> {}, () -> "x"));
    org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class, () -> new CctSubscriptionManager(
        (u, a, b) -> OK, CCT, URI.create("http://verbis.example.test"), signer, Duration.ofSeconds(60), (p, t) -> () -> {}, () -> "x"));
    assertThat(manager.isActive(null)).isFalse();
  }
}
