import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { DEFAULT_API_PORT } from './config.js'
import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

var __dirname = path.dirname(fileURLToPath(import.meta.url))

// Vite plugin that auto-starts the AGENTVIZ backend in dev mode
function agentvizBackend() {
  var child = null
  return {
    name: 'agentviz-backend',
    configureServer: function () {
      var bin = path.join(__dirname, 'bin', 'agentviz.js')
      child = spawn(process.execPath, [bin, '--no-open'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: Object.assign({}, process.env, { FORCE_COLOR: '0' }),
      })
      child.stdout.on('data', function (d) {
        var line = d.toString().trim()
        if (line) console.log('\x1b[36m[backend]\x1b[0m ' + line)
      })
      child.stderr.on('data', function (d) {
        var line = d.toString().trim()
        if (line) console.error('\x1b[36m[backend]\x1b[0m ' + line)
      })
      child.on('exit', function (code) {
        if (code) console.error('\x1b[36m[backend]\x1b[0m exited with code ' + code)
        child = null
      })
    },
    closeBundle: function () {
      if (child) { child.kill(); child = null }
    },
  }
}

export default defineConfig(function ({ mode }) {
  var isDebugBuild = mode === 'debug'

  return {
    // Use VITE_BASE_PATH env var to override the base URL for built assets.
    // Defaults to './' (relative paths) so the SPA works when served from a
    // subdirectory (e.g. static manifest mode). Set to '/' for root deployments.
    base: process.env.VITE_BASE_PATH || './',
    plugins: [react(), agentvizBackend()],
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
