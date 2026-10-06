import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    target: 'esnext',
    lib: {
      entry: 'src/main.tsx',
      name: 'VerbisPlugin',
      formats: ['es'],
      fileName: () => 'component.js',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
