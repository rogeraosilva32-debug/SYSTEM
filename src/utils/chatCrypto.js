import supabase from "../services/supabase";

// Criptografia do chat: AES-256-GCM (via Web Crypto API nativa do
// navegador — sem biblioteca externa) com uma chave aleatória gerada uma
// vez por "sala" (o colaborador + os admins da empresa dele), guardada em
// chat_keys. Isso cifra o conteúdo de cada mensagem antes de gravar no
// banco.
//
// Seja direto sobre o que isso protege: é defesa em profundidade — se um
// dump de banco vazar, ou se um bug futuro expuser só a tabela de
// mensagens sem também expor chat_keys, o conteúdo continua ilegível. NÃO é
// criptografia ponta-a-ponta no sentido estrito de "nem o servidor jamais
// consegue ler" — quem tem acesso de service role ao projeto Supabase
// consegue ler as duas tabelas e decifrar. Ponta-a-ponta de verdade exigiria
// um par de chaves pública/privada por pessoa, mantido só no aparelho de
// cada uma — bem mais complexo de fazer com segurança, especialmente
// quando várias pessoas (todos os admins da empresa) precisam conseguir
// ler a mesma conversa.
//
// Exige contexto seguro (https ou localhost) — a Web Crypto API não fica
// disponível fora disso, mesma regra do GPS usado no mapa de rota.

function toB64(bytes) {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str);
}
function fromB64(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function importKey(rawKeyBytes) {
  return crypto.subtle.importKey("raw", rawKeyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

// Busca a chave da sala; se ainda não existir, gera uma nova. Se duas
// pessoas tentarem criar ao mesmo tempo, o "ignoreDuplicates" garante que só
// a primeira vale — por isso relemos depois de tentar criar, pra garantir
// que todo mundo acaba usando a mesma chave.
// Qualquer falha ao ler a chave LANÇA erro: usar uma chave gerada só neste
// navegador cifraria mensagens que ninguém mais conseguiria ler.
export async function getOrCreateRoomKey(collaboratorId, companyId) {
  const { data: existing, error: readError } = await supabase
    .from("chat_keys").select("key_b64").eq("collaborator_id", collaboratorId).maybeSingle();
  if (readError) throw new Error("Não foi possível abrir a conversa: " + readError.message);
  if (existing?.key_b64) return existing.key_b64;

  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const key_b64 = toB64(rawKey);

  await supabase.from("chat_keys").upsert(
    { collaborator_id: collaboratorId, company_id: companyId, key_b64 },
    { onConflict: "collaborator_id", ignoreDuplicates: true }
  );

  const { data: finalRow, error: rereadError } = await supabase
    .from("chat_keys").select("key_b64").eq("collaborator_id", collaboratorId).maybeSingle();
  if (rereadError || !finalRow?.key_b64) {
    throw new Error("Não foi possível abrir a conversa" + (rereadError ? ": " + rereadError.message : "."));
  }
  return finalRow.key_b64;
}

export async function encryptMessage(plaintext, key_b64) {
  const key = await importKey(fromB64(key_b64));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return { ciphertext: toB64(new Uint8Array(cipherBuffer)), iv: toB64(iv) };
}

export async function decryptMessage(ciphertext_b64, iv_b64, key_b64) {
  try {
    const key = await importKey(fromB64(key_b64));
    const plainBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(iv_b64) }, key, fromB64(ciphertext_b64)
    );
    return new TextDecoder().decode(plainBuffer);
  } catch {
    return "[Não foi possível decifrar esta mensagem]";
  }
}
