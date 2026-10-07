import supabase, { fetchMonitor } from "./supabase";

// Log do sistema (visto pelo administrador da plataforma): o app avisa o
// banco quando a internet cai e volta, quando o servidor não responde, de
// login/saída e de erros na tela. O próprio banco grava IP e a hora.
// Sem internet, o evento espera numa fila no aparelho e vai quando voltar.

const QUEUE_KEY = "event-log-queue";
const OFFLINE_KEY = "event-log-offline-since";
const MAX_QUEUE = 50;
const MAX_ERRORS_PER_PAGE = 20;

let kitchenToken = null;
let errorsSent = 0;
const lastByKey = new Map();
let started = false;

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* sem armazenamento */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* sem armazenamento */ } },
};

// Tela da cozinha aberta pelo link (sem login): os eventos vão com o link.
export function setKitchenToken(token) { kitchenToken = token || null; }

// Não manda o link secreto da cozinha nem outros tokens no caminho da tela.
const screenPath = () => (typeof window === "undefined" ? "" : window.location.pathname.replace(/\/(cozinha|avaliar)\/[^/]+/, "/$1/…"));

export function deviceInfo() {
  if (typeof navigator === "undefined") return {};
  const ua = navigator.userAgent || "";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Outro";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows"
    : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Outro";
  const conn = navigator.connection || {};
  const standalone = typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone);
  return {
    navegador: browser,
    sistema: os,
    celular: /Mobi|Android|iPhone/.test(ua),
    app_instalado: Boolean(standalone),
    tela: typeof window !== "undefined" ? `${window.screen?.width}x${window.screen?.height}` : undefined,
    idioma: navigator.language,
    rede: conn.effectiveType || undefined,
    velocidade_mbps: conn.downlink ?? undefined,
    latencia_ms: conn.rtt ?? undefined,
  };
}

function readQueue() {
  try { return JSON.parse(store.get(QUEUE_KEY) || "[]"); } catch { return []; }
}
// Cada item guarda de quem era: se outra pessoa entrar no aparelho antes de
// voltar a internet, o evento não vai no nome dela.
function enqueue(payload, uid, at = Date.now()) {
  const q = readQueue();
  q.push({ payload, uid: uid || null, at });
  store.set(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE)));
}

async function currentUid() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id || null;
  } catch {
    return null;
  }
}

async function send(payload) {
  try {
    const { error } = await supabase.rpc("log_client_event", payload);
    // Erro de rede: guarda para mandar depois. Outro erro (banco sem a
    // função ainda, por exemplo): descarta, o log nunca atrapalha o uso.
    if (error && /fetch|network|Failed|Load failed/i.test(error.message || "")) return false;
    return true;
  } catch {
    return false;
  }
}

export async function flushQueue() {
  const q = readQueue();
  if (!q.length || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
  store.remove(QUEUE_KEY);
  const uid = await currentUid();
  const fresh = q.filter((item) => item?.payload && item.uid === uid && Date.now() - (item.at || 0) < 24 * 3600e3);
  for (let i = 0; i < fresh.length; i++) {
    if (!(await send(fresh[i].payload))) { fresh.slice(i).forEach((it) => enqueue(it.payload, it.uid, it.at)); return; }
  }
}

// topic: rede | conta | erro | app | segurança. level: info | warning | error.
// key: eventos com a mesma chave vão no máximo uma vez a cada `everyMs`.
export async function logEvent(topic, action, message, level = "info", details = {}, { key, everyMs = 60000 } = {}) {
  if (key) {
    const last = lastByKey.get(key) || 0;
    if (Date.now() - last < everyMs) return;
    lastByKey.set(key, Date.now());
  }
  const payload = {
    p_topic: topic,
    p_action: action,
    p_message: String(message || "").slice(0, 500),
    p_level: level,
    p_details: { ...details, aparelho: deviceInfo(), caminho: screenPath(), hora_no_aparelho: new Date().toISOString() },
    p_kitchen_token: kitchenToken,
  };
  if (typeof navigator !== "undefined" && navigator.onLine === false) { enqueue(payload, await currentUid()); return; }
  if (!(await send(payload))) enqueue(payload, await currentUid());
}

const duration = (ms) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
};

export function logError(error, extra = {}) {
  if (errorsSent >= MAX_ERRORS_PER_PAGE) return;
  const message = String(error?.message || error || "Erro desconhecido").slice(0, 300);
  if (/ResizeObserver loop|Script error\.?$/i.test(message)) return;
  errorsSent += 1;
  logEvent("erro", extra.action || "js_error", message, "error",
    { pilha: String(error?.stack || "").slice(0, 1500), ...extra.details }, { key: `err:${message}`, everyMs: 60000 });
}

// Liga uma vez ao abrir o app.
export function startEventLog() {
  if (started || typeof window === "undefined") return;
  started = true;

  // Ficou sem internet antes de recarregar a página: conta o tempo mesmo assim.
  // Se passou muito tempo, o app provavelmente ficou fechado: não é queda longa.
  const pendingOffline = Number(store.get(OFFLINE_KEY) || 0);
  if (pendingOffline && navigator.onLine) {
    store.remove(OFFLINE_KEY);
    const ms = Date.now() - pendingOffline;
    const closed = ms > 30 * 60000;
    logEvent("rede", "connection_restored",
      closed ? `App aberto de novo; estava sem internet quando foi fechado (${duration(ms)} atrás)`
        : `Internet voltou depois de ${duration(ms)} sem conexão (a tela foi recarregada)`,
      !closed && ms > 60000 ? "warning" : "info",
      { sem_conexao_desde: new Date(pendingOffline).toISOString(), segundos_sem_conexao: Math.round(ms / 1000), app_fechado: closed });
  }

  window.addEventListener("offline", () => { if (!store.get(OFFLINE_KEY)) store.set(OFFLINE_KEY, String(Date.now())); });
  window.addEventListener("online", () => {
    const since = Number(store.get(OFFLINE_KEY) || 0);
    store.remove(OFFLINE_KEY);
    flushQueue().finally(() => {
      if (!since) return;
      const ms = Date.now() - since;
      logEvent("rede", "connection_restored", `Internet voltou depois de ${duration(ms)} sem conexão`, ms > 60000 ? "warning" : "info",
        { sem_conexao_desde: new Date(since).toISOString(), segundos_sem_conexao: Math.round(ms / 1000) });
    });
  });

  const conn = navigator.connection;
  if (conn?.addEventListener) {
    let type = conn.effectiveType;
    conn.addEventListener("change", () => {
      if (conn.effectiveType === type) return;
      const before = type;
      type = conn.effectiveType;
      if (type === "2g" || type === "slow-2g" || before === "2g" || before === "slow-2g") {
        logEvent("rede", "network_changed", `Rede mudou de ${before || "?"} para ${type || "?"}`,
          type === "2g" || type === "slow-2g" ? "warning" : "info", {}, { key: "net-change", everyMs: 120000 });
      }
    });
  }

  // Celular com a tela apagada ou o app em segundo plano corta a rede das
  // abas: a chamada falha sem o servidor ter culpa. Não conta isso, nem nos
  // primeiros segundos depois que a tela volta.
  let shownAt = Date.now();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) shownAt = Date.now(); });

  fetchMonitor.onProblem = (p) => {
    if (p.kind === "network" && navigator.onLine === false) return; // já contado como queda de internet
    if (p.kind === "network" && (document.hidden || Date.now() - shownAt < 10000)) return;
    // O serviço vai na mensagem para dar para ver na lista qual chamada falhou.
    const servico = (p.url || "").replace(/^https?:\/\/[^/]+/, "").split("?")[0].replace(/^\/rest\/v1\//, "").slice(0, 120);
    const motivo = p.code ? ` (${p.code}${p.detail ? `: ${String(p.detail).slice(0, 160)}` : ""})` : "";
    const message = (p.kind === "http"
      ? `Servidor respondeu com erro ${p.status}`
      : "Servidor não respondeu (o aparelho tinha internet)") + (servico ? ` em ${servico}` : "") + motivo;
    logEvent("rede", p.kind === "http" ? "server_error" : "server_unreachable", message, "warning",
      { status: p.status, servico, codigo: p.code, erro: p.detail },
      { key: `srv:${p.kind}:${p.status || ""}:${servico}`, everyMs: 120000 });
  };

  window.addEventListener("error", (e) => {
    if (e?.filename && !e.filename.startsWith(window.location.origin)) return; // extensões do navegador
    logError(e?.error || e?.message, { details: { arquivo: e?.filename?.replace(window.location.origin, ""), linha: e?.lineno } });
  });
  window.addEventListener("unhandledrejection", (e) => logError(e?.reason, { action: "unhandled_promise" }));

  flushQueue();
}
