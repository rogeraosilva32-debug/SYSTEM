import { useState, useEffect, useCallback } from "react";
import { Box, Typography, CircularProgress, Alert, Button, Chip } from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import supabase from "../../services/supabase";
import { Stat, StatGrid, Section } from "../../components/ReportParts";
import { money } from "../../utils/delivery";

const REFRESH_MS = 60000;

const ago = (iso) => {
  if (!iso) return "nunca";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400e3);
  if (days <= 0) return "hoje";
  if (days === 1) return "ontem";
  return `há ${days} dias`;
};

// Primeira tela da plataforma: como estão todas as empresas agora, o que
// precisa de atenção (problemas, faturas vencidas, empresas paradas) e
// atalhos para a empresa ou para o log.
export default function PlatformOverview({ onOpenCompany, onOpenLog }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data: v, error: err } = await supabase.rpc("platform_overview");
    if (err) {
      setError(/Could not find|does not exist/i.test(err.message)
        ? "O banco ainda não tem a visão geral. Rode o supabase-b2b-schema.sql atualizado no Supabase."
        : err.message);
      setData(false);
      return;
    }
    setError("");
    setData(v);
  }, []);

  useEffect(() => {
    load(); // eslint-disable-line react-hooks/set-state-in-effect
    const t = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  if (data === null) return <Box sx={{ py: 8, textAlign: "center" }}><CircularProgress size={26} /></Box>;
  if (data === false) return <Alert severity="warning">{error}</Alert>;

  const t = data.today || {};
  const now = new Date(data.generated_at || 0).getTime();
  const companies = data.per_company || [];
  const attention = [
    ...companies.filter((c) => c.problems_now > 0).map((c) => ({ c, text: `${c.problems_now} pedido(s) com problema agora`, tone: "bad" })),
    ...companies.filter((c) => c.overdue_invoices > 0).map((c) => ({ c, text: `fatura vencida: ${money(c.overdue_amount)}`, tone: "bad" })),
    ...companies.filter((c) => c.status === "active" && c.seats_limit && c.seats_used >= c.seats_limit).map((c) => ({ c, text: `usando todas as ${c.seats_limit} vagas`, tone: "warn" })),
    ...companies.filter((c) => c.status === "active" && (!c.last_order_at || now - new Date(c.last_order_at).getTime() > 7 * 86400e3))
      .map((c) => ({ c, text: `sem pedidos ${c.last_order_at ? `desde ${ago(c.last_order_at)}` : "ainda"}`, tone: "warn" })),
  ];
  const log = data.log_24h || {};

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
        <Typography sx={{ fontSize: 13, color: "#78716C" }}>
          Hoje, todas as empresas · atualiza sozinho a cada minuto
        </Typography>
        <Button size="small" startIcon={<RefreshIcon />} onClick={load} sx={{ textTransform: "none", fontWeight: 700 }}>Atualizar</Button>
      </Box>

      <StatGrid>
        <Stat label="Pedidos hoje" value={t.orders ?? 0} hint={`${t.delivered ?? 0} entregues · ${t.cancelled ?? 0} cancelados`} />
        <Stat label="Faturamento das lojas hoje" value={money(t.revenue || 0)} hint="só pedidos entregues" />
        <Stat label="Em andamento agora" value={t.open_now ?? 0} hint={t.problems_now ? `${t.problems_now} com problema` : "nenhum com problema"} tone={t.problems_now ? "bad" : undefined} />
        <Stat label="Motoboys em expediente" value={t.couriers_on_shift ?? 0} />
        <Stat label="Empresas ativas" value={`${data.companies?.active ?? 0} de ${data.companies?.total ?? 0}`} hint={data.companies?.suspended ? `${data.companies.suspended} suspensa(s)` : "nenhuma suspensa"} />
        <Stat label="Faturas vencidas" value={money(data.billing?.overdue_amount || 0)} hint={`${data.billing?.overdue_companies ?? 0} empresa(s)`} tone={data.billing?.overdue_companies ? "bad" : "good"} />
        <Stat label="Erros nas últimas 24 h" value={log.errors ?? 0} hint={`${log.warnings ?? 0} avisos · ${log.failed_logins ?? 0} logins errados`} tone={log.errors ? "bad" : "good"} />
        <Stat label="Quedas de conexão (24 h)" value={log.offline_events ?? 0} hint="internet, servidor ou GPS" tone={log.offline_events ? "warn" : undefined} />
      </StatGrid>

      <Section title="Precisa de atenção" actions={<Button size="small" onClick={onOpenLog} sx={{ textTransform: "none", fontWeight: 700 }}>Abrir o log</Button>}>
        {attention.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: "#4B7A5E", fontWeight: 600 }}>Tudo certo por aqui.</Typography>
        ) : attention.map((a, i) => (
          <Box key={i} onClick={() => onOpenCompany(a.c.id)} sx={{
            display: "flex", alignItems: "center", gap: 1, py: 1, borderTop: i ? "1px solid #F5F5F4" : 0, cursor: "pointer",
            "&:hover": { background: "#FAFAF9" },
          }}>
            <Box sx={{ width: 8, height: 8, borderRadius: "50%", background: a.tone === "bad" ? "#B0463D" : "#B0793D", flexShrink: 0 }} />
            <Typography sx={{ fontSize: 13.5, fontWeight: 700 }}>{a.c.name}</Typography>
            <Typography sx={{ fontSize: 13, color: "#57534E" }}>{a.text}</Typography>
          </Box>
        ))}
      </Section>

      <Section title="Empresas hoje">
        <Box sx={{ overflowX: "auto" }}>
          <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 620,
            "& th": { textAlign: "left", fontSize: 11, color: "#78716C", fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4, pb: 1 },
            "& td": { py: 1, borderTop: "1px solid #F5F5F4" }, "& tbody tr": { cursor: "pointer" }, "& tbody tr:hover": { background: "#FAFAF9" } }}>
            <thead>
              <tr><th>Empresa</th><th>Pedidos</th><th>Entregues</th><th>Agora</th><th>Motoboys</th><th>Faturamento</th><th>Último pedido</th></tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id} onClick={() => onOpenCompany(c.id)}>
                  <td>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{c.name}</Typography>
                      {c.status !== "active" && <Chip label="Suspensa" size="small" sx={{ height: 20, fontSize: 10.5, background: "#F6EBEA", color: "#B0463D" }} />}
                    </Box>
                  </td>
                  <td>{c.orders_today}</td>
                  <td>{c.delivered_today}</td>
                  <td>{c.open_now}{c.problems_now ? <Box component="span" sx={{ color: "#B0463D", fontWeight: 700 }}> ({c.problems_now} problema)</Box> : null}</td>
                  <td>{c.couriers_on_shift}</td>
                  <td>{money(c.revenue_today)}</td>
                  <td style={{ color: "#78716C" }}>{ago(c.last_order_at)}</td>
                </tr>
              ))}
            </tbody>
          </Box>
        </Box>
      </Section>
    </Box>
  );
}
