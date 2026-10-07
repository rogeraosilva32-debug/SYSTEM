// supabase/functions/send-push/index.ts
//
// Envia uma notificação push de verdade (chega com o app fechado/celular
// travado) pra um usuário, usando as inscrições salvas em
// push_subscriptions. Chamada tanto direto do app (ex: logo após mandar uma
// mensagem no chat) quanto — se você configurar o gatilho opcional descrito
// no README — automaticamente pelo banco sempre que uma notificação for
// criada, para QUALQUER evento (nova designação, atendimento iniciado, etc).
//
// Deploy:
//   supabase functions deploy send-push
//
// Duas variáveis de ambiente precisam estar configuradas no projeto
// (Supabase → Project Settings → Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY  (mesmo valor de VITE_VAPID_PUBLIC_KEY no .env do app)
//   VAPID_PRIVATE_KEY (NUNCA vai no .env do app — só aqui, no servidor)
//   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=...
//
// Uso pelo app (autenticado, chama pro próprio usuário implicitamente
// através do payload):
//   supabase.functions.invoke('send-push', { body: { user_id, title, message, url } })

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

webpush.setVapidDetails("mailto:suporte@example.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // Aceita tanto a chamada do app ({ user_id, title, ... }) quanto o
    // formato fixo do Database Webhook do Supabase ({ type, table, record }).
    const raw = await req.json();
    const body = raw?.record ?? raw;
    const user_id = body?.user_id;
    let { title, message, url } = body ?? {};
    if (!user_id || !title) {
      return json({ error: "Envie { user_id, title, message?, url? }." }, 400);
    }

    // Quem está chamando? Só o próprio banco (webhook com a service role)
    // pode mandar texto livre. Do app, o texto é montado aqui no servidor e
    // o destinatário precisa ser da mesma empresa: antes, qualquer pessoa
    // logada mandava qualquer texto pra qualquer usuário de qualquer empresa.
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (token !== SERVICE_ROLE_KEY) {
      const { data: auth } = await admin.auth.getUser(token);
      if (!auth?.user) return json({ error: "Não autenticado." }, 401);

      const { data: people } = await admin.from("profiles")
        .select("id, name, company_id, is_platform_admin")
        .in("id", [auth.user.id, user_id]);
      const caller = people?.find((p) => p.id === auth.user.id);
      const target = people?.find((p) => p.id === user_id);
      const sameCompany = caller?.company_id && caller.company_id === target?.company_id;
      if (!target || !(sameCompany || caller?.is_platform_admin)) {
        return json({ error: "Destinatário não permitido." }, 403);
      }

      title = "Nova mensagem";
      message = `${caller?.name || "Alguém"} enviou uma mensagem.`;
      // Só caminhos internos do próprio app (evita link para site externo).
      url = typeof url === "string" && /^\/(?!\/)/.test(url) ? url : "/";
    }

    const { data: subs } = await admin.from("push_subscriptions").select("*").eq("user_id", user_id);

    // Vindo do webhook da tabela notifications: a tag é a mesma que o app
    // aberto usa, para o aviso não aparecer duas vezes.
    const tag = raw?.record?.id ? `n-${raw.record.id}` : undefined;
    const payload = JSON.stringify({ title, message: message || "", url: url || "/", tag });
    let sent = 0;

    for (const sub of subs || []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          payload
        );
        sent++;
      } catch (err: any) {
        // Inscrição expirada/revogada pelo navegador — remove pra não
        // tentar de novo pra sempre em algo que nunca mais vai funcionar.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await admin.from("push_subscriptions").delete().eq("id", sub.id);
        } else {
          console.warn("Falha ao enviar push:", err?.message || err);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, sent, of: (subs || []).length }), {
      status: 200, headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
