import { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, Button, TextField, CircularProgress, Alert, Chip, Checkbox, MenuItem, IconButton,
  Table, TableHead, TableRow, TableCell, TableBody,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import supabase from "../../services/supabase";
import { useAuth } from "../../context/AuthContext";
import { money, PAYMENT_LABEL } from "../../utils/delivery";
import { today, periodRange, formatDate, km, downloadCsv, CASH_KIND } from "../../utils/reports";
import { Stat, StatGrid, Section, BarList } from "../../components/ReportParts";

const SUBTABS = [
  { key: "cash", label: "Caixa do dia" },
  { key: "settlements", label: "Acertos dos motoboys" },
  { key: "rates", label: "Valores do motoboy" },
  { key: "shifts", label: "Turnos" },
  { key: "license", label: "Licença" },
];

const num = (v) => Number(String(v ?? "").replace(",", ".")) || 0;
const time = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dateTime = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

function useCouriers(companyId) {
  const [couriers, setCouriers] = useState([]);
  useEffect(() => {
    supabase.from("profiles").select("id, name").eq("company_id", companyId).eq("company_role", "collaborator").order("name")
      .then(({ data }) => setCouriers(data || []));
  }, [companyId]);
  return couriers;
}

// ---------------------------------------------------------------------
// Caixa do dia: vendas por forma de pagamento, conferência do dinheiro
// trazido pelos motoboys e movimentos (abertura, sangria, reforço, despesa).
// ---------------------------------------------------------------------
function CashDay({ companyId }) {
  const [day, setDay] = useState(today());
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState([]);
  const [kind, setKind] = useState("opening");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data: d, error: err } = await supabase.rpc("report_cash_day", { p_day: day });
    if (err) { setError(err.message); return; }
    setData(d);
    setSelected([]);
  }, [day]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const addMovement = async () => {
    setError("");
    if (num(amount) <= 0) { setError("Informe um valor."); return; }
    const { error: err } = await supabase.from("cash_movements").insert({ company_id: companyId, kind, amount: num(amount), note: note.trim() || null });
    if (err) { setError(err.message); return; }
    setAmount(""); setNote("");
    load();
  };

  const removeMovement = async (id) => {
    await supabase.from("cash_movements").delete().eq("id", id);
    load();
  };

  const confirm = async (ids, received = true) => {
    const { error: err } = await supabase.rpc("confirm_payments", { p_order_ids: ids, p_received: received });
    if (err) { setError(err.message); return; }
    load();
  };

  if (!data) return <Box sx={{ py: 8, textAlign: "center" }}>{error ? <Alert severity="error">{error}</Alert> : <CircularProgress size={26} />}</Box>;

  const isToday = day === today();
  const expected = Number(data.opening) + Number(data.cash_received) + Number(data.deposits) - Number(data.withdrawals) - Number(data.expenses);
  const pending = data.cash_orders.filter((o) => !o.payment_received);

  return (
    <Box>
      <Box sx={{ display: "flex", gap: 1, alignItems: "center", mb: 2, flexWrap: "wrap" }}>
        <TextField size="small" type="date" label="Dia" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} InputLabelProps={{ shrink: true }} />
        {!isToday && <Button size="small" onClick={() => setDay(today())}>Hoje</Button>}
      </Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>{error}</Alert>}

      <StatGrid>
        <Stat label="Vendas entregues" value={money(data.revenue)} />
        <Stat label="Em dinheiro" value={money(data.cash_sales)} hint={`${money(data.cash_received)} já conferido`} />
        <Stat label="Dinheiro a conferir" value={money(Number(data.cash_sales) - Number(data.cash_received))}
          tone={Number(data.cash_sales) > Number(data.cash_received) ? "warn" : "good"} />
        <Stat label="Dinheiro esperado no caixa" value={money(expected)}
          hint="Abertura + dinheiro conferido + reforços − sangrias − despesas" />
      </StatGrid>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2.5 }}>
        <Section title="Vendas por forma de pagamento">
          <BarList rows={data.by_payment.map((r) => ({ label: PAYMENT_LABEL[r.key] || "Não informado", value: r.total, extra: `${r.count}` }))} format={money}
            empty="Nenhuma entrega neste dia." />
        </Section>

        <Section title="Movimentos do caixa">
          {isToday && (
            <Box sx={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 1, mb: 1.5 }}>
              <TextField select size="small" label="Tipo" value={kind} onChange={(e) => setKind(e.target.value)}>
                {Object.entries(CASH_KIND).map(([k, v]) => <MenuItem key={k} value={k}>{v.label}</MenuItem>)}
              </TextField>
              <TextField size="small" label="Valor (R$)" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
              <TextField size="small" label="Observação" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button variant="contained" onClick={addMovement}>Lançar</Button>
            </Box>
          )}
          {data.movements.length === 0 && <Typography sx={{ fontSize: 13, color: "#A8A29E" }}>Nenhum movimento.</Typography>}
          {data.movements.map((m) => (
            <Box key={m.id} sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.6, borderTop: "1px solid #F5F5F4" }}>
              <Typography sx={{ fontSize: 12, color: "#A8A29E", width: 44 }}>{time(m.created_at)}</Typography>
              <Typography sx={{ flex: 1, fontSize: 13 }}>
                <b>{CASH_KIND[m.kind].label}</b>{m.note ? ` · ${m.note}` : ""}
              </Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: CASH_KIND[m.kind].sign < 0 ? "#B0463D" : "#4B7A5E" }}>
                {CASH_KIND[m.kind].sign < 0 ? "−" : "+"} {money(m.amount)}
              </Typography>
              {isToday && <IconButton size="small" onClick={() => removeMovement(m.id)}><DeleteOutlineIcon fontSize="small" /></IconButton>}
            </Box>
          ))}
        </Section>
      </Box>

      <Section
        title="Conferência do dinheiro dos motoboys"
        actions={selected.length > 0 && (
          <Button size="small" variant="contained" onClick={() => confirm(selected)}>Conferir {selected.length} selecionado(s)</Button>
        )}
        onExport={() => downloadCsv(`dinheiro_${day}.csv`, [
          { label: "Pedido", value: (o) => o.number }, { label: "Cliente", value: (o) => o.customer_name },
          { label: "Motoboy", value: (o) => o.courier }, { label: "Total", value: (o) => Number(o.total) },
          { label: "Troco para", value: (o) => (o.change_for ? Number(o.change_for) : "") },
          { label: "Conferido", value: (o) => (o.payment_received ? "sim" : "não") },
        ], data.cash_orders)}
      >
        <Typography sx={{ fontSize: 12.5, color: "#78716C", mb: 1 }}>
          Pedidos pagos em dinheiro entregues no dia. Marque quando o motoboy entregar o valor no caixa.
        </Typography>
        {data.cash_orders.length === 0 && <Typography sx={{ fontSize: 13, color: "#A8A29E" }}>Nenhum pedido em dinheiro.</Typography>}
        {data.cash_orders.length > 0 && (
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox size="small" checked={pending.length > 0 && selected.length === pending.length}
                      indeterminate={selected.length > 0 && selected.length < pending.length}
                      onChange={(e) => setSelected(e.target.checked ? pending.map((o) => o.id) : [])} />
                  </TableCell>
                  <TableCell>Pedido</TableCell><TableCell>Motoboy</TableCell><TableCell>Entregue</TableCell>
                  <TableCell align="right">Total</TableCell><TableCell align="right">Troco para</TableCell><TableCell>Situação</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.cash_orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell padding="checkbox">
                      {!o.payment_received && (
                        <Checkbox size="small" checked={selected.includes(o.id)}
                          onChange={(e) => setSelected((s) => (e.target.checked ? [...s, o.id] : s.filter((x) => x !== o.id)))} />
                      )}
                    </TableCell>
                    <TableCell>#{o.number} · {o.customer_name}</TableCell>
                    <TableCell>{o.courier || "—"}</TableCell>
                    <TableCell>{time(o.delivered_at)}</TableCell>
                    <TableCell align="right">{money(o.total)}</TableCell>
                    <TableCell align="right">{o.change_for ? `${money(o.change_for)} (troco ${money(o.change_for - o.total)})` : "—"}</TableCell>
                    <TableCell>
                      {o.payment_received
                        ? <Chip size="small" color="success" variant="outlined" label="Conferido" onDelete={() => confirm([o.id], false)} />
                        : <Chip size="small" color="warning" variant="outlined" label="A conferir" />}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Section>
    </Box>
  );
}

// ---------------------------------------------------------------------
// Acertos: prévia calculada no banco, gravação, baixa e exclusão.
// ---------------------------------------------------------------------
function Settlements({ companyId }) {
  const couriers = useCouriers(companyId);
  const [courier, setCourier] = useState("");
  const [range, setRange] = useState(() => periodRange("7d"));
  const [preview, setPreview] = useState(null);
  const [adjustment, setAdjustment] = useState("");
  const [note, setNote] = useState("");
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.from("settlements").select("*, courier:courier_id(name)")
      .eq("company_id", companyId).order("period_end", { ascending: false }).limit(100);
    setList(data || []);
  }, [companyId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const doPreview = async () => {
    setError(""); setPreview(null);
    if (!courier) { setError("Escolha o motoboy."); return; }
    const { data, error: err } = await supabase.rpc("preview_settlement", { p_courier: courier, p_from: range[0], p_to: range[1] });
    if (err) { setError(err.message); return; }
    setPreview(data);
  };

  const create = async () => {
    setError("");
    const { error: err } = await supabase.rpc("create_settlement", {
      p_courier: courier, p_from: range[0], p_to: range[1], p_adjustment: num(adjustment), p_note: note,
    });
    if (err) { setError(err.message); return; }
    setPreview(null); setAdjustment(""); setNote("");
    setSaved("Acerto gravado."); setTimeout(() => setSaved(""), 2500);
    load();
  };

  const act = async (fn, id) => {
    setError("");
    const { error: err } = await supabase.rpc(fn, { p_id: id });
    if (err) { setError(err.message); return; }
    load();
  };

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>{error}</Alert>}
      {saved && <Alert severity="success" sx={{ mb: 2 }}>{saved}</Alert>}

      <Section title="Novo acerto">
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1.5fr 1fr 1fr auto" }, gap: 1, mb: 1.5 }}>
          <TextField select size="small" label="Motoboy" value={courier} onChange={(e) => { setCourier(e.target.value); setPreview(null); }}>
            {couriers.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
          </TextField>
          <TextField size="small" type="date" label="De" value={range[0]} InputLabelProps={{ shrink: true }}
            onChange={(e) => { setRange([e.target.value, range[1]]); setPreview(null); }} />
          <TextField size="small" type="date" label="Até" value={range[1]} InputLabelProps={{ shrink: true }}
            onChange={(e) => { setRange([range[0], e.target.value]); setPreview(null); }} />
          <Button variant="outlined" onClick={doPreview}>Calcular</Button>
        </Box>
        {preview && (
          <Box>
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" }, gap: 1, mb: 1.5 }}>
              <Stat label={`Diárias: ${preview.days_worked} dia(s) × ${money(preview.daily_rate)}`} value={money(preview.daily_total)} />
              <Stat label={`Entregas: ${preview.deliveries} × ${money(preview.per_delivery)}`} value={money(preview.delivery_total)} />
              <Stat label={`Km: ${km(preview.km)} × ${money(preview.per_km)}`} value={money(preview.km_total)} />
            </Box>
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 2fr auto" }, gap: 1, alignItems: "center" }}>
              <TextField size="small" label="Ajuste (R$, use − para desconto)" value={adjustment} onChange={(e) => setAdjustment(e.target.value)} />
              <TextField size="small" label="Motivo do ajuste" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button variant="contained" onClick={create}>Gravar acerto de {money(Number(preview.total) + num(adjustment))}</Button>
            </Box>
            <Typography sx={{ fontSize: 12.5, color: "#78716C", mt: 1 }}>
              Dinheiro de clientes recebido por ele no período: <b>{money(preview.cash_collected)}</b> (confira no Caixa do dia).
            </Typography>
          </Box>
        )}
      </Section>

      <Section title="Acertos" onExport={() => downloadCsv("acertos.csv", [
        { label: "Motoboy", value: (s) => s.courier?.name }, { label: "De", value: (s) => formatDate(s.period_start) },
        { label: "Até", value: (s) => formatDate(s.period_end) }, { label: "Dias", value: (s) => s.days_worked },
        { label: "Entregas", value: (s) => s.deliveries }, { label: "Km", value: (s) => Number(s.km) },
        { label: "Diárias", value: (s) => Number(s.daily_total) }, { label: "Por entrega", value: (s) => Number(s.delivery_total) },
        { label: "Por km", value: (s) => Number(s.km_total) }, { label: "Ajuste", value: (s) => Number(s.adjustment) },
        { label: "Motivo", value: (s) => s.adjustment_note }, { label: "Total", value: (s) => Number(s.total) },
        { label: "Situação", value: (s) => (s.status === "paid" ? "pago" : "em aberto") },
      ], list || [])}>
        {list === null ? <CircularProgress size={20} /> : list.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: "#A8A29E" }}>Nenhum acerto gravado.</Typography>
        ) : (
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Motoboy</TableCell><TableCell>Período</TableCell><TableCell align="right">Entregas</TableCell>
                  <TableCell align="right">Km</TableCell><TableCell align="right">Total</TableCell><TableCell>Situação</TableCell><TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {list.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell sx={{ fontWeight: 600 }}>{s.courier?.name}</TableCell>
                    <TableCell>{formatDate(s.period_start)} a {formatDate(s.period_end)}</TableCell>
                    <TableCell align="right">{s.deliveries}</TableCell>
                    <TableCell align="right">{km(s.km)}</TableCell>
                    <TableCell align="right" title={s.adjustment_note || ""}>
                      {money(s.total)}{Number(s.adjustment) ? <Typography component="span" sx={{ fontSize: 11, color: "#A8A29E" }}> (ajuste {money(s.adjustment)})</Typography> : null}
                    </TableCell>
                    <TableCell>
                      {s.status === "paid"
                        ? <Chip size="small" color="success" variant="outlined" label={`Pago ${formatDate(s.paid_at)}`} />
                        : <Chip size="small" color="warning" variant="outlined" label="Em aberto" />}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                      {s.status === "open" && (
                        <>
                          <Button size="small" onClick={() => act("pay_settlement", s.id)}>Marcar pago</Button>
                          <IconButton size="small" onClick={() => act("delete_settlement", s.id)}><DeleteOutlineIcon fontSize="small" /></IconButton>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Section>
    </Box>
  );
}

// ---------------------------------------------------------------------
// Valores: padrão da empresa e valor próprio de cada motoboy.
// ---------------------------------------------------------------------
function Rates({ companyId }) {
  const couriers = useCouriers(companyId);
  const [company, setCompany] = useState(null);
  const [form, setForm] = useState({ courier_daily_rate: "", courier_per_delivery: "", courier_per_km: "" });
  const [rates, setRates] = useState({});
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    const [c, r] = await Promise.all([
      supabase.from("companies").select("courier_daily_rate, courier_per_delivery, courier_per_km").eq("id", companyId).maybeSingle(),
      supabase.from("courier_rates").select("*").eq("company_id", companyId),
    ]);
    setCompany(c.data);
    if (c.data) setForm({
      courier_daily_rate: c.data.courier_daily_rate, courier_per_delivery: c.data.courier_per_delivery, courier_per_km: c.data.courier_per_km,
    });
    setRates(Object.fromEntries((r.data || []).map((x) => [x.courier_id, x])));
  }, [companyId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const saveDefaults = async () => {
    const { error } = await supabase.from("companies").update({
      courier_daily_rate: num(form.courier_daily_rate), courier_per_delivery: num(form.courier_per_delivery), courier_per_km: num(form.courier_per_km),
    }).eq("id", companyId);
    setMsg(error ? { type: "error", text: error.message } : { type: "success", text: "Valores padrão salvos." });
    load();
  };

  const saveCourier = async (id, patch) => {
    const current = rates[id] || {};
    const row = { courier_id: id, company_id: companyId, daily_rate: current.daily_rate ?? null, per_delivery: current.per_delivery ?? null, per_km: current.per_km ?? null, ...patch, updated_at: new Date().toISOString() };
    const { error } = await supabase.from("courier_rates").upsert(row);
    if (error) setMsg({ type: "error", text: error.message });
    load();
  };

  if (!company) return <Box sx={{ py: 8, textAlign: "center" }}><CircularProgress size={26} /></Box>;

  const field = (value) => (value === null || value === undefined ? "" : String(value));
  const parseOrNull = (v) => (String(v).trim() === "" ? null : num(v));

  return (
    <Box sx={{ maxWidth: 860 }}>
      {msg && <Alert severity={msg.type} sx={{ mb: 2 }} onClose={() => setMsg(null)}>{msg.text}</Alert>}
      <Section title="Valores padrão da empresa">
        <Typography sx={{ fontSize: 12.5, color: "#78716C", mb: 1.5 }}>
          Usados no acerto de todos os motoboys, a não ser que o motoboy tenha valor próprio abaixo. Deixe 0 no que não paga.
        </Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr 1fr auto" }, gap: 1 }}>
          <TextField size="small" label="Diária (R$)" value={form.courier_daily_rate} onChange={(e) => setForm({ ...form, courier_daily_rate: e.target.value })} />
          <TextField size="small" label="Por entrega (R$)" value={form.courier_per_delivery} onChange={(e) => setForm({ ...form, courier_per_delivery: e.target.value })} />
          <TextField size="small" label="Por km (R$)" value={form.courier_per_km} onChange={(e) => setForm({ ...form, courier_per_km: e.target.value })} />
          <Button variant="contained" onClick={saveDefaults}>Salvar</Button>
        </Box>
      </Section>

      <Section title="Valor próprio por motoboy">
        <Typography sx={{ fontSize: 12.5, color: "#78716C", mb: 1.5 }}>Em branco = usa o padrão. Salva ao sair do campo.</Typography>
        {couriers.length === 0 && <Typography sx={{ fontSize: 13, color: "#A8A29E" }}>Nenhum motoboy cadastrado.</Typography>}
        {couriers.map((c) => {
          const r = rates[c.id] || {};
          return (
            <Box key={`${c.id}-${r.updated_at || ""}`} sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr 1fr", sm: "1.5fr 1fr 1fr 1fr" }, gap: 1, py: 1, borderTop: "1px solid #F5F5F4", alignItems: "center" }}>
              <Typography sx={{ fontWeight: 700, fontSize: 13.5, gridColumn: { xs: "1 / -1", sm: "auto" } }}>{c.name}</Typography>
              {[["daily_rate", "Diária"], ["per_delivery", "Por entrega"], ["per_km", "Por km"]].map(([k, label]) => (
                <TextField key={k} size="small" label={label} defaultValue={field(r[k])}
                  placeholder={money(company[{ daily_rate: "courier_daily_rate", per_delivery: "courier_per_delivery", per_km: "courier_per_km" }[k]])}
                  InputLabelProps={{ shrink: true }}
                  onBlur={(e) => { const v = parseOrNull(e.target.value); if (v !== (r[k] == null ? null : Number(r[k]))) saveCourier(c.id, { [k]: v }); }} />
              ))}
            </Box>
          );
        })}
      </Section>
    </Box>
  );
}

// ---------------------------------------------------------------------
// Turnos: histórico e encerramento de turno esquecido aberto.
// ---------------------------------------------------------------------
function Shifts({ companyId }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.from("courier_shifts").select("*, courier:courier_id(name)")
      .eq("company_id", companyId).order("started_at", { ascending: false }).limit(100);
    setList(data || []);
  }, [companyId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const close = async (id) => {
    const { error: err } = await supabase.rpc("end_shift", { p_shift: id });
    if (err) { setError(err.message); return; }
    load();
  };

  const hours = (s) => {
    const ms = (s.ended_at ? new Date(s.ended_at) : new Date()) - new Date(s.started_at);
    return `${Math.floor(ms / 3600000)} h ${Math.round((ms % 3600000) / 60000)} min`;
  };

  return (
    <Section title="Turnos dos motoboys" onExport={() => downloadCsv("turnos.csv", [
      { label: "Motoboy", value: (s) => s.courier?.name }, { label: "Início", value: (s) => dateTime(s.started_at) },
      { label: "Fim", value: (s) => dateTime(s.ended_at) }, { label: "Duração", value: hours },
      { label: "Km", value: (s) => (s.km === null ? "" : Number(s.km)) },
    ], list || [])}>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Typography sx={{ fontSize: 12.5, color: "#78716C", mb: 1 }}>O motoboy inicia e encerra o turno na tela de entregas. Cada dia com turno conta uma diária.</Typography>
      {list === null ? <CircularProgress size={20} /> : list.length === 0 ? (
        <Typography sx={{ fontSize: 13, color: "#A8A29E" }}>Nenhum turno registrado.</Typography>
      ) : (
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead><TableRow><TableCell>Motoboy</TableCell><TableCell>Início</TableCell><TableCell>Fim</TableCell><TableCell>Duração</TableCell><TableCell align="right">Km</TableCell><TableCell /></TableRow></TableHead>
            <TableBody>
              {list.map((s) => (
                <TableRow key={s.id}>
                  <TableCell sx={{ fontWeight: 600 }}>{s.courier?.name}</TableCell>
                  <TableCell>{dateTime(s.started_at)}</TableCell>
                  <TableCell>{s.ended_at ? dateTime(s.ended_at) : <Chip size="small" color="primary" label="Aberto" />}</TableCell>
                  <TableCell>{hours(s)}</TableCell>
                  <TableCell align="right">{s.km === null ? "—" : km(s.km)}</TableCell>
                  <TableCell align="right">{!s.ended_at && <Button size="small" onClick={() => close(s.id)}>Encerrar</Button>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------
// Licença: faturas que a plataforma emitiu para esta empresa.
// ---------------------------------------------------------------------
function License({ companyId }) {
  const [list, setList] = useState(null);
  useEffect(() => {
    supabase.from("license_invoices").select("*").eq("company_id", companyId).order("reference_month", { ascending: false })
      .then(({ data }) => setList(data || []));
  }, [companyId]);

  const statusChip = (i) => {
    if (i.status === "paid") return <Chip size="small" color="success" variant="outlined" label={`Paga ${formatDate(i.paid_at)}`} />;
    if (i.status === "cancelled") return <Chip size="small" variant="outlined" label="Cancelada" />;
    if (i.due_date < today()) return <Chip size="small" color="error" variant="outlined" label="Vencida" />;
    return <Chip size="small" color="warning" variant="outlined" label="A pagar" />;
  };

  return (
    <Section title="Faturas da licença">
      {list === null ? <CircularProgress size={20} /> : list.length === 0 ? (
        <Typography sx={{ fontSize: 13, color: "#A8A29E" }}>Nenhuma fatura emitida.</Typography>
      ) : (
        <Table size="small">
          <TableHead><TableRow><TableCell>Mês</TableCell><TableCell>Vencimento</TableCell><TableCell align="right">Valor</TableCell><TableCell>Situação</TableCell></TableRow></TableHead>
          <TableBody>
            {list.map((i) => (
              <TableRow key={i.id}>
                <TableCell>{formatDate(i.reference_month).slice(3)}</TableCell>
                <TableCell>{formatDate(i.due_date)}</TableCell>
                <TableCell align="right">{money(i.amount)}</TableCell>
                <TableCell>{statusChip(i)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Typography sx={{ fontSize: 12, color: "#A8A29E", mt: 1 }}>Fatura vencida além da carência suspende o acesso da empresa. Dúvidas: fale com a plataforma.</Typography>
    </Section>
  );
}

export function FinanceTab() {
  const { companyId } = useAuth();
  const [sub, setSub] = useState("cash");
  return (
    <Box>
      <Box sx={{ display: "flex", gap: 1, mb: 2.5, flexWrap: "wrap" }}>
        {SUBTABS.map((t) => (
          <Chip key={t.key} label={t.label} onClick={() => setSub(t.key)}
            color={sub === t.key ? "primary" : "default"} variant={sub === t.key ? "filled" : "outlined"} />
        ))}
      </Box>
      {sub === "cash" && <CashDay companyId={companyId} />}
      {sub === "settlements" && <Settlements companyId={companyId} />}
      {sub === "rates" && <Rates companyId={companyId} />}
      {sub === "shifts" && <Shifts companyId={companyId} />}
      {sub === "license" && <License companyId={companyId} />}
    </Box>
  );
}
