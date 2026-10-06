import { expect, it } from 'vitest';

import { responsiveStyle, RUNTIME_STYLES } from './styles.js';

it('maps validated semantic styles to bounded responsive CSS properties', () => {
  expect(responsiveStyle()).toEqual({});
  const result = responsiveStyle({
    base: {
      columns: 2,
      colSpan: 2,
      wrap: false,
      scroll: false,
      tone: 'neutral',
      emphasis: 'low',
      justify: 'between',
      gap: 'md',
      paddingInline: 'sm',
      width: 'full',
    },
    md: { wrap: true, scroll: true, tone: 'danger', emphasis: 'high', justify: 'around' },
    lg: { emphasis: 'normal', justify: 'evenly' },
  });
  expect(result).toMatchObject({
    '--vr-base-grid-template-columns': 'repeat(2, minmax(0, 1fr))',
    '--vr-base-grid-column': 'span 2',
    '--vr-base-flex-wrap': 'nowrap',
    '--vr-base-overflow': 'visible',
    '--vr-base-color': 'var(--vb-color-text)',
    '--vr-base-font-weight': '300',
    '--vr-base-justify-content': 'space-between',
    '--vr-md-flex-wrap': 'wrap',
    '--vr-md-overflow': 'auto',
    '--vr-md-color': 'var(--vb-color-danger)',
    '--vr-md-font-weight': '600',
    '--vr-md-justify-content': 'space-around',
    '--vr-lg-font-weight': '400',
    '--vr-lg-justify-content': 'space-evenly',
  });
  expect(RUNTIME_STYLES).toContain('@media(min-width:640px)');
  expect(RUNTIME_STYLES).not.toContain('undefined');
  expect(() => responsiveStyle({ base: { width: 'url(https://evil.test)' } } as never)).toThrow();
});

it('ignores explicitly absent optional rules and preserves ordinary alignment values', () => {
  expect(responsiveStyle({ base: undefined, sm: { gap: undefined, justify: 'start' } })).toEqual({
    '--vr-sm-justify-content': 'start',
  });
});
