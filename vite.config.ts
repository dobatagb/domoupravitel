import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Домоуправител',
        short_name: 'Домоуправител',
        description: 'Система за управление на блок',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        icons: []
      }
    })
  ],
  server: {
    port: 3000,
    host: true,
    open: true
  }
})

