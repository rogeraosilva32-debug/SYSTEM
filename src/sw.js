// src/sw.js — service worker customizado (estratégia "injectManifest" do
// vite-plugin-pwa). Precisou trocar da estratégia automática ("generateSW")
// pra esta porque notificação push exige código de service worker próprio
// (o listener de "push" abaixo), que a geração automática não permite
// adicionar.
//
// Mantém o mesmo comportamento de antes (precache do casco do app,
// atualização automática) e adiciona só o necessário pra push.

import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { clientsClaim } from "workbox-core";

self.skipWaiting();
clientsClaim();

// Injetado pelo build do vite-plugin-pwa com a lista real de arquivos —
// não precisa (e não deve) ser editado à mão.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ── Notificações push ──────────────────────────────────────────────────────
// O payload chega como JSON: { title, message, url? }. Se o navegador não
// conseguir decodificar como JSON (não deveria acontecer, mas navegadores
// variam), cai num texto genérico em vez de falhar silenciosamente.
self.addEventListener("push", (event) => {
  let data = { title: "GORAP", message: "Você tem uma notificação nova." };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // mantém o texto genérico
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.message,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // Mesma tag da notificação mostrada pelo app aberto: não duplica.
      tag: data.tag || undefined,
      vibrate: [200, 100, 200],
      data: { url: data.url || "/" },
    })
  );
});

// Clicar na notificação foca uma aba já aberta do app, ou abre uma nova.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
