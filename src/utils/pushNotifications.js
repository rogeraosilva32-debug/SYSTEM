import supabase from "../services/supabase";

// Converte a chave pública VAPID (base64url) pro formato que a Push API do
// navegador espera (Uint8Array) — conversão padrão, sempre igual pra
// qualquer chave VAPID.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && window.isSecureContext;
}

export async function getPushSubscriptionStatus() {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const existing = await reg?.pushManager.getSubscription();
  return existing ? "subscribed" : "not-subscribed";
}

// Pede permissão (se ainda não tiver sido negada) e registra a inscrição —
// tanto no navegador quanto na tabela push_subscriptions, pra a Edge
// Function send-push conseguir mandar notificação pra este aparelho depois.
export async function subscribeToPush(userId) {
  if (!pushSupported()) throw new Error("Este navegador não suporta notificação push.");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Permissão de notificação não concedida.");

  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!vapidKey) throw new Error("Chave VAPID não configurada no .env (VITE_VAPID_PUBLIC_KEY).");

  const reg = await navigator.serviceWorker.ready;
  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });
  }

  const json = subscription.toJSON();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth_key: json.keys.auth,
    },
    { onConflict: "endpoint" }
  );
  if (error) throw error;
  return true;
}

export async function unsubscribeFromPush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
}

// Notificação na barra do celular/computador. Com o app aberto (mesmo em
// segundo plano) ela sai daqui, sem depender do servidor de push; com o app
// fechado, sai pelo push (função send-push), quando estiver configurado.
export function notificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator && window.isSecureContext;
}

export function notificationPermission() {
  return notificationsSupported() ? Notification.permission : "unsupported";
}

// Pede a permissão e, se o push estiver configurado, inscreve o aparelho.
// Devolve "push" (chega com o app fechado) ou "local" (só com o app aberto).
export async function enableNotifications(userId) {
  if (!notificationsSupported()) throw new Error("Este navegador não mostra notificações. No iPhone, instale o app na tela inicial.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notificações bloqueadas. Libere nas configurações do navegador para este site.");
  try {
    await subscribeToPush(userId);
    return "push";
  } catch {
    return "local";
  }
}

// A mesma tag do push do servidor: se os dois chegarem, aparece uma só.
export async function showStatusBarNotification(n) {
  if (notificationPermission() !== "granted") return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    await reg.showNotification(n.title || "Aviso", {
      body: n.message || "", tag: `n-${n.id}`, icon: "/icon-192.png", badge: "/icon-192.png",
      vibrate: [200, 100, 200], data: { url: "/" },
    });
  } catch { /* sem service worker: fica só no sino */ }
}
