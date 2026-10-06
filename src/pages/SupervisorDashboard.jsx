import { useState, useEffect, useCallback } from "react";
import { Box, Table, TableHead, TableRow, TableCell, TableBody, CircularProgress } from "@mui/material";
import AppShell from "../components/AppShell";
import ReceiptLongOutlinedIcon from "@mui/icons-material/ReceiptLongOutlined";
import MapOutlinedIcon from "@mui/icons-material/MapOutlined";
import GroupOutlinedIcon from "@mui/icons-material/GroupOutlined";
import EventNoteOutlinedIcon from "@mui/icons-material/EventNoteOutlined";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutlineOutlined";
import useTab from "../hooks/useTab";
import { AssignmentsTab } from "./company/AssignmentsTab";
import { MessagesTab } from "./company/MessagesTab";
import { OrdersTab } from "./company/OrdersTab";
import { LiveMapTab } from "./company/LiveMapTab";
import supabase from "../services/supabase";
import { useAuth } from "../context/AuthContext";

const TABS = [
  { key: "orders", label: "Pedidos", icon: <ReceiptLongOutlinedIcon /> },
  { key: "live", label: "Mapa ao vivo", icon: <MapOutlinedIcon /> },
  { key: "messages", label: "Mensagens", icon: <ChatBubbleOutlineIcon />, unread: true },
  { key: "team", label: "Minha equipe", icon: <GroupOutlinedIcon /> },
  { key: "assignments", label: "Designações", icon: <EventNoteOutlinedIcon /> },
];

// Um supervisor enxerga só os colaboradores atribuídos a ele — a tabela de
// designações e o chat abaixo são os MESMOS componentes usados no painel da
// empresa (não foi preciso duplicar nada): o RLS no banco já restringe
// automaticamente o que aparece, tanto pra consulta quanto pra criação.
function MyTeam({ myId }) {
  const [team, setTeam] = useState(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("id, name, email, phone").eq("supervised_by", myId);
    setTeam(data || []);
  }, [myId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  if (team === null) return <Box sx={{ py: 6, textAlign: "center" }}><CircularProgress size={24} /></Box>;
  if (team.length === 0) return <Box sx={{ py: 6, textAlign: "center", color: "#A8A29E", fontSize: 14 }}>Nenhum colaborador atribuído a você ainda — fale com o admin da empresa.</Box>;

  return (
    <Table size="small">
      <TableHead><TableRow><TableCell>Nome</TableCell><TableCell>E-mail</TableCell><TableCell>Telefone</TableCell></TableRow></TableHead>
      <TableBody>
        {team.map((c) => (
          <TableRow key={c.id}><TableCell sx={{ fontWeight: 600 }}>{c.name}</TableCell><TableCell>{c.email}</TableCell><TableCell>{c.phone || "—"}</TableCell></TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function SupervisorDashboard() {
  const { profile } = useAuth();
  const [tab, setTab] = useTab(TABS.map((t) => t.key), "orders");

  return (
    <AppShell title={TABS.find((t) => t.key === tab)?.label} nav={{ items: TABS, current: tab, onSelect: setTab }}>
      {tab === "orders" && <OrdersTab />}
      {tab === "live" && <LiveMapTab />}
      {tab === "team" && <MyTeam myId={profile.id} />}
      {tab === "assignments" && <AssignmentsTab />}
      {tab === "messages" && <MessagesTab />}
    </AppShell>
  );
}
