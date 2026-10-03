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

const supabase = createClient(supabaseUrl, supabaseKey);

export default supabase;
