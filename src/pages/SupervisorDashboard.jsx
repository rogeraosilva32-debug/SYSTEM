import { useState, useEffect, useCallback } from "react";
import { Box, Table, TableHead, TableRow, TableCell, TableBody, CircularProgress } from "@mui/material";
import AppShell from "../components/AppShell";
import { AssignmentsTab } from "./company/AssignmentsTab";
import { MessagesTab } from "./company/MessagesTab";
import { OrdersTab } from "./company/OrdersTab";
import { LiveMapTab } from "./company/LiveMapTab";
import supabase from "../services/supabase";
import { useAuth } from "../context/AuthContext";

const TABS = [
  { key: "orders", label: "Pedidos" },
  { key: "live", label: "Mapa ao vivo" },
  { key: "team", label: "Minha equipe" },
  { key: "assignments", label: "Designações" },
  { key: "messages", label: "Mensagens" },
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
  const [tab, setTab] = useState("orders");

  return (
    <AppShell title="Supervisão">
      <Box sx={{ display: "flex", gap: 0.5, mb: 3, borderBottom: "1px solid #E7E5E4", overflowX: "auto" }}>
        {TABS.map((t) => (
          <Box
            key={t.key} onClick={() => setTab(t.key)}
            sx={{
              px: 2, py: 1.2, cursor: "pointer", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap",
              color: tab === t.key ? "#1C1917" : "#A8A29E",
              borderBottom: tab === t.key ? "2px solid #1C1917" : "2px solid transparent",
            }}
          >
            {t.label}
          </Box>
        ))}
      </Box>

      {tab === "orders" && <OrdersTab />}
      {tab === "live" && <LiveMapTab />}
      {tab === "team" && <MyTeam myId={profile.id} />}
      {tab === "assignments" && <AssignmentsTab />}
      {tab === "messages" && <MessagesTab />}
    </AppShell>
  );
}
