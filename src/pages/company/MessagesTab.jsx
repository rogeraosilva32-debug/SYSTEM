import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Box, CircularProgress, Badge, TextField, Typography, Avatar, Button, Dialog, DialogTitle,
  DialogContent, DialogActions, Alert, useMediaQuery, InputAdornment,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
import SearchIcon from "@mui/icons-material/Search";
import ChatPanel from "../../components/ChatPanel";
import supabase from "../../services/supabase";
import { useAuth } from "../../context/AuthContext";
import { getOrCreateRoomKey, encryptMessage } from "../../utils/chatCrypto";
import PageLoading from "../../components/PageLoading";

const POLL_MS = 20000;

function when(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

// Aviso para todos os motoboys de uma vez (cada um recebe na própria conversa).
function BroadcastDialog({ open, onClose, people, companyId, profileId }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const send = async () => {
    const msg = text.trim();
    if (!msg) return;
    setBusy(true);
    setResult(null);
    let ok = 0;
    const failed = [];
    for (const p of people) {
      try {
        const key = await getOrCreateRoomKey(p.id, companyId);
        const { ciphertext, iv } = await encryptMessage(msg, key);
        const { error } = await supabase.from("chat_messages").insert({
          company_id: companyId, collaborator_id: p.id, sender_id: profileId, ciphertext, iv,
          read_by_admin: true, read_by_collaborator: false,
        });
        if (error) throw error;
        ok += 1;
      } catch {
        failed.push(p.name);
      }
    }
    setBusy(false);
    setResult({ ok, failed });
    if (!failed.length) { setText(""); setTimeout(() => { setResult(null); onClose(true); }, 1200); }
  };

  return (
    <Dialog open={open} onClose={() => !busy && onClose(false)} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>Aviso para todos</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 12.5, color: "#78716C", mb: 1.5 }}>
          Vai para a conversa de cada um dos {people.length} colaboradores{people.length ? "" : " (nenhum cadastrado)"}.
        </Typography>
        <TextField autoFocus fullWidth multiline minRows={3} placeholder="Ex.: Hoje fechamos às 23h." value={text} onChange={(e) => setText(e.target.value)} />
        {result && (
          <Alert severity={result.failed.length ? "warning" : "success"} sx={{ mt: 1.5 }}>
            Enviado para {result.ok}.{result.failed.length ? ` Não foi para: ${result.failed.join(", ")}.` : ""}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={() => onClose(false)} disabled={busy} sx={{ color: "#78716C" }}>Cancelar</Button>
        <Button variant="contained" onClick={send} disabled={busy || !text.trim() || !people.length}>
          {busy ? <CircularProgress size={18} sx={{ color: "#fff" }} /> : "Enviar para todos"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Mensagens do gestor/supervisor: lista de conversas (não lidas primeiro,
// depois as mais recentes), busca, aviso para todos e, no celular, uma tela
// por vez (lista → conversa → voltar).
export function MessagesTab() {
  const { companyId, profile } = useAuth();
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up("sm"), { noSsr: true });
  const [collaborators, setCollaborators] = useState(null);
  const [selected, setSelected] = useState(null);
  const [activity, setActivity] = useState({});
  const [search, setSearch] = useState("");
  const [broadcast, setBroadcast] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("id, name").eq("company_id", companyId).eq("company_role", "collaborator").order("name");
    setCollaborators(data || []);
  }, [companyId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  // Última mensagem e não lidas de cada conversa (sem abrir o conteúdo).
  const loadActivity = useCallback(async () => {
    const { data } = await supabase
      .from("chat_messages")
      .select("collaborator_id, created_at, read_by_admin, sender_id")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(1000);
    const next = {};
    (data || []).forEach((m) => {
      const a = next[m.collaborator_id] || (next[m.collaborator_id] = { last: m.created_at, lastFromThem: m.sender_id === m.collaborator_id, unread: 0 });
      if (!m.read_by_admin) a.unread += 1;
    });
    setActivity(next);
  }, [companyId]);

  useEffect(() => {
    loadActivity(); // eslint-disable-line react-hooks/set-state-in-effect
    const t = setInterval(() => { if (!document.hidden) loadActivity(); }, POLL_MS);
    window.addEventListener("chat-read", loadActivity);
    return () => { clearInterval(t); window.removeEventListener("chat-read", loadActivity); };
  }, [loadActivity]);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (collaborators || [])
      .filter((c) => !q || c.name?.toLowerCase().includes(q))
      .sort((a, b) => {
        const A = activity[a.id] || {}; const B = activity[b.id] || {};
        if (!!B.unread !== !!A.unread) return B.unread ? 1 : -1;
        return (B.last || "").localeCompare(A.last || "") || (a.name || "").localeCompare(b.name || "");
      });
  }, [collaborators, activity, search]);

  if (collaborators === null) {
    return <PageLoading />;
  }

  if (collaborators.length === 0) {
    return <Box sx={{ py: 6, textAlign: "center", color: "#A8A29E", fontSize: 14 }}>Cadastre colaboradores pra poder conversar com eles por aqui.</Box>;
  }

  const showList = wide || !selected;
  const showChat = wide || selected;

  return (
    <Box sx={{ display: "flex", gap: 2 }}>
      {showList && (
        <Box sx={{ width: { xs: "100%", sm: 280 }, flexShrink: 0, border: "1px solid #E7E5E4", borderRadius: "14px", overflow: "hidden", background: "#fff", alignSelf: "flex-start" }}>
          <Box sx={{ p: 1.2, borderBottom: "1px solid #F5F5F4", display: "flex", flexDirection: "column", gap: 1 }}>
            <TextField size="small" placeholder="Buscar pessoa" value={search} onChange={(e) => setSearch(e.target.value)} slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18 }} /></InputAdornment> } }} />
            <Button size="small" variant="outlined" startIcon={<CampaignOutlinedIcon />} onClick={() => setBroadcast(true)} sx={{ textTransform: "none", fontWeight: 700 }}>
              Aviso para todos
            </Button>
          </Box>
          <Box sx={{ maxHeight: { sm: 470 }, overflowY: "auto" }}>
            {list.map((c) => {
              const a = activity[c.id] || {};
              return (
                <Box
                  key={c.id}
                  onClick={() => setSelected(c)}
                  data-testid="conversa"
                  sx={{
                    px: 1.5, py: 1.2, cursor: "pointer", borderBottom: "1px solid #F5F5F4",
                    background: selected?.id === c.id ? "#F5F5F4" : "transparent",
                    display: "flex", alignItems: "center", gap: 1.2,
                    "&:hover": { background: "#F5F5F4" },
                  }}
                >
                  <Avatar sx={{ width: 34, height: 34, fontSize: 14, background: "#E7E5E4", color: "#57534E", fontWeight: 800 }}>{c.name?.charAt(0)}</Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: 13.5, fontWeight: a.unread ? 800 : 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</Typography>
                    <Typography sx={{ fontSize: 11.5, color: a.unread ? "#B0463D" : "#A8A29E", fontWeight: a.unread ? 700 : 400 }}>
                      {a.unread ? `${a.unread} nova${a.unread > 1 ? "s" : ""}` : a.last ? (a.lastFromThem ? "Mensagem dele(a)" : "Você respondeu") : "Sem mensagens"}
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 0.5 }}>
                    <Typography sx={{ fontSize: 11, color: "#A8A29E" }}>{when(a.last)}</Typography>
                    {a.unread > 0 && <Badge badgeContent={a.unread} color="error" sx={{ mr: 1 }} />}
                  </Box>
                </Box>
              );
            })}
            {list.length === 0 && <Typography sx={{ p: 2, fontSize: 13, color: "#A8A29E" }}>Ninguém com esse nome.</Typography>}
          </Box>
        </Box>
      )}

      {showChat && (
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {!wide && (
            <Button startIcon={<ArrowBackIcon />} onClick={() => setSelected(null)} sx={{ mb: 1, textTransform: "none", fontWeight: 700, color: "#57534E" }}>
              Conversas
            </Button>
          )}
          {selected ? (
            <ChatPanel
              key={selected.id}
              collaboratorId={selected.id}
              companyId={companyId}
              roomLabel={selected.name}
            />
          ) : (
            <Box sx={{ height: 480, display: "flex", alignItems: "center", justifyContent: "center", border: "1px dashed #E7E5E4", borderRadius: "14px", color: "#A8A29E", fontSize: 13.5 }}>
              Escolha uma conversa ao lado.
            </Box>
          )}
        </Box>
      )}

      <BroadcastDialog open={broadcast} people={collaborators} companyId={companyId} profileId={profile?.id}
        onClose={(sent) => { setBroadcast(false); if (sent) loadActivity(); }} />
    </Box>
  );
}
