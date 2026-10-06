import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { connectGuest } from '@verbis/sdk-component/guest';
import { UiProvider, Button } from '@verbis/ui';
import { createI18n } from '@verbis/i18n';
// CSS is bundled into the isolated artifact; external runtime asset fetches are prohibited.
import css from '@verbis/ui/tokens.css?inline';
const style = document.createElement('style');
style.textContent = css;
document.head.append(style);
const locales = { tr: await createI18n('tr'), en: await createI18n('en') };
const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('VERBIS_PLUGIN_ROOT');
const root = createRoot(rootElement);
const propsSchema = z.strictObject({
  labelKey: z.string().default('runtime.execute'),
  value: z.string().default(''),
});
connectGuest(propsSchema, (state, api) => {
  const i18n = locales[state.locale];
  root.render(
    <UiProvider i18n={i18n}>
      <section aria-label="__COMPONENT_TYPE__">
        <Button
          disabled={!state.enabled}
          onClick={() => {
            void api.emit('onPress').catch(() => undefined);
          }}
        >
          {i18n.t(String(state.props['labelKey']))}
        </Button>
      </section>
    </UiProvider>,
  );
});
