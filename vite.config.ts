import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/** Open Graph: изисква пълен URL. Задай VITE_APP_ORIGIN в .env (напр. https://es.example.com) */
function socialMetaPlugin() {
  return {
    name: 'domoupravitel-social-meta',
    transformIndexHtml(html: string) {
      const raw = process.env.VITE_APP_ORIGIN?.trim()
      if (!raw) return html
      const base = raw.replace(/\/$/, '')
      const block = `
    <meta property="og:title" content="ЕС Ален Мак 22" />
    <meta property="og:description" content="Информационно табло — ЕС Ален Мак 22" />
    <meta property="og:type" content="website" />
    <meta property="og:image" content="${base}/pwa-512.png" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:image" content="${base}/pwa-512.png" />
`
      return html.replace('</head>', block + '  </head>')
    },
  }
}

export default defineConfig({
  plugins: [
    socialMetaPlugin(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'pwa-icon.svg', 'pwa-192.png', 'pwa-512.png'],
      manifest: {
        id: '/',
        name: 'Домоуправител',
        short_name: 'Домоуправител',
        description: 'Система за управление на блок',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        lang: 'bg',
        prefer_related_applications: false,
        categories: ['business', 'productivity'],
        icons: [
          {
            src: '/pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    })
  ],
  server: {
    port: 3000,
    host: true,
    open: true
  }
})

