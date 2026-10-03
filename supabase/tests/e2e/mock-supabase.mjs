// Servidor que imita o mínimo da API do Supabase para testar o app no
// navegador sem um projeto Supabase: /rest/v1 vai para um PostgREST local,
// /auth/v1 aceita login de qualquer usuário de auth.users (qualquer senha).
// Uso: node mock-supabase.mjs  (porta 54321; PostgREST em 54322)
import http from "node:http";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const SECRET = process.env.JWT_SECRET || "segredo-de-teste-local-com-32-caracteres!!";
const DB = process.env.DB || "sistema_e2e";
const REST = "http://127.0.0.1:54322";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function sign(payload) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(payload);
  const sig = crypto.createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
function decode(token) {
  try { return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()); } catch { return null; }
}
function userByEmail(email) {
  const out = execFileSync("sudo", ["-u", "postgres", "psql", "-X", "-At", "-d", DB, "-c",
    `select id from auth.users where email = '${String(email).replace(/'/g, "''")}'`]).toString().trim();
  return out || null;
}
function session(id, email) {
  const now = Math.floor(Date.now() / 1000);
  const access_token = sign({ sub: id, email, role: "authenticated", aud: "authenticated", iat: now, exp: now + 86400 });
  const user = { id, email, aud: "authenticated", role: "authenticated", user_metadata: {}, app_metadata: {}, created_at: new Date().toISOString() };
  return { access_token, token_type: "bearer", expires_in: 86400, expires_at: now + 86400, refresh_token: `r-${id}`, user };
}
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  "Access-Control-Expose-Headers": "Content-Range, Content-Profile",
};
const send = (res, status, data) => { res.writeHead(status, { ...cors, "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };

http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  const url = new URL(req.url, "http://x");
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);

  if (url.pathname.startsWith("/rest/v1")) {
    const headers = { ...req.headers }; delete headers.host; delete headers.apikey;
    const auth = headers.authorization || "";
    if (!decode(auth.replace(/^Bearer /, ""))?.sub) {
      headers.authorization = `Bearer ${sign({ role: "anon", exp: Math.floor(Date.now() / 1000) + 86400 })}`;
    }
    const r = await fetch(REST + url.pathname.replace("/rest/v1", "") + url.search, {
      method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
    });
    const out = Buffer.from(await r.arrayBuffer());
    const h = {};
    r.headers.forEach((v, k) => { if (!["content-encoding", "transfer-encoding", "connection"].includes(k) && !k.startsWith("access-control-")) h[k] = v; });
    Object.assign(h, cors);
    res.writeHead(r.status, h); return res.end(out);
  }
  if (url.pathname === "/auth/v1/token") {
    const data = JSON.parse(body.toString() || "{}");
    if (url.searchParams.get("grant_type") === "refresh_token") {
      const id = String(data.refresh_token || "").replace(/^r-/, "");
      return send(res, 200, session(id, ""));
    }
    const id = userByEmail(data.email);
    if (!id) return send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials" });
    return send(res, 200, session(id, data.email));
  }
  if (url.pathname === "/auth/v1/user") {
    const p = decode((req.headers.authorization || "").replace(/^Bearer /, ""));
    if (!p?.sub) return send(res, 401, { message: "invalid token" });
    return send(res, 200, session(p.sub, p.email).user);
  }
  if (url.pathname === "/auth/v1/logout") { res.writeHead(204, cors); return res.end(); }
  send(res, 404, { message: "não simulado: " + url.pathname });
}).listen(54321, () => console.log("mock supabase em http://localhost:54321"));
