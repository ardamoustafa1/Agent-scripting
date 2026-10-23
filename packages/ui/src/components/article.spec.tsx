import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ArticleBody } from './article.js';

describe('ArticleBody (ADR-0057)', () => {
  it('renders paragraphs, subheadings and lists as elements', () => {
    const { container } = render(
      <ArticleBody
        body={'Önce kimliği doğrulayın.\nSonra kartı kapatın.\n\n## Süre\n1. Talep\n2. Onay\n- Not'}
        headingLevel={4}
      />,
    );
    expect(screen.getByRole('heading', { level: 4, name: 'Süre' })).toBeTruthy();
    expect(container.querySelectorAll('ol > li')).toHaveLength(2);
    expect(container.querySelectorAll('ul > li')).toHaveLength(1);
    expect(container.querySelector('p')?.innerHTML).toBe(
      'Önce kimliği doğrulayın.<br>Sonra kartı kapatın.',
    );
  });

  it('shows markup as text, never as HTML', () => {
    const { container } = render(
      <ArticleBody body={'<img src=x onerror=alert(1)> <b>kalın</b>'} />,
    );
    expect(container.querySelector('img, b')).toBeNull();
    expect(container.textContent).toBe('<img src=x onerror=alert(1)> <b>kalın</b>');
  });
});
