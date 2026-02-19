import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 3000,
    headers: {
      'Cache-Control': 'public, max-age=31536000, immutable'
    }
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    chunkSizeWarningLimit: 800,
    assetsInlineLimit: 8192
  },
  esbuild: {
    drop: [],
    legalComments: 'none'
  },
  optimizeDeps: {
    exclude: ['evoio-wasm']
  }
})
