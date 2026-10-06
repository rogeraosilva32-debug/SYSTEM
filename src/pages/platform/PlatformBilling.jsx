import { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, Button, TextField, CircularProgress, Alert, Chip, MenuItem,
  Table, TableHead, TableRow, TableCell, TableBody,
} from "@mui/material";
import CollapsibleSection from "../../components/CollapsibleSection";
import supabase from "../../services/supabase";
import { money } from "../../utils/delivery";
import { today, formatDate, downloadCsv } from "../../utils/reports";
import { Stat, StatGrid, Section } from "../../components/ReportParts";
import PageLoading from "../../components/PageLoading";

const dateTime = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");

// Uso de licença: vagas usadas x contratadas, atividade e inadimplência.
export function LicenseUsage({ onOpenCompany }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.rpc("report_license_usage").then(({ data, error: err }) => {
      if (err) setError(err.message);
      setRows(data || []);
    });
  }, []);

  if (rows === null) return <PageLoading />;

  const active = rows.filter((r) => r.status === "active");
  const seatsUsed = rows.reduce((s, r) => s + Number(r.seats_used), 0);
  const seats = rows.reduce((s, r) => s + Number(r.seats_limit), 0);
  const mrr = active.reduce((s, r) => s + Number(r.monthly_price), 0);
  const overdue = rows.reduce((s, r) => s + Number(r.overdue_amount), 0);

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <StatGrid>
        <Stat label="Empresas ativas" value={active.length} hint={`${rows.length - active.length} suspensa(s)`} />
        <Stat label="Vagas usadas" value={`${seatsUsed} de ${seats}`} hint={seats ? `${Math.round((100 * seatsUsed) / seats)}% ocupado` : ""} />
        <Stat label="Receita mensal (ativas)" value={money(mrr)} />
        <Stat label="Em atraso" value={money(overdue)} tone={overdue ? "bad" : "good"}
          hint={`${rows.filter((r) => Number(r.overdue_invoices) > 0).length} empresa(s) inadimplente(s)`} />
      </StatGrid>
      <Section title="Por empresa" onExport={() => downloadCsv("uso-de-licencas.csv", [
        { label: "Empresa", value: (r) => r.name }, { label: "Situação", value: (r) => (r.status === "active" ? "ativa" : "suspensa") },
        { label: "Vagas usadas", value: (r) => r.seats_used }, { label: "Vagas contratadas", value: (r) => r.seats_limit },
        { label: "Motoboys ativos (30 dias)", value: (r) => r.active_couriers_30d }, { label: "Pedidos (30 dias)", value: (r) => r.orders_30d },
        { label: "Tarefas (30 dias)", value: (r) => r.assignments_30d }, { label: "Último pedido", value: (r) => dateTime(r.last_order_at) },
        { label: "Mensalidade", value: (r) => Number(r.monthly_price) }, { label: "Em atraso", value: (r) => Number(r.overdue_amount) },
      ], rows)}>
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Empresa</TableCell><TableCell>Situação</TableCell><TableCell align="right">Vagas</TableCell>
                <TableCell align="right">Motoboys ativos 30d</TableCell><TableCell align="right">Pedidos 30d</TableCell>
                <TableCell align="right">Tarefas 30d</TableCell><TableCell>Último pedido</TableCell>
                <TableCell align="right">Mensalidade</TableCell><TableCell align="right">Em atraso</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} hover sx={{ cursor: "pointer" }} onClick={() => onOpenCompany(r.id)}>
                  <TableCell sx={{ fontWeight: 600 }}>{r.name}</TableCell>
                  <TableCell>
                    <Chip size="small" variant="outlined" color={r.status === "active" ? "success" : "error"} label={r.status === "active" ? "Ativa" : "Suspensa"} />
                  </TableCell>
                  <TableCell align="right" sx={{ color: Number(r.seats_used) >= Number(r.seats_limit) ? "#B0793D" : undefined }}>
                    {r.seats_used} / {r.seats_limit}
                  </TableCell>
                  <TableCell align="right">{r.active_couriers_30d}</TableCell>
                  <TableCell align="right">{r.orders_30d}</TableCell>
                  <TableCell align="right">{r.assignments_30d}</TableCell>
                  <TableCell>{dateTime(r.last_order_at)}</TableCell>
                  <TableCell align="right">{Number(r.monthly_price) ? money(r.monthly_price) : "—"}</TableCell>
                  <TableCell align="right" sx={{ color: Number(r.overdue_amount) ? "#B0463D" : undefined, fontWeight: Number(r.overdue_amount) ? 700 : 400 }}>
                    {Number(r.overdue_amount) ? money(r.overdue_amount) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Section>
    </Box>
  );
}

// Faturas: gerar as do mês, dar baixa, cancelar e aplicar bloqueio por atraso.
export function InvoicesTab() {
  const [month, setMonth] = useState(today().slice(0, 7));
  const [filter, setFilter] = useState("open");
  const [list, setList] = useState(null);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    let q = supabase.from("license_invoices").select("*, company:company_id(name, status, grace_days)")
      .order("due_date", { ascending: false }).limit(300);
    if (filter === "open") q = q.eq("status", "pending");
    const { data } = await q;
    setList(data || []);
  }, [filter]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    const { data, error } = await supabase.rpc("generate_license_invoices", { p_month: `${month}-01` });
    setMsg(error ? { type: "error", text: error.message }
      : { type: "success", text: data ? `${data} fatura(s) gerada(s).` : "Nenhuma fatura nova: as do mês já existem, ou nenhuma empresa ativa tem mensalidade." });
    load();
  };

  const suspend = async () => {
    const { data, error } = await supabase.rpc("apply_overdue_suspensions");
    setMsg(error ? { type: "error", text: error.message } : { type: data ? "warning" : "success", text: data ? `${data} empresa(s) suspensa(s) por atraso.` : "Nenhuma empresa com atraso além da carência." });
    load();
  };

  const setStatus = async (inv, status) => {
    const { error } = await supabase.from("license_invoices")
      .update({ status, paid_at: status === "paid" ? new Date().toISOString() : null }).eq("id", inv.id);
    if (error) setMsg({ type: "error", text: error.message });
    load();
  };

  const statusChip = (i) => {
    if (i.status === "paid") return <Chip size="small" color="success" variant="outlined" label={`Paga ${formatDate(i.paid_at)}`} />;
    if (i.status === "cancelled") return <Chip size="small" variant="outlined" label="Cancelada" />;
    if (i.due_date < today()) return <Chip size="small" color="error" variant="outlined" label="Vencida" />;
    return <Chip size="small" color="warning" variant="outlined" label="A receber" />;
  };

  return (
    <Box>
      {msg && <Alert severity={msg.type} sx={{ mb: 2 }} onClose={() => setMsg(null)}>{msg.text}</Alert>}
      <Section title="Gerar faturas">
        <Typography sx={{ fontSize: 12.5, color: "#78716C", mb: 1.5 }}>
          Cria uma fatura para cada empresa ativa com mensalidade, vencendo no dia de cobrança dela. A mensalidade e o dia ficam na página de cada empresa.
        </Typography>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
          <TextField size="small" type="month" label="Mês" value={month} onChange={(e) => setMonth(e.target.value)} InputLabelProps={{ shrink: true }} />
          <Button variant="contained" onClick={generate} disabled={!month}>Gerar faturas do mês</Button>
          <Button variant="outlined" color="error" onClick={suspend}>Suspender inadimplentes</Button>
        </Box>
        <Typography sx={{ fontSize: 11.5, color: "#A8A29E", mt: 1 }}>
          Suspende quem tem fatura vencida há mais dias que a carência da empresa. Para rodar sozinho todo dia, agende no Supabase: select public.apply_overdue_suspensions();
        </Typography>
      </Section>

      <Section title="Faturas" actions={
        <TextField select size="small" value={filter} onChange={(e) => setFilter(e.target.value)} sx={{ minWidth: 150 }}>
          <MenuItem value="open">Em aberto</MenuItem>
          <MenuItem value="all">Todas</MenuItem>
        </TextField>
      } onExport={() => downloadCsv("faturas.csv", [
        { label: "Empresa", value: (i) => i.company?.name }, { label: "Mês", value: (i) => formatDate(i.reference_month).slice(3) },
        { label: "Vencimento", value: (i) => formatDate(i.due_date) }, { label: "Valor", value: (i) => Number(i.amount) },
        { label: "Situação", value: (i) => i.status }, { label: "Paga em", value: (i) => (i.paid_at ? formatDate(i.paid_at) : "") },
      ], list || [])}>
        {list === null ? <CircularProgress size={20} /> : list.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: "#A8A29E" }}>Nenhuma fatura.</Typography>
        ) : (
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small">
              <TableHead><TableRow><TableCell>Empresa</TableCell><TableCell>Mês</TableCell><TableCell>Vencimento</TableCell><TableCell align="right">Valor</TableCell><TableCell>Situação</TableCell><TableCell /></TableRow></TableHead>
              <TableBody>
                {list.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell sx={{ fontWeight: 600 }}>{i.company?.name}{i.company?.status === "suspended" && <Chip size="small" color="error" label="suspensa" sx={{ ml: 1, height: 18, fontSize: 10 }} />}</TableCell>
                    <TableCell>{formatDate(i.reference_month).slice(3)}</TableCell>
                    <TableCell>{formatDate(i.due_date)}</TableCell>
                    <TableCell align="right">{money(i.amount)}</TableCell>
                    <TableCell>{statusChip(i)}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                      {i.status === "pending" && (
                        <>
                          <Button size="small" onClick={() => setStatus(i, "paid")}>Dar baixa</Button>
                          <Button size="small" color="inherit" onClick={() => setStatus(i, "cancelled")}>Cancelar</Button>
                        </>
                      )}
                      {i.status !== "pending" && <Button size="small" color="inherit" onClick={() => setStatus(i, "pending")}>Reabrir</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
        <Typography sx={{ fontSize: 11.5, color: "#A8A29E", mt: 1 }}>Dar baixa não reativa a empresa sozinho: reative no botão "Empresa ativa" da página dela.</Typography>
      </Section>
    </Box>
  );
}

// Cobrança da licença na página da empresa.
export function CompanyBilling({ company, onUpdated }) {
  const [form, setForm] = useState({ monthly_price: company.monthly_price ?? 0, billing_day: company.billing_day ?? 10, grace_days: company.grace_days ?? 5 });
  const [msg, setMsg] = useState(null);
  const save = async () => {
    const { data, error } = await supabase.from("companies").update({
      monthly_price: Number(String(form.monthly_price).replace(",", ".")) || 0,
      billing_day: Number(form.billing_day), grace_days: Number(form.grace_days),
    }).eq("id", company.id).select("*").single();
    setMsg(error ? { type: "error", text: error.message } : { type: "success", text: "Cobrança salva." });
    if (!error) onUpdated(data);
  };
  return (
    <CollapsibleSection id="plataforma-cobranca" title="Cobrança da licença"
      summary={`${money(company.monthly_price || 0)} por mês · vence dia ${company.billing_day ?? 10} · ${company.grace_days ?? 5} dias de tolerância`}>
      {msg && <Alert severity={msg.type} sx={{ mb: 1.5 }} onClose={() => setMsg(null)}>{msg.text}</Alert>}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr 1fr auto" }, gap: 1 }}>
        <TextField size="small" label="Mensalidade (R$)" value={form.monthly_price} onChange={(e) => setForm({ ...form, monthly_price: e.target.value })} />
        <TextField size="small" type="number" label="Dia de vencimento (1–28)" value={form.billing_day} inputProps={{ min: 1, max: 28 }}
          onChange={(e) => setForm({ ...form, billing_day: e.target.value })} />
        <TextField size="small" type="number" label="Carência (dias)" value={form.grace_days} inputProps={{ min: 0, max: 60 }}
          onChange={(e) => setForm({ ...form, grace_days: e.target.value })} />
        <Button variant="outlined" onClick={save}>Salvar</Button>
      </Box>
      <CompanyInvoices companyId={company.id} />
    </CollapsibleSection>
  );
}

// Faturas da licença desta empresa (só a plataforma vê).
function CompanyInvoices({ companyId }) {
  const [list, setList] = useState(null);
  useEffect(() => {
    supabase.from("license_invoices").select("*").eq("company_id", companyId).order("reference_month", { ascending: false }).limit(24)
      .then(({ data }) => setList(data || []));
  }, [companyId]);

  const statusChip = (i) => {
    if (i.status === "paid") return <Chip size="small" color="success" variant="outlined" label={`Paga ${formatDate(i.paid_at)}`} />;
    if (i.status === "cancelled") return <Chip size="small" variant="outlined" label="Cancelada" />;
    if (i.due_date < today()) return <Chip size="small" color="error" variant="outlined" label="Vencida" />;
    return <Chip size="small" color="warning" variant="outlined" label="A pagar" />;
  };

  return (
    <Box sx={{ mt: 2 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 700, color: "#78716C", mb: 1 }}>FATURAS DESTA EMPRESA</Typography>
      {list === null ? <CircularProgress size={18} /> : list.length === 0 ? (
        <Typography sx={{ fontSize: 13, color: "#A8A29E" }}>Nenhuma fatura emitida. Gere em "Faturas", no topo.</Typography>
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
    </Box>
  );
}
