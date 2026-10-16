import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: './',
  plugins: [vue()],
  server: {
    host: true,
    port: 5180,
    strictPort: true,
    proxy: { '/api': 'http://localhost:8790' },
  },
})
