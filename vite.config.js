import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(function ({ mode }) {
  var isDebugBuild = mode === 'debug'

  return {
    plugins: [react()],
    server: {
      port: 3000,
      open: true,
    },
    build: {
      minify: isDebugBuild ? false : 'esbuild',
      sourcemap: isDebugBuild,
    },
  }
})
