import { useState, useEffect, useCallback } from "react";
import { Box, Typography, Button, Chip } from "@mui/material";
import supabase from "../../services/supabase";
import { Section } from "../../components/ReportParts";

const REFRESH_MS = 60000;

const KIND = {
  problem_orders: { label: "Pedido com problema", tone: "bad" },
  stuck_orders: { label: "Pedido parado", tone: "bad" },
  errors: { label: "Muitos erros", tone: "bad" },
  invoice_overdue: { label: "Fatura vencida", tone: "bad" },
  no_orders: { label: "Sem pedidos", tone: "warn" },
  seats_full: { label: "Vagas cheias", tone: "warn" },
  plan_orders: { label: "Limite do plano", tone: "warn" },
};
const TONE = { bad: "#B0463D", warn: "#B0793D", ok: "#4B7A5E" };

const since = (iso) => {
  const min = Math.max(0, Math.round((new Date().getTime() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `há ${min} min`;
  if (min < 48 * 60) return `há ${Math.round(min / 60)} h`;
  return `há ${Math.round(min / 1440)} dias`;
};

// Alertas automáticos: o banco confere todas as empresas a cada 10 minutos
// (e sempre que esta tela abre), abre o alerta quando algo sai do normal e
// fecha sozinho quando volta ao normal.
export default function PlatformAlerts({ onOpenCompany, onOpenLog, onCount }) {
  const [alerts, setAlerts] = useState(null);
  const [error, setError] = useState("");
  const [history, setHistory] = useState(false);

  const load = useCallback(async () => {
    await supabase.rpc("platform_check_alerts");
    const { data, error: err } = await supabase.rpc("platform_alerts_list", { p_include_resolved: history });
    if (err) {
      setError(/Could not find|does not exist/i.test(err.message)
        ? "O banco ainda não tem os alertas. Rode o supabase-b2b-schema.sql atualizado no Supabase."
        : err.message);
      setAlerts([]);
      return;
    }
    setError("");
    setAlerts(data || []);
    onCount?.((data || []).filter((a) => !a.resolved_at && !a.seen_at).length);
  }, [history, onCount]);

  useEffect(() => {
    load(); // eslint-disable-line react-hooks/set-state-in-effect
    const t = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const seen = async (e, id) => {
    e.stopPropagation();
    await supabase.rpc("platform_alert_seen", { p_id: id });
    load();
  };

  const open = (alerts || []).filter((a) => !a.resolved_at);
  const resolved = (alerts || []).filter((a) => a.resolved_at);

  return (
    <Section title={`Alertas${open.length ? ` (${open.length})` : ""}`} actions={
      <Box sx={{ display: "flex", gap: 1 }}>
        <Button size="small" onClick={() => setHistory((h) => !h)} sx={{ textTransform: "none", fontWeight: 700 }}>
          {history ? "Esconder resolvidos" : "Ver resolvidos"}
        </Button>
        <Button size="small" onClick={onOpenLog} sx={{ textTransform: "none", fontWeight: 700 }}>Abrir o log</Button>
      </Box>
    }>
      {error && <Typography sx={{ fontSize: 13, color: TONE.bad }}>{error}</Typography>}
      {alerts && !error && open.length === 0 && (
        <Typography sx={{ fontSize: 13, color: TONE.ok, fontWeight: 600 }}>Tudo certo por aqui. Nenhum alerta aberto.</Typography>
      )}
      {[...open, ...(history ? resolved : [])].map((a, i) => {
        const k = KIND[a.kind] || { label: a.kind, tone: "warn" };
        return (
          <Box key={a.id} data-testid="alerta" onClick={() => onOpenCompany(a.company_id)} sx={{
            display: "flex", alignItems: "center", gap: 1, py: 1, borderTop: i ? "1px solid #F5F5F4" : 0, cursor: "pointer",
            flexWrap: "wrap", opacity: a.resolved_at ? 0.55 : 1, "&:hover": { background: "#FAFAF9" },
          }}>
            <Box sx={{ width: 8, height: 8, borderRadius: "50%", background: a.resolved_at ? TONE.ok : TONE[k.tone], flexShrink: 0 }} />
            <Typography sx={{ fontSize: 13.5, fontWeight: 700 }}>{a.company_name}</Typography>
            <Chip label={k.label} size="small" sx={{ height: 20, fontSize: 10.5, fontWeight: 700 }} />
            <Typography sx={{ fontSize: 13, color: "#57534E", flex: 1, minWidth: 160 }}>{a.message}</Typography>
            <Typography sx={{ fontSize: 12, color: "#A8A29E" }}>
              {a.resolved_at ? `resolvido ${since(a.resolved_at)}` : `aberto ${since(a.opened_at)}`}
            </Typography>
            {!a.resolved_at && !a.seen_at && (
              <Button size="small" onClick={(e) => seen(e, a.id)} sx={{ textTransform: "none", fontWeight: 700, minWidth: 0 }}>Visto</Button>
            )}
          </Box>
        );
      })}
    </Section>
  );
}
