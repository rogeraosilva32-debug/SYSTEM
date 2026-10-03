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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { user_id, title, message, url } = await req.json();
    if (!user_id || !title) {
      return new Response(JSON.stringify({ error: "Envie { user_id, title, message?, url? }." }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { data: subs } = await admin.from("push_subscriptions").select("*").eq("user_id", user_id);

    const payload = JSON.stringify({ title, message: message || "", url: url || "/" });
    let sent = 0;

    for (const sub of subs || []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          payload
        );
        sent++;
      } catch (err) {
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
