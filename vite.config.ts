import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: '/',
  build: { rolldownOptions: { input: { map: 'index.html', admin: 'admin/index.html' } } },
  plugins: [vue()],
  server: {
    host: true,
    port: 5180,
    strictPort: true,
    proxy: { '/api': { target: 'http://localhost:8790', changeOrigin: false }, '/streetview': { target: 'http://localhost:8790', changeOrigin: false } },
  },
})
