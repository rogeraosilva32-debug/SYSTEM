import { useState, useEffect } from "react";
import { Box, Typography, CircularProgress, Chip, Alert } from "@mui/material";
import AppShell from "../components/AppShell";
import CollaboratorNav from "../components/CollaboratorNav";
import { Stat, PeriodPicker } from "../components/ReportParts";
import supabase from "../services/supabase";
import { useAuth } from "../context/AuthContext";
import { money } from "../utils/delivery";
import { periodRange, formatDate, km, loadError } from "../utils/reports";

// Ganhos do motoboy: prévia do período (mesmo cálculo do acerto) e
// acertos já fechados pela empresa.
export default function CourierEarnings() {
  const { profile } = useAuth();
  const [range, setRange] = useState(() => periodRange("7d"));
  const [preview, setPreview] = useState(null);
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");

  useEffect(() => {
    let alive = true; // período trocado antes de responder: ignora a resposta antiga
    supabase.rpc("preview_settlement", { p_courier: profile.id, p_from: range[0], p_to: range[1] })
      .then(({ data, error: err }) => { if (!alive) return; setError(err ? loadError(err) : ""); setPreview(err ? null : data); },
        (e) => { if (alive) setError(loadError(e)); });
    return () => { alive = false; };
  }, [profile.id, range]);

  useEffect(() => {
    supabase.from("settlements").select("*").eq("courier_id", profile.id).order("period_end", { ascending: false }).limit(50)
      .then(({ data, error: err }) => { setListError(err ? loadError(err) : ""); setList(data || []); },
        (e) => { setListError(loadError(e)); setList([]); });
  }, [profile.id]);

  return (
    <AppShell title="Meus ganhos">
      <CollaboratorNav />
      <PeriodPicker value={range} onChange={setRange} />
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {listError && <Alert severity="error" sx={{ mb: 2 }}>{listError}</Alert>}
      {error ? null : !preview ? <Box sx={{ py: 6, textAlign: "center" }}><CircularProgress size={24} /></Box> : (
        <>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" }, gap: 1.5, mb: 1 }}>
            <Stat label="Previsto no período" value={money(preview.total)} tone="good" />
            <Stat label={`Diárias (${preview.days_worked} dia(s))`} value={money(preview.daily_total)} />
            <Stat label={`Entregas (${preview.deliveries})`} value={money(preview.delivery_total)} />
            <Stat label={`Km (${km(preview.km)})`} value={money(preview.km_total)} />
          </Box>
          <Typography sx={{ fontSize: 12, color: "#A8A29E", mb: 3 }}>
            Diária conta cada dia com entrega feita. Prévia calculada com os valores da empresa. O valor final é o do acerto que a empresa fecha.
            Dinheiro de clientes com você no período: {money(preview.cash_collected)}.
          </Typography>
        </>
      )}

      <Typography sx={{ fontWeight: 800, mb: 1 }}>Acertos</Typography>
      {list === null ? <CircularProgress size={20} /> : list.length === 0 ? (
        <Typography sx={{ fontSize: 13, color: "#A8A29E" }}>Nenhum acerto fechado ainda.</Typography>
      ) : list.map((s) => (
        <Box key={s.id} sx={{ p: 1.5, mb: 1, border: "1px solid #E7E5E4", borderRadius: "12px", background: "#fff",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1 }}>
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: 14 }}>{formatDate(s.period_start)} a {formatDate(s.period_end)}</Typography>
            <Typography sx={{ fontSize: 12, color: "#78716C" }}>
              {s.deliveries} entrega(s) · {km(s.km)} · {s.days_worked} diária(s)
              {Number(s.adjustment) ? ` · ajuste ${money(s.adjustment)}${s.adjustment_note ? ` (${s.adjustment_note})` : ""}` : ""}
            </Typography>
          </Box>
          <Box sx={{ textAlign: "right" }}>
            <Typography sx={{ fontWeight: 800 }}>{money(s.total)}</Typography>
            {s.status === "paid"
              ? <Chip size="small" color="success" variant="outlined" label="Pago" />
              : <Chip size="small" color="warning" variant="outlined" label="A receber" />}
          </Box>
        </Box>
      ))}
    </AppShell>
  );
}
