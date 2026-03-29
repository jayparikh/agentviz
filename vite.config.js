import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { DEFAULT_API_PORT } from './config.js'

export default defineConfig(function ({ mode }) {
  var isDebugBuild = mode === 'debug'

  return {
    plugins: [react()],
    test: {
      exclude: ['e2e/**', 'node_modules/**'],
    },
    server: {
      port: 3000,
      open: true,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:' + DEFAULT_API_PORT,
          changeOrigin: true,
        },
      },
    },
    build: {
      minify: isDebugBuild ? false : 'esbuild',
      sourcemap: isDebugBuild,
    },
  }
})
