import { createClient } from "@supabase/supabase-js";

// Vem do .env (veja .env.example). Ter isso fixo no código impedia usar um
// projeto Supabase de teste separado do de produção.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env (veja .env.example).");
}

const supabase = createClient(supabaseUrl, supabaseKey);

export default supabase;
