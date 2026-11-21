import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    cssCodeSplit: true,
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})