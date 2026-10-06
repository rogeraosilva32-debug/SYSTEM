import { useState, useEffect, useRef, useCallback } from "react";
import { Box, TextField, IconButton, Typography, CircularProgress, Popover, Button } from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import EmojiEmotionsOutlinedIcon from "@mui/icons-material/EmojiEmotionsOutlined";
import supabase from "../services/supabase";
import { useAuth } from "../context/AuthContext";
import { getOrCreateRoomKey, encryptMessage, decryptMessage } from "../utils/chatCrypto";

const EMOJIS = [
  "😀", "😂", "😊", "😉", "😍", "🤔", "😅", "😢", "😡", "👍",
  "👎", "🙏", "👏", "💪", "🔥", "✅", "❌", "⚠️", "📍", "🕒",
  "📦", "🚗", "🏠", "📞", "💬", "🎉", "❤️", "😴", "🤝", "👋",
];

function formatTime(iso) {
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${time}`;
}

// Chat entre um colaborador e os admins da sua empresa — mensagens cifradas
// (AES-256-GCM, ver utils/chatCrypto.js), com emojis, marcação de horário e
// persistidas no banco (a "cópia de segurança" real depende da política de
// backup do seu projeto Supabase — ver README).
export default function ChatPanel({ collaboratorId, companyId, roomLabel }) {
  const { profile, isCompanyAdmin, isSupervisor } = useAuth();
  // Admin e supervisor ficam do mesmo lado da conversa (o "lado da empresa").
  const isStaff = isCompanyAdmin || isSupervisor;
  const [roomKey, setRoomKey] = useState(null);
  const [messages, setMessages] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [senderNames, setSenderNames] = useState({});
  // Quem recebe push: colaborador + admins (supervisores só aparecem com nome).
  const [pushRecipients, setPushRecipients] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [emojiAnchor, setEmojiAnchor] = useState(null);
  const bottomRef = useRef(null);

  const decryptAndSet = useCallback(async (rows, key) => {
    const decrypted = await Promise.all(
      rows.map(async (m) => ({ ...m, text: await decryptMessage(m.ciphertext, m.iv, key) }))
    );
    setMessages(decrypted);
  }, []);

  // ── Carrega a chave da sala + histórico + nomes, e só then assina o tempo
  // real — nessa ordem, pra uma mensagem que chegue bem no meio do
  // carregamento nunca ser perdida (se a assinatura em tempo real começasse
  // antes do histórico carregar, uma mensagem podia chegar por ali e depois
  // ser apagada quando o histórico define a lista do zero).
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessages(null);
    setLoadError(false);
    let channel = null;

    (async () => {
     try {
      const key = await getOrCreateRoomKey(collaboratorId, companyId);
      if (cancelled) return;
      setRoomKey(key);

      const [{ data: rows, error: rowsError }, { data: people }] = await Promise.all([
        supabase.from("chat_messages").select("*").eq("collaborator_id", collaboratorId).order("created_at", { ascending: true }).limit(200),
        supabase.from("profiles").select("id, name, company_role")
          .or(`id.eq.${collaboratorId},and(company_id.eq.${companyId},company_role.in.(company_admin,supervisor))`),
      ]);
      if (cancelled) return;
      if (rowsError) throw rowsError;

      const names = {};
      (people || []).forEach((p) => { names[p.id] = p.name; });
      setSenderNames(names);
      setPushRecipients((people || []).filter((p) => p.id === collaboratorId || p.company_role === "company_admin").map((p) => p.id));

      await decryptAndSet(rows || [], key);
      if (cancelled) return;

      // Marca como lidas as mensagens que faltavam pro papel de quem está vendo.
      const unreadField = isStaff ? "read_by_admin" : "read_by_collaborator";
      const unreadIds = (rows || []).filter((m) => !m[unreadField]).map((m) => m.id);
      if (unreadIds.length > 0) {
        // O builder do supabase só envia ao ser "aguardado": sem o then, nada era gravado.
        supabase.from("chat_messages").update({ [unreadField]: true }).in("id", unreadIds).then(() => {});
      }

      // Só assina tempo real DEPOIS do histórico já estar na tela — evita
      // perder uma mensagem que chegasse durante o carregamento.
      channel = supabase
        .channel(`chat-${collaboratorId}`)
        .on("postgres_changes", {
          event: "INSERT", schema: "public", table: "chat_messages", filter: `collaborator_id=eq.${collaboratorId}`,
        }, async (payload) => {
          const text = await decryptMessage(payload.new.ciphertext, payload.new.iv, key);
          setMessages((prev) => {
            if ((prev || []).some((m) => m.id === payload.new.id)) return prev; // evita duplicar
            return [...(prev || []), { ...payload.new, text }];
          });
          if (payload.new.sender_id !== profile.id) {
            supabase.from("chat_messages").update({ [unreadField]: true }).eq("id", payload.new.id).then(() => {});
          }
        })
        .subscribe();
     } catch (err) {
      console.warn("Falha ao abrir a conversa:", err?.message || err);
      if (!cancelled) setLoadError(true);
     }
    })();

    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, [collaboratorId, companyId, isStaff, profile.id, decryptAndSet, reloadKey]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !roomKey || sending) return;
    setSending(true);
    setInput("");

    let error;
    try {
      const { ciphertext, iv } = await encryptMessage(text, roomKey);
      ({ error } = await supabase.from("chat_messages").insert({
        company_id: companyId, collaborator_id: collaboratorId, sender_id: profile.id,
        ciphertext, iv,
        read_by_admin: isStaff, read_by_collaborator: !isStaff,
      }));
    } catch (e) {
      error = e;
    }
    setSending(false);
    if (error) {
      console.warn("Falha ao enviar mensagem:", error.message);
      setInput(text); // devolve o texto pro campo pra não perder o que a pessoa escreveu
      return;
    }

    // Push de verdade (chega com o app fechado) pra quem não mandou — não
    // trava o envio se isso falhar (função não publicada ainda, por
    // exemplo); é só um "melhor esforço" por cima da notificação interna,
    // que já foi criada pelo gatilho no banco de qualquer forma.
    pushRecipients
      .filter((id) => id !== profile.id)
      .forEach((recipientId) => {
        supabase.functions.invoke("send-push", {
          body: { user_id: recipientId, title: "Nova mensagem", message: `${profile.name} enviou uma mensagem.`, url: "/mensagens" },
        }).catch(() => {});
      });
  };

  const insertEmoji = (emoji) => {
    setInput((prev) => prev + emoji);
    setEmojiAnchor(null);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: 480, border: "1px solid #E7E5E4", borderRadius: "14px", overflow: "hidden", background: "#fff" }}>
      {roomLabel && (
        <Box sx={{ px: 2, py: 1.3, borderBottom: "1px solid #E7E5E4", background: "#FAFAF9" }}>
          <Typography sx={{ fontWeight: 700, fontSize: 13.5 }}>{roomLabel}</Typography>
        </Box>
      )}

      <Box sx={{ flex: 1, overflowY: "auto", p: 2, display: "flex", flexDirection: "column", gap: 1 }}>
        {loadError ? (
          <Box sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1 }}>
            <Typography sx={{ color: "#78716C", fontSize: 13 }}>Não foi possível abrir a conversa.</Typography>
            <Button size="small" variant="outlined" onClick={() => setReloadKey((k) => k + 1)} sx={{ textTransform: "none", fontWeight: 700 }}>
              Tentar de novo
            </Button>
          </Box>
        ) : messages === null ? (
          <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}><CircularProgress size={22} /></Box>
        ) : messages.length === 0 ? (
          <Typography sx={{ textAlign: "center", color: "#A8A29E", fontSize: 13, my: "auto" }}>
            Nenhuma mensagem ainda. Diga oi 👋
          </Typography>
        ) : (
          messages.map((m) => {
            const mine = m.sender_id === profile.id;
            return (
              <Box key={m.id} sx={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start" }}>
                {!mine && (
                  <Typography sx={{ fontSize: 10.5, color: "#A8A29E", fontWeight: 700, mb: 0.2, ml: 0.5 }}>
                    {senderNames[m.sender_id] || "—"}
                  </Typography>
                )}
                <Box sx={{
                  maxWidth: "78%", px: 1.6, py: 1, borderRadius: "14px",
                  background: mine ? "#1C1917" : "#F5F5F4",
                  color: mine ? "#fff" : "#1C1917",
                  fontSize: 13.5, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word",
                }}>
                  {m.text}
                </Box>
                <Typography sx={{ fontSize: 10, color: "#A8A29E", mt: 0.3, mx: 0.5 }}>
                  {formatTime(m.created_at)}
                </Typography>
              </Box>
            );
          })
        )}
        <div ref={bottomRef} />
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, p: 1.2, borderTop: "1px solid #E7E5E4" }}>
        <IconButton size="small" onClick={(e) => setEmojiAnchor(e.currentTarget)}>
          <EmojiEmotionsOutlinedIcon sx={{ fontSize: 20, color: "#78716C" }} />
        </IconButton>
        <TextField
          fullWidth size="small" placeholder="Escreva uma mensagem..." value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          multiline maxRows={4}
        />
        <IconButton onClick={handleSend} disabled={!input.trim() || sending || !roomKey || loadError} sx={{ color: "#1C1917" }}>
          <SendIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </Box>

      <Popover
        open={!!emojiAnchor} anchorEl={emojiAnchor} onClose={() => setEmojiAnchor(null)}
        anchorOrigin={{ vertical: "top", horizontal: "left" }} transformOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 0.3, p: 1, maxWidth: 220 }}>
          {EMOJIS.map((e) => (
            <Box
              key={e} onClick={() => insertEmoji(e)}
              sx={{ fontSize: 19, textAlign: "center", cursor: "pointer", borderRadius: 1, p: 0.4, "&:hover": { background: "#F5F5F4" } }}
            >
              {e}
            </Box>
          ))}
        </Box>
      </Popover>
    </Box>
  );
}
