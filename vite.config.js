import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(function ({ mode }) {
  var isDebugBuild = mode === 'debug'

  return {
    plugins: [react()],
    server: {
      port: 3000,
      open: true,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:4242',
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
