import { createClient } from "@supabase/supabase-js";

// Vem do .env (veja .env.example). Ter isso fixo no código impedia usar um
// projeto Supabase de teste separado do de produção.
// Tira espaços e aspas que às vezes vêm junto ao colar o valor no painel
// de hospedagem (o Supabase responde "Invalid API key" nesse caso).
const clean = (v) => (v || "").trim().replace(/^["']|["']$/g, "").trim();
const supabaseUrl = clean(import.meta.env.VITE_SUPABASE_URL).replace(/\/+$/, "");
const supabaseKey = clean(import.meta.env.VITE_SUPABASE_ANON_KEY);

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env (veja .env.example).");
}

// Link de "esqueci minha senha" ou de convite (primeiro acesso): guarda AGORA
// se a URL veio com type=recovery/invite, porque o supabase-js limpa o hash
// ao processar o token. Nos dois casos a pessoa cria a senha na tela própria.
const urlText = typeof window !== "undefined" ? `${window.location.hash}&${window.location.search}` : "";
export const passwordRecovery = { fromUrl: /[#&?]type=(recovery|invite)(&|$)/.test(urlText), event: false };

// Modo suporte ("ver como empresa"): a plataforma abre o painel de uma
// empresa só para olhar. Cada consulta ao banco leva o cabeçalho
// x-suporte-empresa; o banco confere que é mesmo a plataforma, passa a
// responder como aquela empresa e deixa tudo SÓ LEITURA.
const SUPPORT_KEY = "suporte-empresa";
export function getSupport() {
  try { return JSON.parse(sessionStorage.getItem(SUPPORT_KEY) || "null"); } catch { return null; }
}
export function setSupport(value) {
  try {
    if (value) sessionStorage.setItem(SUPPORT_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(SUPPORT_KEY);
  } catch { /* sem sessionStorage: modo suporte não fica ligado */ }
}
const READ_ONLY_MSG = "Modo suporte: só leitura. Nada foi alterado.";
const withSupportHeader = (input, init, url) => {
  const support = getSupport();
  if (!support?.id || !url.includes("/rest/v1/") || /log_client_event|support_view_log/.test(url)) return init;
  const headers = new Headers(init?.headers || (typeof input === "object" ? input.headers : undefined));
  headers.set("x-suporte-empresa", support.id);
  return { ...init, headers };
};

// Avisa o log do sistema quando o servidor não responde (com internet) ou
// devolve erro 5xx. O monitor é ligado em services/eventLog.js.
export const fetchMonitor = { onProblem: null };
const monitoredFetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url || "";
  const skip = url.includes("log_client_event");
  try {
    const support = Boolean(getSupport()?.id);
    const res = await fetch(input, withSupportHeader(input, init, url));
    // Tentou gravar no modo suporte: troca o erro técnico por um aviso claro.
    if (support && res.status >= 400) {
      const text = await res.clone().text().catch(() => "");
      if (/read-only transaction/i.test(text)) {
        return new Response(JSON.stringify({ code: "25006", message: READ_ONLY_MSG, details: null, hint: null }),
          { status: 403, headers: { "Content-Type": "application/json" } });
      }
    }
    // Erro 5xx: o corpo diz o motivo (ex.: 57014 = demorou demais, 40P01 =
    // conflito entre duas gravações); vai junto para o log, sem segurar a resposta.
    if (!skip && res.status >= 500) {
      res.clone().json().catch(() => ({}))
        .then((body) => fetchMonitor.onProblem?.({ kind: "http", status: res.status, url, code: body?.code, detail: body?.message }));
    }
    return res;
  } catch (err) {
    if (!skip && err?.name !== "AbortError") fetchMonitor.onProblem?.({ kind: "network", message: err?.message, url });
    throw err;
  }
};

const supabase = createClient(supabaseUrl, supabaseKey, { global: { fetch: monitoredFetch } });

// Registrado logo após criar o cliente pra não perder o PASSWORD_RECOVERY,
// que dispara durante a inicialização (antes da tela de nova senha montar).
supabase.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") passwordRecovery.event = true;
  if (event === "SIGNED_OUT") { passwordRecovery.event = false; passwordRecovery.fromUrl = false; }
});

export default supabase;
