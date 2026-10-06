# @verbis/core-runtime

Designer önizlemesi ve yetkili agent oturumu aynı `Runtime` + `ScriptRenderer` kullanır. Paket saf JSON scriptini yorumlar; script içinden kod, HTML, URL veya plugin modülü yüklemez. Renderer yeni oturum açmaz; güvenli launch akışından dönen script ve session snapshot'ı host sağlar.

## Kurulum / host bağlantısı

```tsx
import { Runtime, ScriptRenderer, createCoreRegistry } from '@verbis/core-runtime';
import { createI18n } from '@verbis/i18n';
import { UiProvider } from '@verbis/ui';
import '@verbis/ui/tokens.css';
import '@verbis/ui/fonts.css'; // isteğe bağlı, yerel font dosyaları

const i18n = await createI18n('tr');
const registry = createCoreRegistry();
// Yerleşik library leaf'leri ve host tarafından güvenilmiş plugin adapter'ları burada kaydedilir.
const runtime = new Runtime({
  document: authorizedSession.document,
  session: authorizedSession.snapshot,
  registry,
  ports: {
    // BFF oturum çerezleri + CSRF; URL/tenant/credentials script tarafından seçilemez.
    dataSource: (request) => authenticatedBff.executeMappedDataSource(request),
    command: (action, values, signal) =>
      authenticatedBff.executeRuntimeCommand(action, values, signal),
    sessionEvent: (event) => debuggerOrRedactedEventQueue.enqueue(event),
    serverValidation: ({ pageIds, signal }) => authenticatedBff.validatePages(pageIds, signal),
    toast: (message, tone) => applicationNotifications.show(message, tone),
  },
});

// React ağacında:
<UiProvider i18n={i18n} theme="system">
  <ScriptRenderer runtime={runtime} />
</UiProvider>;
// Oturum sahibi host unmount/logout/revoke sırasında:
runtime.dispose();
```

Runtime örneğini her React render'ında yaratmayın; host `useMemo`/session yaşam döngüsü ile tutar. `ScriptRenderer` varsayılan olarak `runtime.start()` çağırır; kontrollü önizleme için `autoStart={false}` ve host başlangıcı kullanılır. CSP kullanan host `nonce` prop'unu sabit responsive stylesheet'e geçirir. Bir runtime aynı anda yalnızca bir aktif ekran/renderer sahibiyle kullanılmalıdır.

`session`: `{ variables?, interaction?, agent?, campaign?, const?, locale? }`. Zod sınırında doğrulanır, değişken source/default/type uygulanır. Global değişkenler salt okunurdur, page kapsamı sayfa değişiminde sıfırlanır. Session nesnelerini loglamayın/persist etmeyin; PCI yalnızca bellekte kalır.

## Üç primitif

| Tip          | Props                                                                                                                                                         | Event / davranış                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `box`        | `as` semantik allowlist, `role`, `direction`, `gap`, `padding`, `grid` 1–12, `wrap`, `scroll`, `align`, `justify`, `border`, `background` none/surface/raised | Child kabul eder; `node.style` base/sm/md/lg/xl token değerleri mobile-first uygulanır; `visibleWhen` node seviyesinde                                  |
| `button`     | `labelKey`, `iconKey` next/check/search/submit/link, `variant`, `size`, `disabled`, `loading`, `confirm: { titleKey, descriptionKey }`                        | `onPress` action zinciri; tekrar basma kilidi; Radix onayı; `a11y.shortcut` tam modifier eşleşmesi; input/composition/dialog içinde kısayol tetiklenmez |
| `webService` | `ds`, `visible`, `trigger` manual/onLoad/onEnter/onEvent/onChange/interval, `watch` expression listesi, `debounceMs`, `intervalMs`, `emptyWhen`               | `onSuccess`/`onError`; loading/hata/boş görünümü, retry; event için `runtime.request(nodeId)`; input değişimleri bağımlılık aboneliğiyle izlenir        |

WebService görünmez olsa da çağrı yapabilir. Aynı kaynak için son istek kazanır; eski istek iptal edilir ve cevabı publish edilmez. Timeout, unmount ve dispose iptal edilir. `callDataSource` action'ı kaynağı çalıştırır; bir WebService node'unun event zinciri yalnızca o node'un tetiklemesinde yürür. `dataSource.policy.trigger=onEnter` ayrıca sayfa girişinde engine tarafından çalışır; aynı kaynağı hem bu politika hem node `onEnter` ile otomatik çağırmayın. `cacheTtlSec` server integration policy'sidir; tarayıcı yeni cache/persistence yaratmaz.

`dataSource` port cevabı **tam olarak output adları → JSON değerleri** map'idir: `{ result: "demo" }`. `$.path` mapping sunucuda yapılır; ek alanlar/raw response reddedilir. Değişken çıktı tiplerinin tamamı doğrulanmadan hiçbir çıktı yazılmaz. Sunucu tenant, datasource version/izin, timeout/cache, output masking ve gerekli audit'i tekrar kontrol eder.

## Registry ve leaf sözleşmesi

`registry.register({ type, renderer, propsSchema, defaults, designerMeta, events, bindableProps, plugin? })` kayıt yapar. Duplicate tip, bilinmeyen prop binding/event, yanlış child/parent ve plugin pin uyuşmazlığı reddedilir. `list()` designer paletini, `canDrop(parentType, childType)` drag/drop kabulünü sağlar. Plugin adapter'ı host kodudur; manifestteki version/integrity host kaydıyla tam eşleşir. Bu kontrol executable plugin sandbox'ının yerine geçmez; üçüncü taraf kodunu iframe/SDK host'unda izole edin.

Renderer props: `{ node, props, runtime, enabled, required, children, emit, write }`. Leaf girdileri `write('value', value)` ile iki yönlü variable binding'e yazar; `emit('onChange')` event allowlist'inden action yürütür. Hataları erişilebilir input'a bağlamak için `runtime.errors.<nodeId>` içindeki message key'leri, `<nodeId>-errors` açıklama id'sini ve `aria-invalid` kullanın. `required`/`enabled` native girdilere iletilmelidir. Leaf'ler UI paketini ve core Box/Button/WebService bileşimlerini kullanır. `packages/components` bağımsız olarak leaf renderer'larını kaydeder; çekirdek bu üst katmanı import etmez.

Expression/rule bağımlılıkları `@verbis/expr` analiziyle çıkarılır. `useRuntimePaths(runtime, paths)`/`store.subscribe(paths, fn)` yalnızca ilgili değişken/ancestor/wildcard değişikliklerinde yayın alır. Snapshot revision'ları stabildir; batch bir dinleyiciyi bir kez çağırır; memo sibling'leri korur. Expression context statik bağımlılıklara daraltılır. Rule condition değerlendirmesi saf kalır; açık `runtime.runRule(id)` seçilen then/else zincirini yürütür.

## Aksiyonlar / debugger

22 Action tipi exhaustive switch ile yürütülür. Sequence sıralı; parallel kardeş hatasında iptal; AbortSignal host portlarına iletilir, host iptali görmezden gelse de zincir durur. Step/depth limitleri, flow maxSteps/edge maxIterations, subflow stack, next/back, page hooks, modal, timer, toast, mask, server command portları desteklenir. `validatePage` başarısız olunca onInvalid çalışır ve kalan zincir durur. Submit öncesi tüm script doğrulanır.

Her action started/completed/failed/cancelled (simülasyonda waiting) SessionEvent üretir. Event sadece sıra/action/phase/code içerir; değer, props, expression veya ham exception içermez. Bunlar debugger/oturum telemetrisidir. Authoritative AuditEvent, yetki kontrolü, connector capability ve transaction/outbox BFF/server portunda zorunludur. Port bulunmayan capability `VERBIS_CAPABILITY_UNAVAILABLE` ile reddedilir. Runtime hataları güvenli RFC7807 alanları taşıyan `RuntimeProblem` olarak döner.

```ts
const preview = new Runtime({
  document,
  registry,
  ports: { sessionEvent: debuggerEvents },
  simulation: true,
  simulationPorts: { dataSource: async () => ({ result: 'fixture' }) },
});
const run = preview.executor.execute(actions);
preview.executor.debugger.step(); // bir action checkpoint'i
preview.executor.debugger.resume(); // kalan checkpoint'ler
preview.executor.debugger.pause();
preview.executor.cancelAll();
await run;
```

Simülasyon canlı datasource/command/server-validation portlarını çağırmaz. Ağ taklitleri yalnızca `simulationPorts` üzerinden gelir. Yerel state/layout/toast debugger'da gözlemlenir.

## Doğrulama

`runtime.validation.field(node, signal)`, `.page(id, signal)`, `.script(signal)` API'leri requiredWhen, koşullu görünürlük/enabled ata zinciri, props `required`, `validation: [{ when: Condition, messageKey }]` kurallarını uygular. `fieldValidation(node, value, signal)` host özel alan hook'u, `serverValidation({ pageIds, signal })` yalnızca `{ node, messageKey }[]` döndürür; server doğrulamayı güvenilir oturum state'i üzerinden yapmalıdır. Sonuçlar `runtime.errors.<nodeId>` üzerine reaktif publish edilir. İptal edilmiş doğrulama sonucu publish edilmez. `NodeErrorBoundary` tek leaf hatasını izole eder; host `runtime.retry.<nodeId>` revision'ını değiştirerek güvenli yeniden deneme yapabilir.

## Test komutları — bu görevde çalıştırılmadı

```sh
pnpm test:core-runtime --typecheck
pnpm --filter @verbis/core-runtime exec playwright install chromium
pnpm test:core-runtime --typecheck --benchmark
```

Unit/React testleri: bağımlılık izolasyonu, readonly/type sınırı, registry/pin/drop, tüm action aileleri, iptal/stale response/timeout/retry/atomic mapping, debugger, validation scopes/server-hook, node hatası, visibility, button confirm/shortcut ve WebService event/load. Playwright: üretim Vite build üzerinde 500 node (1 Box + 499 controlled Input), on mount fresh runtime, 10 cold/new-engine commit+layout ölçümü her biri <100ms; 30 gerçek input değişiminin p95 synchronous input→React commit+layout süresi <16ms; diğer 498 input render sayısı sabit; axe kontrolü. Hazırlık/parsing süresi ayrı raporlanır; network/font/module yükleme ölçüme dahil değildir. Paint gecikmesi ve 60Hz frame scheduler gecikmesi bu eşikler için ölçülmez. Chromium/CI donanımı ölçümleri etkiler; test çalışmadan SLA ve sıfır axe ihlali doğrulanmış sayılmaz.

Kaynak sözleşmeleri: [React external store](https://react.dev/reference/react/useSyncExternalStore), [Playwright web server](https://playwright.dev/docs/test-webserver), [FormatJS ICU](https://formatjs.github.io/docs/intl-messageformat/).
