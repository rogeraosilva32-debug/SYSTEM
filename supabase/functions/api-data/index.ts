// supabase/functions/api-data/index.ts
//
// API DE SAÍDA — pra sistemas externos lerem os dados de UMA empresa
// (colaboradores, serviços, designações) usando a chave gerada na aba
// "Integrações & API" do painel.
//
// Deploy (uma vez, via Supabase CLI, já autenticado no projeto):
//   supabase functions deploy api-data --no-verify-jwt
//
// (--no-verify-jwt é necessário porque quem chama esta função é um sistema
// externo com a CHAVE DA EMPRESA, não um usuário logado com JWT do Supabase
// Auth — a autenticação aqui é feita manualmente, checando a tabela
// api_keys, não pelo mecanismo padrão de Auth do Supabase.)
//
// Uso pelo sistema externo:
//   GET https://<seu-projeto>.supabase.co/functions/v1/api-data?resource=collaborators
//   Header: Authorization: Bearer <chave gerada no painel>
//
//   resource pode ser: collaborators | services | assignments
//
// Exemplo com curl:
//   curl "https://SEU-PROJETO.supabase.co/functions/v1/api-data?resource=services" \
//        -H "Authorization: Bearer sa_xxxxxxxxxxxx"

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Cliente com a service role — só é seguro porque roda no servidor
// (Edge Function), nunca no navegador. É o que permite ler os dados
// ignorando RLS depois de já termos validado a chave da empresa na mão.
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const ALLOWED_RESOURCES = ["collaborators", "services", "assignments"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const authHeader = req.headers.get("authorization") || "";
  const apiKey = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Chave de API ausente. Envie Authorization: Bearer <chave>." }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const { data: keyRow, error: keyError } = await admin
    .from("api_keys")
    .select("company_id, revoked")
    .eq("key", apiKey)
    .maybeSingle();

  if (keyError || !keyRow || keyRow.revoked) {
    return new Response(JSON.stringify({ error: "Chave de API inválida ou revogada." }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const resource = url.searchParams.get("resource");

  if (!resource || !ALLOWED_RESOURCES.includes(resource)) {
    return new Response(JSON.stringify({ error: `Parâmetro "resource" deve ser um de: ${ALLOWED_RESOURCES.join(", ")}` }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  let query;
  if (resource === "collaborators") {
    query = admin.from("profiles").select("id, name, email, phone").eq("company_id", keyRow.company_id).eq("company_role", "collaborator");
  } else if (resource === "services") {
    query = admin.from("services").select("id, name, description, default_duration_minutes, price, active").eq("company_id", keyRow.company_id);
  } else {
    query = admin.from("assignments")
      .select("id, service_id, collaborator_id, customer_name, address_street, address_neighborhood, address_city, scheduled_start, duration_minutes, status")
      .eq("company_id", keyRow.company_id)
      .order("scheduled_start", { ascending: false })
      .limit(200);
  }

  const { data, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ resource, count: data.length, data }), {
    status: 200, headers: { ...cors, "Content-Type": "application/json" },
  });
});
