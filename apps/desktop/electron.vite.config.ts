import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const workspace = ['@dafuyu/core', '@dafuyu/contracts', '@dafuyu/shared']

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: workspace })],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        external: ['electron', 'electron-updater'],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: workspace })],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        external: ['electron'],
      },
    },
  },
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
})
