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

// Avisa o log do sistema quando o servidor não responde (com internet) ou
// devolve erro 5xx. O monitor é ligado em services/eventLog.js.
export const fetchMonitor = { onProblem: null };
const monitoredFetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url || "";
  const skip = url.includes("log_client_event");
  try {
    const res = await fetch(input, init);
    if (!skip && res.status >= 500) fetchMonitor.onProblem?.({ kind: "http", status: res.status, url });
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
