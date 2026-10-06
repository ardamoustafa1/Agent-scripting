import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  output: 'static',
  site: process.env.DOCS_SITE_URL || 'https://docs.verbis.example',
  integrations: [
    starlight({
      title: { tr: 'Verbis Rehberleri', en: 'Verbis Guides' },
      logo: { src: './src/assets/verbis-mark.svg', alt: 'Verbis' },
      defaultLocale: 'tr',
      locales: { tr: { label: 'Türkçe', lang: 'tr' }, en: { label: 'English', lang: 'en' } },
      customCss: ['./src/styles/docs.css'],
      sidebar: [
        {
          label: 'Tasarımcı',
          translations: { en: 'Designer' },
          items: [{ autogenerate: { directory: 'designer' } }],
        },
        {
          label: 'Agent',
          translations: { en: 'Agent' },
          items: [{ autogenerate: { directory: 'agent' } }],
        },
        {
          label: 'Yönetici',
          translations: { en: 'Administrator' },
          items: [{ autogenerate: { directory: 'admin' } }],
        },
        {
          label: 'Entegrasyonlar',
          translations: { en: 'Integrations' },
          items: [{ autogenerate: { directory: 'connectors' } }],
        },
        {
          label: 'Geliştirici',
          translations: { en: 'Developer' },
          items: [{ autogenerate: { directory: 'developer' } }],
        },
      ],
    }),
  ],
});
