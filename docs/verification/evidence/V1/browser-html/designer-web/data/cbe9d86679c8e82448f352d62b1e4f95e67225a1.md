# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: editor.spec.ts >> virtual layer drag reorders siblings in one undo step
- Location: e2e/editor.spec.ts:116:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 1

  Array [
    "home-root",
    "btn-next",
-   "fixture-0",
    "fixture-1",
+   "fixture-0",
  ]

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [ref=e4]:
  - link "Skip to main content" [ref=e5] [cursor=pointer]:
    - /url: "#workspace-content"
  - complementary "Workspace navigation" [ref=e6]:
    - link "Verbis" [ref=e7] [cursor=pointer]:
      - /url: /campaigns
    - navigation "Workspace navigation" [ref=e12]:
      - link "Campaigns" [ref=e13] [cursor=pointer]:
        - /url: /campaigns
      - link "Scripts" [ref=e17] [cursor=pointer]:
        - /url: /scripts
      - link "Screens" [ref=e22] [cursor=pointer]:
        - /url: /screens
      - link "Integrations" [ref=e25] [cursor=pointer]:
        - /url: /integrations
      - link "Variables" [ref=e28] [cursor=pointer]:
        - /url: /variables
      - link "AI assistant" [ref=e32] [cursor=pointer]:
        - /url: /ai
      - link "Templates" [ref=e36] [cursor=pointer]:
        - /url: /templates
      - link "Releases" [ref=e41] [cursor=pointer]:
        - /url: /releases
      - link "Settings" [ref=e47] [cursor=pointer]:
        - /url: /settings
    - button "Help" [ref=e51] [cursor=pointer]
    - img "You" [ref=e57]: "Y"
  - generic [ref=e58]:
    - banner [ref=e59]:
      - generic [ref=e60]:
        - button "Organization" [ref=e61] [cursor=pointer]:
          - generic [aria-hidden] [ref=e62]: V
        - generic [aria-hidden] [ref=e66]: /
        - generic [ref=e67]:
          - generic [ref=e68]: Environment
          - combobox "Environment" [ref=e69] [cursor=pointer]:
            - generic: Production
      - button "Search everything… ⌘ / Ctrl K" [ref=e73] [cursor=pointer]:
        - text: Search everything…
        - generic [ref=e77]: ⌘ / Ctrl K
      - generic [ref=e78]:
        - generic [ref=e79]:
          - generic [ref=e80]: Language
          - combobox "Language" [ref=e81] [cursor=pointer]:
            - generic: English
        - button "Theme" [ref=e85] [cursor=pointer]
        - button "Notifications" [ref=e90] [cursor=pointer]
        - button [ref=e95] [cursor=pointer]:
          - img "You" [ref=e97]: "Y"
    - navigation "Breadcrumb" [ref=e100]:
      - generic [ref=e101]: Workspace
      - generic [aria-hidden] [ref=e102]: /
      - strong [ref=e103]: Scripts
      - generic [ref=e104]: Production
    - main [ref=e105]:
      - generic [ref=e106]:
        - generic [ref=e107]:
          - generic [ref=e108]:
            - generic [ref=e109]: Screen editor
            - heading "Minimal" [level=1] [ref=e110]
            - generic [ref=e111]:
              - generic [ref=e112]: Editor
              - combobox "Editor" [ref=e113] [cursor=pointer]:
                - generic: Screen
            - generic [ref=e117]: Saved
          - generic [ref=e118]:
            - button "Undo" [active] [ref=e119] [cursor=pointer]
            - button "Redo" [disabled] [ref=e120]
            - button "Copy" [ref=e121] [cursor=pointer]
            - button "Paste" [ref=e122] [cursor=pointer]
            - button "Duplicate" [ref=e123] [cursor=pointer]
            - button "Delete" [ref=e124] [cursor=pointer]
            - button "Group" [ref=e125] [cursor=pointer]
            - button "Ungroup" [ref=e126] [cursor=pointer]
            - button "Reuse a screen" [ref=e127] [cursor=pointer]
            - button "Keyboard shortcuts" [ref=e128] [cursor=pointer]
        - generic [ref=e129]:
          - button "Team and comments" [ref=e130] [cursor=pointer]
          - generic [ref=e131]: Offline
          - button "Join collaborative editing" [ref=e132] [cursor=pointer]
        - navigation "Selection path" [ref=e133]
        - group "Screen editor" [ref=e134]:
          - complementary "Components" [ref=e136]:
            - generic [ref=e137]:
              - tablist "Components" [ref=e138]:
                - tab "Components" [ref=e139] [cursor=pointer]
                - tab "Layers" [selected] [ref=e140] [cursor=pointer]
                - tab "Pages" [ref=e141] [cursor=pointer]
              - tabpanel "Layers" [ref=e142]
            - tree "Layers" [ref=e143]:
              - generic [ref=e144]:
                - treeitem [expanded] [level=1] [ref=e146]:
                  - button "home-root" [ref=e147]
                  - button "home-root" [ref=e155]
                  - button "box home-root" [ref=e158]
                - treeitem [level=2] [ref=e160]:
                  - button "btn-next" [ref=e161]
                  - button "button btn-next" [ref=e169]
                - treeitem [level=2] [ref=e171]:
                  - button "fixture-1" [ref=e172]
                  - button "box fixture-1" [ref=e180]
                - treeitem [level=2] [ref=e182]:
                  - button "fixture-0" [ref=e183]
                  - button "box fixture-0" [ref=e191]
          - region "Screen canvas" [ref=e192]:
            - generic [ref=e193]:
              - generic [ref=e194]: Home
              - generic [ref=e195]: 375 × Auto
            - button "İleri" [ref=e204] [cursor=pointer]
          - paragraph [ref=e211]: Select a component to edit its properties.
        - status [ref=e212]: Draggable item node:fixture-1 was dropped over droppable area layer:fixture-0
        - generic [ref=e213]:
          - group [ref=e214]:
            - generic "Validation details" [ref=e215]
          - status [ref=e216]: 0 validation errors
          - generic [ref=e217]: 0 / 1
          - generic [ref=e218]:
            - generic [ref=e219]: Breakpoint
            - combobox "Breakpoint" [ref=e220] [cursor=pointer]:
              - generic: base
          - generic [ref=e224]:
            - generic [ref=e225]: Zoom
            - combobox "Zoom" [ref=e226] [cursor=pointer]:
              - generic: 100%
    - contentinfo [ref=e230]:
      - generic [ref=e232]: Secure workspace
      - generic [ref=e233]: Jump anywhere with ⌘ / Ctrl + K
```

# Test source

```ts
  41  |   await expect(page.locator('[data-editor-node="home-root"]')).toBeAttached();
  42  |   const source = page
  43  |     .locator('.ed-palette-item')
  44  |     .filter({ has: page.getByRole('button', { name: 'box', exact: true }) })
  45  |     .locator('.ed-grip');
  46  |   const a = await source.boundingBox(),
  47  |     b = await page.locator('.ed-paper').boundingBox();
  48  |   if (!a || !b) throw new Error('Missing drag rectangles');
  49  |   const before = await page.locator('[data-editor-node]').count();
  50  |   await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  51  |   await page.mouse.down();
  52  |   await page.mouse.move(b.x + 60, b.y + 120, { steps: 12 });
  53  |   await page.mouse.up();
  54  |   await expect(page.locator('[data-editor-node]')).toHaveCount(before + 1);
  55  |   await page.getByRole('button', { name: 'Undo', exact: true }).click();
  56  |   await expect(page.locator('[data-editor-node]')).toHaveCount(before);
  57  |   await page.getByRole('button', { name: 'Redo', exact: true }).click();
  58  |   await expect(page.locator('[data-editor-node]')).toHaveCount(before + 1);
  59  | });
  60  | for (const theme of ['light', 'dark', 'high-contrast'])
  61  |   test(`editor ${theme} keyboard and axe`, async ({ page }) => {
  62  |     await page.addInitScript((value) => {
  63  |       localStorage.setItem('verbis.theme', value);
  64  |     }, theme);
  65  |     await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  66  |     await page.getByRole('tab', { name: 'Layers', exact: true }).click();
  67  |     await page.getByRole('treeitem').first().getByRole('button').last().click();
  68  |     await page.keyboard.press('Escape');
  69  |     expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  70  |   });
  71  | test('1000 nodes keep the layer DOM bounded and record a drag frame budget', async ({ page }) => {
  72  |   await page.route('**/api/v1/scripts/*/versions/1', (route) =>
  73  |     route.fulfill({
  74  |       status: 200,
  75  |       contentType: 'application/json',
  76  |       body: JSON.stringify(editorFixture(1000)),
  77  |     }),
  78  |   );
  79  |   await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  80  |   await page.getByRole('tab', { name: 'Layers', exact: true }).click();
  81  |   expect(await page.getByRole('treeitem').count()).toBeLessThan(80);
  82  |   const source = page.getByRole('treeitem').nth(1).locator('.ed-grip').first();
  83  |   const rect = await source.boundingBox();
  84  |   if (!rect) throw new Error('Missing drag handle');
  85  |   await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  86  |   await page.mouse.down();
  87  |   const measuring = page.evaluate(
  88  |     () =>
  89  |       new Promise<number[]>((resolve) => {
  90  |         const raf = (
  91  |           globalThis as unknown as {
  92  |             requestAnimationFrame: (callback: (now: number) => void) => number;
  93  |           }
  94  |         ).requestAnimationFrame;
  95  |         const samples: number[] = [];
  96  |         let previous = performance.now();
  97  |         function next(now: number) {
  98  |           samples.push(now - previous);
  99  |           previous = now;
  100 |           if (samples.length === 120) resolve(samples);
  101 |           else raf(next);
  102 |         }
  103 |         raf(next);
  104 |       }),
  105 |   );
  106 |   for (let i = 0; i < 120; i++) {
  107 |     await page.mouse.move(rect.x + 40 + (i % 6), rect.y + 60 + (i % 100), { steps: 1 });
  108 |   }
  109 |   const frames = await measuring;
  110 |   await page.mouse.up();
  111 |   frames.sort((a, b) => a - b);
  112 |   expect(1000 / (frames[Math.floor(frames.length / 2)] ?? 1000)).toBeGreaterThanOrEqual(59);
  113 |   expect(frames[Math.floor(frames.length * 0.95)]).toBeLessThan(20);
  114 | });
  115 | 
  116 | test('virtual layer drag reorders siblings in one undo step', async ({ page }) => {
  117 |   await page.route('**/api/v1/scripts/*/versions/1', (route) =>
  118 |     route.fulfill({
  119 |       status: 200,
  120 |       contentType: 'application/json',
  121 |       body: JSON.stringify(editorFixture(3)),
  122 |     }),
  123 |   );
  124 |   await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  125 |   await page.getByRole('tab', { name: 'Layers', exact: true }).click();
  126 |   const source = await page.locator('[data-layer-id="fixture-1"] .ed-grip').first().boundingBox();
  127 |   const target = await page.locator('[data-layer-id="fixture-0"]').boundingBox();
  128 |   if (!source || !target) throw new Error('Missing layer bounds');
  129 |   await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  130 |   await page.mouse.down();
  131 |   await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  132 |   await page.mouse.up();
  133 |   const ids = () =>
  134 |     page
  135 |       .locator('[data-layer-id]')
  136 |       .evaluateAll((elements: readonly { getAttribute: (name: string) => string | null }[]) =>
  137 |         elements.map((el) => el.getAttribute('data-layer-id')),
  138 |       );
  139 |   await expect.poll(ids).toEqual(['home-root', 'btn-next', 'fixture-1', 'fixture-0']);
  140 |   await page.getByRole('button', { name: 'Undo', exact: true }).click();
> 141 |   await expect.poll(ids).toEqual(['home-root', 'btn-next', 'fixture-0', 'fixture-1']);
      |                          ^ Error: expect(received).toEqual(expected) // deep equality
  142 | });
  143 | test('draft writes carry CSRF, optimistic version and linked screen pins', async ({ page }) => {
  144 |   const fixture = {
  145 |     ...editorFixture(),
  146 |     screens: [
  147 |       {
  148 |         sharedScreenId: '01928f3a-0000-7000-8000-000000000010',
  149 |         versionNumber: 3,
  150 |         mode: 'linked',
  151 |         pageIds: ['linked-home'],
  152 |       },
  153 |     ],
  154 |   };
  155 |   fixture.document.pages.push(
  156 |     PageSchema.parse({
  157 |       id: 'linked-home',
  158 |       name: 'Shared fixture',
  159 |       layout: { id: 'linked-root', type: 'box' },
  160 |     }),
  161 |   );
  162 |   await page.route('**/api/v1/scripts/*/versions/1', (route) =>
  163 |     route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) }),
  164 |   );
  165 |   await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  166 |   await page.getByRole('tab', { name: 'Layers', exact: true }).click();
  167 |   await page.locator('[data-layer-id="btn-next"]').getByRole('button').last().click();
  168 |   const saved = page.waitForRequest(
  169 |     (request) => request.method() === 'PUT' && request.url().endsWith('/document'),
  170 |   );
  171 |   await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  172 |   const request = await saved;
  173 |   expect(request.headers()['x-csrf-token']).toBe(sessionFixture.csrfToken);
  174 |   expect(request.headers()['if-match']).toBe('"1"');
  175 |   expect(request.postDataJSON()).toMatchObject({
  176 |     screens: [
  177 |       { sharedScreenId: fixture.screens[0]?.sharedScreenId, versionNumber: 3, mode: 'linked' },
  178 |     ],
  179 |     document: { schemaVersion: '1.1.0' },
  180 |   });
  181 | });
  182 | 
  183 | for (const theme of ['light', 'dark']) {
  184 |   test(`@visual designer-web main screen ${theme}`, async ({ page }) => {
  185 |     await page.setViewportSize({ width: 1440, height: 1000 });
  186 |     await page.clock.setFixedTime(new Date('2026-10-03T09:00:00Z'));
  187 |     await page.addInitScript((value) => {
  188 |       localStorage.setItem('verbis.theme', value);
  189 |     }, theme);
  190 |     await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  191 |     await expect(page.locator('[data-editor-node="home-root"]')).toBeAttached();
  192 |     await page.evaluate('document.fonts.ready.then(() => undefined)');
  193 |     await expect(page).toHaveScreenshot(`designer-web-${theme}.png`, { fullPage: true });
  194 |   });
  195 | }
  196 | 
  197 | test('creates a script from scratch, drags a component, builds decision/service flow and a rule', async ({
  198 |   page,
  199 | }) => {
  200 |   const fixture = editorFixture();
  201 |   // A tenant service definition is configured independently in integrations.spec.ts.
  202 |   fixture.document.dataSources.push({
  203 |     id: 'lookup',
  204 |     ref: 'tenant-datasource:customer-lookup',
  205 |     version: 1,
  206 |     inputs: {},
  207 |     outputs: {},
  208 |     policy: { trigger: 'manual', timeoutMs: 5000, cacheTtlSec: 0 },
  209 |   });
  210 |   const sourceId = '01928f3a-0000-7000-8000-000000000011';
  211 |   const sourceFixture = structuredClone(fixture);
  212 |   let draftCreated = false;
  213 |   let created = false,
  214 |     revision = 1;
  215 |   let saved: unknown;
  216 |   await page.route('**/api/v1/scripts**', async (route) => {
  217 |     const request = route.request(),
  218 |       path = new URL(request.url()).pathname;
  219 |     if (path === '/api/v1/scripts' && request.method() === 'POST') {
  220 |       expect(request.headers()['x-csrf-token']).toBe(sessionFixture.csrfToken);
  221 |       expect(request.headers()['idempotency-key']).toBeDefined();
  222 |       expect(request.postDataJSON()).toMatchObject({ name: 'Synthetic new script' });
  223 |       created = true;
  224 |       return route.fulfill({
  225 |         status: 201,
  226 |         json: { id: scriptId, name: 'Synthetic new script', tags: [] },
  227 |       });
  228 |     }
  229 |     if (path === '/api/v1/scripts' && !created)
  230 |       return route.fulfill({ json: { data: [], page: { nextCursor: null } } });
  231 |     if (path === `/api/v1/scripts/${scriptId}` && request.method() === 'GET')
  232 |       return route.fulfill({ json: { id: scriptId, name: 'Synthetic new script', tags: [] } });
  233 |     if (path === `/api/v1/scripts/${sourceId}/versions/1`)
  234 |       return route.fulfill({ json: sourceFixture });
  235 |     if (path === `/api/v1/scripts/${scriptId}/versions` && request.method() === 'POST') {
  236 |       const body = request.postDataJSON() as { document: unknown; screens: unknown[] };
  237 |       expect(request.headers()['x-csrf-token']).toBe(sessionFixture.csrfToken);
  238 |       expect(request.headers()['idempotency-key']).toBeDefined();
  239 |       fixture.document = ScriptDocumentSchema.parse(body.document);
  240 |       expect(fixture.document.dataSources).toEqual([]);
  241 |       draftCreated = true;
```