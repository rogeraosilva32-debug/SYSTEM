import { createClient } from "@supabase/supabase-js";

// Por padrão usa o projeto Supabase de produção (a chave "anon" é pública:
// vai para o navegador de qualquer jeito). Para apontar para outro projeto,
// como um de teste, defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://eccepyzumrnjfwoljajb.supabase.co";
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjY2VweXp1bXJuamZ3b2xqYWpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMzYzMDcsImV4cCI6MjA5NDgxMjMwN30.U34MJs-Ut_Z3CgxzmJ5QNXSRjpfCvM5LcHPVA8M16Pw";

const supabase = createClient(supabaseUrl, supabaseKey);

export default supabase;
