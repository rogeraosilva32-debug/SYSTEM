import { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, Button, TextField, Dialog, DialogTitle, DialogContent, DialogActions, Switch,
  FormControlLabel, Alert, CircularProgress, MenuItem,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import supabase from "../../services/supabase";
import { money } from "../../utils/delivery";

const toNumber = (v) => Number(String(v).replace(",", "."));
const EMPTY = { name: "", monthly_price: "0", seats_limit: "5", max_orders_month: "", feature_branding: false, feature_delivery_code: false, active: true };

function PlanDialog({ plan, onClose, onSaved }) {
  const [form, setForm] = useState(plan ? {
    ...plan, monthly_price: String(plan.monthly_price).replace(".", ","), seats_limit: String(plan.seats_limit),
    max_orders_month: plan.max_orders_month ? String(plan.max_orders_month) : "",
  } : EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const save = async () => {
    const row = {
      name: form.name.trim(), monthly_price: toNumber(form.monthly_price), seats_limit: Math.round(toNumber(form.seats_limit)),
      max_orders_month: form.max_orders_month === "" ? null : Math.round(toNumber(form.max_orders_month)),
      feature_branding: form.feature_branding, feature_delivery_code: form.feature_delivery_code, active: form.active,
    };
    if (!row.name) { setError("Dê um nome ao plano."); return; }
    if (!(row.monthly_price >= 0) || !(row.seats_limit >= 0) || (row.max_orders_month !== null && !(row.max_orders_month > 0))) {
      setError("Confira os números: mensalidade, vagas e pedidos por mês."); return;
    }
    setSaving(true); setError("");
    const q = plan ? supabase.from("plans").update(row).eq("id", plan.id) : supabase.from("plans").insert(row);
    const { error: err } = await q;
    setSaving(false);
    if (err) { setError(/duplicate|unique/i.test(err.message) ? "Já existe um plano com esse nome." : err.message); return; }
    onSaved();
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>{plan ? "Editar plano" : "Novo plano"}</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField label="Nome do plano" value={form.name} onChange={set("name")} fullWidth autoFocus />
        <Box sx={{ display: "flex", gap: 1.5 }}>
          <TextField label="Mensalidade (R$)" value={form.monthly_price} onChange={set("monthly_price")} fullWidth inputMode="decimal" />
          <TextField label="Vagas de colaborador" value={form.seats_limit} onChange={set("seats_limit")} fullWidth inputMode="numeric" />
        </Box>
        <TextField label="Pedidos por mês" value={form.max_orders_month} onChange={set("max_orders_month")} fullWidth inputMode="numeric"
          helperText="Deixe vazio para não ter limite. No limite, a loja não consegue criar pedido novo até o mês virar." />
        <FormControlLabel control={<Switch checked={form.feature_delivery_code} onChange={set("feature_delivery_code")} />} label="Código de finalização de entrega" />
        <FormControlLabel control={<Switch checked={form.feature_branding} onChange={set("feature_branding")} />} label="Marca própria" />
        <FormControlLabel control={<Switch checked={form.active} onChange={set("active")} />} label="Disponível para novas empresas" />
        {plan && <Typography sx={{ fontSize: 12.5, color: "#78716C" }}>Ao salvar, as empresas neste plano passam a ter estas vagas, recursos e mensalidade.</Typography>}
      </DialogContent>
      <DialogActions sx={{ p: 2.5, pt: 0 }}>
        <Button onClick={onClose} sx={{ color: "#78716C" }}>Cancelar</Button>
        <Button onClick={save} disabled={saving} variant="contained">{saving ? <CircularProgress size={18} sx={{ color: "#fff" }} /> : "Salvar plano"}</Button>
      </DialogActions>
    </Dialog>
  );
}

// Planos: pacotes de vagas, recursos e preço. A empresa no plano acompanha
// qualquer mudança nele, e a cobrança mensal usa a mensalidade do plano.
export default function PlatformPlans() {
  const [plans, setPlans] = useState(null);
  const [counts, setCounts] = useState({});
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [p, c] = await Promise.all([
      supabase.from("plans").select("*").order("monthly_price"),
      supabase.from("companies").select("plan_id"),
    ]);
    if (p.error) {
      setError(/Could not find|does not exist/i.test(p.error.message)
        ? "O banco ainda não tem planos. Rode o supabase-b2b-schema.sql atualizado no Supabase." : p.error.message);
      setPlans([]);
      return;
    }
    setPlans(p.data || []);
    const n = {};
    (c.data || []).forEach((r) => { if (r.plan_id) n[r.plan_id] = (n[r.plan_id] || 0) + 1; });
    setCounts(n);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const remove = async (plan) => {
    if (!window.confirm(`Apagar o plano ${plan.name}? As empresas nele ficam sem plano (mantêm vagas e mensalidade atuais).`)) return;
    const { error: err } = await supabase.from("plans").delete().eq("id", plan.id);
    if (err) setError(err.message); else load();
  };

  if (plans === null) return <Box sx={{ py: 8, textAlign: "center" }}><CircularProgress size={26} /></Box>;

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, mb: 2, flexWrap: "wrap" }}>
        <Typography sx={{ fontSize: 13, color: "#78716C", maxWidth: 560 }}>
          Cada plano define vagas, recursos, limite de pedidos e mensalidade. Escolha o plano na página da empresa; as faturas usam a mensalidade dele.
        </Typography>
        <Button startIcon={<AddIcon />} variant="contained" onClick={() => setEditing({})}>Novo plano</Button>
      </Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>{error}</Alert>}
      {plans.length === 0 && !error && <Typography sx={{ fontSize: 13, color: "#A8A29E", py: 3 }}>Nenhum plano ainda.</Typography>}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "1fr 1fr 1fr" }, gap: 2 }}>
        {plans.map((p) => (
          <Box key={p.id} data-testid="plano" sx={{ border: "1px solid #E7E5E4", borderRadius: "16px", p: 2.5, background: "#fff", opacity: p.active ? 1 : 0.6 }}>
            <Typography sx={{ fontWeight: 800, fontSize: 16 }}>{p.name}{!p.active && " (fora de venda)"}</Typography>
            <Typography sx={{ fontWeight: 900, fontSize: 22, mt: 0.5 }}>{money(p.monthly_price)}<Box component="span" sx={{ fontSize: 13, fontWeight: 600, color: "#78716C" }}>/mês</Box></Typography>
            <Box component="ul" sx={{ pl: 2.2, my: 1.5, fontSize: 13, color: "#44403C", "& li": { mb: 0.3 } }}>
              <li>{p.seats_limit} vagas de colaborador</li>
              <li>{p.max_orders_month ? `até ${p.max_orders_month} pedidos por mês` : "pedidos sem limite"}</li>
              <li>código de entrega: {p.feature_delivery_code ? "sim" : "não"}</li>
              <li>marca própria: {p.feature_branding ? "sim" : "não"}</li>
            </Box>
            <Typography sx={{ fontSize: 12.5, color: "#78716C", mb: 1 }}>{counts[p.id] || 0} empresa(s) neste plano</Typography>
            <Box sx={{ display: "flex", gap: 1 }}>
              <Button size="small" variant="outlined" onClick={() => setEditing(p)}>Editar</Button>
              <Button size="small" onClick={() => remove(p)} sx={{ color: "#B0463D" }}>Apagar</Button>
            </Box>
          </Box>
        ))}
      </Box>
      {editing && <PlanDialog plan={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </Box>
  );
}

// Escolha do plano na página da empresa.
export function PlanPicker({ company, onApplied, disabled }) {
  const [plans, setPlans] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    supabase.from("plans").select("id, name, monthly_price, active").order("monthly_price")
      .then(({ data }) => { if (!cancelled) setPlans(data || []); });
    return () => { cancelled = true; };
  }, []);

  const apply = async (planId) => {
    const plan = plans.find((p) => p.id === planId);
    if (plan && !window.confirm(`Colocar ${company.name} no plano ${plan.name}? Vagas, recursos e mensalidade passam a ser os do plano.`)) return;
    setBusy(true); setError("");
    const { error: err } = await supabase.rpc("apply_plan", { p_company: company.id, p_plan: planId || null });
    if (err) { setError(err.message); setBusy(false); return; }
    const { data } = await supabase.from("companies").select("*, plan:plan_id(name)").eq("id", company.id).single();
    setBusy(false);
    if (data) onApplied(data);
  };

  if (!plans) return null;
  return (
    <Box sx={{ mb: 2 }}>
      <TextField select size="small" label="Plano" value={company.plan_id || ""} onChange={(e) => apply(e.target.value)}
        disabled={disabled || busy} sx={{ minWidth: 260 }}
        helperText={plans.length ? "Muda vagas, recursos e mensalidade de uma vez." : "Crie planos no menu Planos."}>
        <MenuItem value="">Sem plano (ajuste manual)</MenuItem>
        {plans.filter((p) => p.active || p.id === company.plan_id).map((p) => (
          <MenuItem key={p.id} value={p.id}>{p.name} · {money(p.monthly_price)}/mês</MenuItem>
        ))}
      </TextField>
      {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
    </Box>
  );
}
