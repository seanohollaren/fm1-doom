/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
// what CloudFront adds to every response (site/infra/lib/frontend-stack.ts); `npm run preview` serves the same,
// so the built site can be tried under its real content security policy before a deploy
import securityHeaders from '../security-headers.json' with { type: 'json' }

// The install logic (cut, convert, pack, the update protocol) lives in ../../web as plain ES modules, shared
// with the single-file installer page and its tests. '@fm1' points there.
const fm1 = fileURLToPath(new URL('../../web', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@fm1': fm1 } },
  server: { fs: { allow: ['../..'] } },
  worker: { format: 'es' },
  build: { target: 'es2022' },
  preview: { headers: securityHeaders, port: 5181, strictPort: true, host: '127.0.0.1' },
  test: { environment: 'node', include: ['src/**/*.test.ts'], testTimeout: 30000 },
})
