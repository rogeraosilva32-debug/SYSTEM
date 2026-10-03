// supabase/functions/crm-import/index.ts
//
// API DE ENTRADA — importa colaboradores e serviços de um CRM externo,
// usando a URL/chave/mapeamento configurados na aba "Integrações & API".
//
// Roda no servidor (não no navegador) por dois motivos: 1) evita o bloqueio
// de CORS que aconteceria tentando chamar a API do CRM direto do navegador;
// 2) a chave de API do CRM nunca fica exposta no código do navegador.
//
// Deploy (uma vez, via Supabase CLI):
//   supabase functions deploy crm-import
// (sem --no-verify-jwt: esta função É chamada por um usuário logado do app,
// via supabase.functions.invoke, que já manda o token de sessão sozinho.)
//
// IMPORTANTE — isto é um ponto de partida genérico, não uma integração
// pronta com um CRM específico: cada CRM tem seu próprio formato de resposta
// e esquema de autenticação. Os dois pontos abaixo quase certamente vão
// precisar de ajuste manual depois de olhar a documentação do CRM real:
//   1) o cabeçalho de autenticação no `fetchFromCrm()` (hoje assume
//      "Authorization: Bearer <chave>" — troque se o CRM usar outra coisa,
//      como uma query string ?api_key= ou um header customizado);
//   2) os caminhos `/collaborators` e `/services` em `mode === "import"`
//      (troque pelos endpoints reais da API do CRM).

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// Aplica o mapeamento configurado (ex: { name: "full_name" }) sobre um
// registro cru vindo do CRM, devolvendo um objeto só com os campos que o
// ServiçoApp entende.
function mapFields(rawItem: Record<string, unknown>, mapping: Record<string, string> | undefined) {
  if (!mapping) return {};
  const out: Record<string, unknown> = {};
  for (const [ourField, theirField] of Object.entries(mapping)) {
    out[ourField] = rawItem[theirField];
  }
  return out;
}

async function fetchFromCrm(baseUrl: string, apiKey: string, path: string) {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` }, // ajuste aqui se o CRM usar outro esquema
  });
  if (!res.ok) throw new Error(`CRM respondeu ${res.status} em ${path}`);
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    // Cliente "como o usuário": respeita RLS, então só enxerga a
    // configuração de CRM da própria empresa dele.
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) return jsonResponse({ error: "Não autenticado." }, 401);

    const { company_id, mode } = await req.json();
    if (!company_id || !["test", "import"].includes(mode)) {
      return jsonResponse({ error: 'Envie { company_id, mode: "test" | "import" }.' }, 400);
    }

    // Confirma que quem chamou é admin da empresa que está tentando importar
    // (defesa extra além do RLS, que já protege a tabela em si).
    const { data: myProfile } = await userClient.from("profiles").select("company_id, company_role").eq("id", userData.user.id).maybeSingle();
    if (myProfile?.company_id !== company_id || myProfile?.company_role !== "company_admin") {
      return jsonResponse({ error: "Sem permissão pra importar dados desta empresa." }, 403);
    }

    const { data: integration } = await userClient.from("crm_integrations").select("*").eq("company_id", company_id).maybeSingle();
    if (!integration?.base_url || !integration?.api_key) {
      return jsonResponse({ ok: false, message: "Configure e salve a URL e a chave do CRM antes de testar/importar." }, 200);
    }

    if (mode === "test") {
      try {
        await fetchFromCrm(integration.base_url, integration.api_key, "");
        return jsonResponse({ ok: true, message: "Conexão com o CRM respondeu com sucesso." });
      } catch (err) {
        return jsonResponse({ ok: false, message: `Falha ao conectar: ${(err as Error).message}` });
      }
    }

    // mode === "import" — usa a service role a partir daqui porque criar
    // usuários de autenticação (auth.admin.createUser) exige privilégio de
    // administrador, que o token do usuário logado não tem.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const mapping = integration.field_mapping || {};

    let servicesImported = 0;
    let collaboratorsImported = 0;
    const warnings: string[] = [];

    // --- Serviços -----------------------------------------------------
    try {
      const rawServices = await fetchFromCrm(integration.base_url, integration.api_key, "/services");
      const list = Array.isArray(rawServices) ? rawServices : rawServices.data || [];
      for (const raw of list) {
        const mapped = mapFields(raw, mapping.services);
        if (!mapped.name) continue;
        const { data: existing } = await admin.from("services").select("id").eq("company_id", company_id).eq("name", mapped.name).maybeSingle();
        const payload = {
          company_id,
          name: mapped.name,
          default_duration_minutes: Number(mapped.default_duration_minutes) || 60,
          price: mapped.price != null ? Number(mapped.price) : null,
        };
        if (existing) await admin.from("services").update(payload).eq("id", existing.id);
        else await admin.from("services").insert(payload);
        servicesImported++;
      }
    } catch (err) {
      warnings.push(`Serviços: ${(err as Error).message}`);
    }

    // --- Colaboradores --------------------------------------------------
    try {
      const { count: currentSeats } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("company_id", company_id).eq("company_role", "collaborator");
      const { data: company } = await admin.from("companies").select("seats_limit").eq("id", company_id).single();
      let seatsLeft = (company?.seats_limit || 0) - (currentSeats || 0);

      const rawCollaborators = await fetchFromCrm(integration.base_url, integration.api_key, "/collaborators");
      const list = Array.isArray(rawCollaborators) ? rawCollaborators : rawCollaborators.data || [];

      for (const raw of list) {
        if (seatsLeft <= 0) { warnings.push("Limite de colaboradores atingido — nem todos foram importados."); break; }
        const mapped = mapFields(raw, mapping.collaborators);
        if (!mapped.email) continue;

        const { data: existingProfile } = await admin.from("profiles").select("id").eq("email", mapped.email).maybeSingle();
        if (existingProfile) {
          await admin.from("profiles").update({ company_id, company_role: "collaborator", name: mapped.name, phone: mapped.phone }).eq("id", existingProfile.id);
        } else {
          // Cria um usuário de autenticação novo (sem senha definida — a
          // pessoa usa "esqueci minha senha" no primeiro acesso pra criar a dela).
          const { data: created, error: createError } = await admin.auth.admin.createUser({
            email: mapped.email, email_confirm: true,
          });
          if (createError) { warnings.push(`${mapped.email}: ${createError.message}`); continue; }
          await admin.from("profiles").upsert({
            id: created.user.id, email: mapped.email, name: mapped.name || mapped.email,
            phone: mapped.phone || null, company_id, company_role: "collaborator",
          });
        }
        collaboratorsImported++;
        seatsLeft--;
      }
    } catch (err) {
      warnings.push(`Colaboradores: ${(err as Error).message}`);
    }

    await admin.from("crm_integrations").update({ last_synced_at: new Date().toISOString() }).eq("company_id", company_id);

    return jsonResponse({
      ok: true,
      message: `Importados ${servicesImported} serviço(s) e ${collaboratorsImported} colaborador(es).` + (warnings.length ? ` Avisos: ${warnings.join(" | ")}` : ""),
    });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
