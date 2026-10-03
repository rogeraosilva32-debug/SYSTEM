import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://eccepyzumrnjfwoljajb.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjY2VweXp1bXJuamZ3b2xqYWpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMzYzMDcsImV4cCI6MjA5NDgxMjMwN30.U34MJs-Ut_Z3CgxzmJ5QNXSRjpfCvM5LcHPVA8M16Pw";

const supabase = createClient(
  supabaseUrl,
  supabaseKey
);

export default supabase;


