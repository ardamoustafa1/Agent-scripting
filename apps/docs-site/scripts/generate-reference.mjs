import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { createComponentRegistry } from '@verbis/components';
import { createDefaultRegistry } from '@verbis/expr';

import { expressionExamples } from './reference-data.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const site = fileURLToPath(new URL('../', import.meta.url));
const safe = (text) =>
  String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
const fence = (value) =>
  '```json\n' +
  JSON.stringify(value, null, 2).replaceAll('```', '\\u0060\\u0060\\u0060') +
  '\n```\n';
const page = (title, body) => `---\ntitle: ${JSON.stringify(title)}\n---\n\n${body}\n`;
const spec = JSON.parse(await readFile(root + 'apps/api/openapi.json', 'utf8'));
await mkdir(site + 'public/api', { recursive: true });
await writeFile(site + 'public/api/openapi.json', JSON.stringify(spec, null, 2) + '\n');
for (const locale of ['tr', 'en']) {
  const tr = locale === 'tr';
  const dir = `${site}src/content/docs/${locale}`;
  await mkdir(dir + '/developer', { recursive: true });
  await mkdir(dir + '/designer', { recursive: true });
  let api = tr
    ? 'Bu referans repodaki OpenAPI sözleşmesinden üretilir. [OpenAPI JSON](/api/openapi.json). BFF üzerinden çağırırken `/api` önekini ekleyin; doğrudan API yolunda bu önek yoktur.\n\n'
    : 'Generated from the committed OpenAPI contract. [OpenAPI JSON](/api/openapi.json). Prefix routes with `/api` through the BFF; direct API routes have no prefix.\n\n';
  api += tr
    ? 'Cookie oturumu, CSRF, idempotency ve tenant kapsamı endpoint güvenlik alanlarına göre zorunludur. Aşağıdaki güvenlik şemaları ve request/response alanları sözleşmenin parçasıdır.\n\n'
    : 'Cookie sessions, CSRF, idempotency and tenant scope follow each operation security definition. Security schemes and request/response fields below form the contract.\n\n';
  api += '## Security schemes\n\n' + fence(spec.components?.securitySchemes ?? {});
  for (const [path, item] of Object.entries(spec.paths ?? {}).sort()) {
    for (const [method, operation] of Object.entries(item)) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) continue;
      api += `\n## ${method.toUpperCase()} ${path}\n\n${safe(operation.summary)}\n\n`;
      if (operation.description) api += safe(operation.description) + '\n\n';
      api += fence({
        operationId: operation.operationId,
        security: operation.security ?? spec.security ?? [],
        parameters: [...(item.parameters ?? []), ...(operation.parameters ?? [])],
        ...(operation.requestBody ? { requestBody: operation.requestBody } : {}),
        responses: operation.responses,
      });
    }
  }
  api += '\n## Schemas\n\n' + fence(spec.components?.schemas ?? {});
  await writeFile(dir + '/developer/rest-api.md', page('REST API', api));
  let functions = tr
    ? 'Bu liste expression registry’den üretilir; örneklerin doğrulanması test koduna aittir. JavaScript çalıştırılmaz. `now()` örneği için saat 2026-10-03T09:00:00Z olarak enjekte edilir.\n\n'
    : 'Generated from the expression registry; authored tests verify examples. No JavaScript execution. The `now()` example injects 2026-10-03T09:00:00Z.\n\n';
  for (const fn of createDefaultRegistry().list()) {
    const example = expressionExamples[fn.name];
    if (!example) throw new Error(`Missing reference example for ${fn.name}`);
    functions += `## ${fn.name}\n\n\`${fn.name}(${fn.parameters.join(', ')}) → ${fn.returns}\` · ${fn.minArgs}–${fn.maxArgs} ${tr ? 'argüman' : 'arguments'}\n\n\`\`\`text\n${example[0]}\n\`\`\`\n\n`;
    functions +=
      example[1] === null
        ? tr
          ? 'TRY tutarını TR ayraçlarıyla biçimlendirir.\n\n'
          : 'Formats a TRY amount with Turkish separators.\n\n'
        : `${tr ? 'Sonuç' : 'Result'}: \`${JSON.stringify(example[1])}\`\n\n`;
    if (fn.lambdaAt)
      functions += tr
        ? 'Lambda yalnız bu fonksiyonun izin verilen collection argümanında kullanılabilir.\n\n'
        : 'Lambda is accepted only in the allowlisted collection argument slot.\n\n';
    if (fn.name.startsWith('is') || fn.name === 'luhn')
      functions += tr
        ? 'Doğrulama yalnız biçim/checksum denetimidir; gerçek kişi, hesap veya telefon doğrulaması değildir.\n\n'
        : 'Validation checks syntax/checksum only; it does not verify a person, account or telephone.\n\n';
  }
  await writeFile(
    dir + '/designer/functions.md',
    page(tr ? 'Expression fonksiyonları' : 'Expression functions', functions),
  );
  let components = tr
    ? 'Component registry’den üretilmiştir. Tüm metinler TR/EN i18n anahtarı kullanır; hassas değerler literal props içinde tutulmaz.\n\n'
    : 'Generated from the component registry. All text uses TR/EN i18n keys; sensitive values never belong in literal props.\n\n';
  for (const def of createComponentRegistry().list()) {
    components += `## ${def.type}\n\n${tr ? 'Kategori' : 'Category'}: \`${def.designerMeta.category}\`\n\n${tr ? 'Olaylar' : 'Events'}: ${def.events.map((event) => '`' + event + '`').join(', ') || '—'}\n\n${tr ? 'Bağlanabilir alanlar' : 'Bindable props'}: ${def.bindableProps.map((prop) => '`' + prop + '`').join(', ') || '—'}\n\n`;
    if (def.secureBindings?.length)
      components += tr
        ? '**Güvenli giriş:** değer okunmaz/geri gösterilmez; sınıflandırılmış değişken kullanın.\n\n'
        : '**Secure input:** values are write-only; use a classified variable.\n\n';
    components += `| ${tr ? 'Özellik' : 'Property'} | ${tr ? 'Editör' : 'Editor'} | ${tr ? 'Bağlanabilir' : 'Bindable'} |\n| --- | --- | --- |\n`;
    for (const property of def.designerMeta.properties ?? [])
      components += `| \`${property.key}\` | ${property.control} | ${property.bindable ? '✓' : '—'} |\n`;
    components +=
      '\n' + fence({ id: 'demo-' + def.type.toLowerCase(), type: def.type, props: def.defaults });
  }
  await writeFile(
    dir + '/designer/components.md',
    page(tr ? 'Component referansı' : 'Component reference', components),
  );
}
