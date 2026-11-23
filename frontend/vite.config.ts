import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // A new version waits until the person chooses to reload (Settings → Over).
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Huizenjacht',
        short_name: 'Huizenjacht',
        description: 'Houd je huizenjacht bij: overzicht, bezichtigingschecklists en vergelijken.',
        lang: 'nl',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        navigateFallbackDenylist: [/^\/api\//],
        // Houses come from the network when it answers and from the last copy otherwise, so
        // the list and checklists can be read during a viewing without signal.
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && (url.pathname.startsWith('/api/houses') || url.pathname.startsWith('/api/settings')),
            method: 'GET',
            handler: 'NetworkFirst',
            options: { cacheName: 'houses', networkTimeoutSeconds: 4, expiration: { maxEntries: 200 } },
          },
        ],
      },
    }),
  ],
  server: { proxy: { '/api': 'http://localhost:8000' } },
})
