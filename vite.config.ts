import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  plugins: [
    {
      // Vite's HMR socket is allowed only while serving locally. Production HTML
      // keeps connect-src restricted to the application's own origin.
      name: 'fileforge-development-csp',
      apply: 'serve',
      transformIndexHtml(html: string) {
        return html.replace("connect-src 'self'", "connect-src 'self' ws://127.0.0.1:*");
      },
    },
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    cssCodeSplit: true,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 350,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules') && (id.includes('jszip') || id.includes('dompurify'))) {
            return 'file-libraries';
          }
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    include: ['jszip', 'dompurify'],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
