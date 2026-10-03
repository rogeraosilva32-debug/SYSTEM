import { useState, useEffect, useCallback } from "react";
import { Box, CircularProgress, Badge } from "@mui/material";
import ChatPanel from "../../components/ChatPanel";
import supabase from "../../services/supabase";
import { useAuth } from "../../context/AuthContext";

export function MessagesTab() {
  const { companyId } = useAuth();
  const [collaborators, setCollaborators] = useState(null);
  const [selected, setSelected] = useState(null);
  const [unread, setUnread] = useState({});

  const load = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("id, name").eq("company_id", companyId).eq("company_role", "collaborator").order("name");
    setCollaborators(data || []);
  }, [companyId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  // Contagem de não lidas por colaborador — refeita sempre que a lista de
  // colaboradores muda ou quando se volta da conversa (pra atualizar o badge).
  const loadUnread = useCallback(async () => {
    if (!collaborators?.length) return;
    const { data } = await supabase
      .from("chat_messages")
      .select("collaborator_id")
      .eq("company_id", companyId)
      .eq("read_by_admin", false);
    const counts = {};
    (data || []).forEach((m) => { counts[m.collaborator_id] = (counts[m.collaborator_id] || 0) + 1; });
    setUnread(counts);
  }, [collaborators, companyId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUnread();
  }, [loadUnread]);

  // Ao abrir uma conversa, o ChatPanel marca as mensagens como lidas de
  // forma assíncrona — espera um instante e atualiza os badges, senão o
  // contador de não lidas ficava sem atualizar até trocar de aba.
  useEffect(() => {
    if (!selected) return;
    const timer = setTimeout(loadUnread, 800);
    return () => clearTimeout(timer);
  }, [selected, loadUnread]);

  if (collaborators === null) {
    return <Box sx={{ py: 6, textAlign: "center" }}><CircularProgress size={24} /></Box>;
  }

  if (collaborators.length === 0) {
    return <Box sx={{ py: 6, textAlign: "center", color: "#A8A29E", fontSize: 14 }}>Cadastre colaboradores pra poder conversar com eles por aqui.</Box>;
  }

  return (
    <Box sx={{ display: "flex", gap: 2, flexDirection: { xs: "column", sm: "row" } }}>
      <Box sx={{ width: { xs: "100%", sm: 220 }, flexShrink: 0, border: "1px solid #E7E5E4", borderRadius: "14px", overflow: "hidden", background: "#fff" }}>
        {collaborators.map((c) => (
          <Box
            key={c.id}
            onClick={() => setSelected(c)}
            sx={{
              px: 2, py: 1.4, cursor: "pointer", fontSize: 13.5, fontWeight: 600,
              borderBottom: "1px solid #F5F5F4",
              background: selected?.id === c.id ? "#F5F5F4" : "transparent",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              "&:hover": { background: "#F5F5F4" },
            }}
          >
            {c.name}
            {unread[c.id] > 0 && <Badge badgeContent={unread[c.id]} color="error" sx={{ mr: 1 }} />}
          </Box>
        ))}
      </Box>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        {selected ? (
          <ChatPanel
            key={selected.id}
            collaboratorId={selected.id}
            companyId={companyId}
            roomLabel={`Conversa com ${selected.name}`}
          />
        ) : (
          <Box sx={{ height: 480, display: "flex", alignItems: "center", justifyContent: "center", border: "1px dashed #E7E5E4", borderRadius: "14px", color: "#A8A29E", fontSize: 13.5 }}>
            Escolha um colaborador pra ver a conversa.
          </Box>
        )}
      </Box>
    </Box>
  );
}
