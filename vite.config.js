import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Estratégia "injectManifest": usamos nosso próprio service worker
      // (src/sw.js) em vez do gerado automaticamente — necessário pra poder
      // adicionar o listener de notificação push, que a geração automática
      // ("generateSW", usada antes) não permite customizar.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectManifest: {
        // Mesmo padrão de arquivos que a estratégia automática cacheava antes.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
      // registerType "autoUpdate": quando uma nova versão é publicada, o
      // service worker se atualiza sozinho na próxima navegação, sem exigir
      // que a pessoa desinstale/limpe nada manualmente.
      registerType: 'autoUpdate',
      // IMPORTANTE: nada de service worker durante "npm run dev". Isso é
      // deliberado — um SW interceptando requisições em pleno desenvolvimento
      // foi exatamente a causa de uma tela branca difícil de diagnosticar
      // neste projeto. O SW só existe no build de produção.
      devOptions: { enabled: false },
      includeAssets: ['favicon.svg', 'favicon.png'],
      manifest: {
        name: 'ServiçoApp — Gestão de Equipes',
        short_name: 'ServiçoApp',
        description: 'Gestão de colaboradores, serviços e designações de atendimento.',
        lang: 'pt-BR',
        theme_color: '#FAFAF9',
        background_color: '#FAFAF9',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
