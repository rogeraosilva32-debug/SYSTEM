import { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, Button, CircularProgress, Alert, Table, TableHead, TableRow, TableCell, TableBody,
} from "@mui/material";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import supabase from "../../services/supabase";
import { money, PAYMENT_LABEL, SOURCE_LABEL } from "../../utils/delivery";
import { periodRange, formatDate, minutes, km, downloadCsv } from "../../utils/reports";
import { PeriodPicker, Stat, StatGrid, Section, BarList, DayBars } from "../../components/ReportParts";

const paymentLabel = (k) => PAYMENT_LABEL[k] || "Não informado";

// Um valor por dia do período (dias sem venda aparecem zerados).
function fillDays(range, rows) {
  const byDay = Object.fromEntries(rows.map((r) => [String(r.day).slice(0, 10), r]));
  const out = [];
  const d = new Date(`${range[0]}T12:00:00`);
  const end = new Date(`${range[1]}T12:00:00`);
  if ((end - d) / 86400000 > 92) return rows;
  while (d <= end) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push(byDay[key] || { day: key, count: 0, total: 0 });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// Relatórios gerenciais do admin da empresa: financeiro e produtividade.
// Os números vêm prontos do banco (report_financial / report_productivity).
// companyId só é passado pela plataforma, para ver o relatório de uma empresa.
export function ReportsTab({ companyId = null }) {
  const [range, setRange] = useState(() => periodRange("7d"));
  const [fin, setFin] = useState(null);
  const [prod, setProd] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const args = { p_from: range[0], p_to: range[1], p_company: companyId };
    const [f, p] = await Promise.all([
      supabase.rpc("report_financial", args),
      supabase.rpc("report_productivity", args),
    ]);
    setLoading(false);
    if (f.error || p.error) { setError((f.error || p.error).message); return; }
    setFin(f.data);
    setProd(p.data);
  }, [range, companyId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const suffix = `${range[0]}_a_${range[1]}`;
  const t = fin?.totals;
  const times = prod?.times;
  const couriers = prod?.couriers || [];

  return (
    <Box className="report-print">
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 1, flexWrap: "wrap" }}>
        <PeriodPicker value={range} onChange={setRange} />
        <Button className="no-print" startIcon={<PrintOutlinedIcon />} variant="outlined" size="small" onClick={() => window.print()}>
          Imprimir / PDF
        </Button>
      </Box>
      <Typography sx={{ fontSize: 13, color: "#78716C", mb: 2 }}>
        Período: <b>{formatDate(range[0])}</b> a <b>{formatDate(range[1])}</b>. Valores de pedidos entregues, pela data do pedido.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading && !fin && <Box sx={{ py: 8, textAlign: "center" }}><CircularProgress size={26} /></Box>}

      {t && (
        <>
          <Typography sx={{ fontWeight: 800, fontSize: 18, mb: 1.5 }}>Financeiro</Typography>
          <StatGrid>
            <Stat label="Faturamento" value={money(t.revenue)} hint={`${t.delivered} entregue(s) de ${t.orders} pedido(s)`} />
            <Stat label="Ticket médio" value={money(t.avg_ticket)} />
            <Stat label="Taxas de entrega" value={money(t.fees)} />
            <Stat label="Dinheiro a conferir" value={money(t.unconfirmed_cash)} tone={Number(t.unconfirmed_cash) > 0 ? "warn" : "good"}
              hint="Pagos em dinheiro ainda não conferidos" />
            <Stat label="Cancelados" value={t.cancelled} tone={t.cancelled ? "bad" : undefined} />
            <Stat label="Com problema" value={t.problems} tone={t.problems ? "bad" : undefined} />
            <Stat label="Acertos de motoboy" value={money(fin.settlements.total)}
              hint={`${money(fin.settlements.paid)} pago · ${money(fin.settlements.open)} em aberto`} />
            <Stat label="Resultado (faturamento − acertos)" value={money(Number(t.revenue) - Number(fin.settlements.total))} />
          </StatGrid>

          <Section title="Faturamento por dia" onExport={() => downloadCsv(`faturamento-por-dia_${suffix}.csv`,
            [{ label: "Dia", value: (r) => formatDate(r.day) }, { label: "Pedidos", value: (r) => r.count }, { label: "Total", value: (r) => Number(r.total) }],
            fillDays(range, fin.by_day))}>
            <DayBars rows={fillDays(range, fin.by_day).map((r) => ({ label: formatDate(r.day), value: r.total }))} format={money} />
          </Section>

          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2.5 }}>
            <Section title="Por forma de pagamento" onExport={() => downloadCsv(`por-pagamento_${suffix}.csv`,
              [{ label: "Forma", value: (r) => paymentLabel(r.key) }, { label: "Pedidos", value: (r) => r.count }, { label: "Total", value: (r) => Number(r.total) }],
              fin.by_payment)}>
              <BarList rows={fin.by_payment.map((r) => ({ label: paymentLabel(r.key), value: r.total, extra: `${r.count}` }))} format={money} />
            </Section>
            <Section title="Por origem do pedido" onExport={() => downloadCsv(`por-origem_${suffix}.csv`,
              [{ label: "Origem", value: (r) => SOURCE_LABEL[r.key] || r.key }, { label: "Pedidos", value: (r) => r.count }, { label: "Total", value: (r) => Number(r.total) }],
              fin.by_source)}>
              <BarList rows={fin.by_source.map((r) => ({ label: SOURCE_LABEL[r.key] || r.key, value: r.total, extra: `${r.count}` }))} format={money} />
            </Section>
          </Box>

          <Section title="Por bairro" onExport={() => downloadCsv(`por-bairro_${suffix}.csv`,
            [{ label: "Bairro", value: (r) => r.key }, { label: "Pedidos", value: (r) => r.count },
             { label: "Total", value: (r) => Number(r.total) }, { label: "Taxas", value: (r) => Number(r.fees) }],
            fin.by_neighborhood)}>
            <BarList rows={fin.by_neighborhood.slice(0, 15).map((r) => ({ label: r.key, value: r.total, extra: `${r.count} · taxas ${money(r.fees)}` }))} format={money} />
            {fin.by_neighborhood.length > 15 && (
              <Typography sx={{ fontSize: 12, color: "#A8A29E", mt: 1 }}>Mostrando os 15 maiores. O CSV traz todos.</Typography>
            )}
          </Section>
        </>
      )}

      {times && (
        <>
          <Typography sx={{ fontWeight: 800, fontSize: 18, mb: 1.5, mt: 1 }}>Produtividade</Typography>
          <StatGrid>
            <Stat label="Preparo (recebido → pronto)" value={minutes(times.prep_min)} />
            <Stat label="Espera (pronto → saiu)" value={minutes(times.wait_min)} />
            <Stat label="Em rota (saiu → entregue)" value={minutes(times.route_min)} />
            <Stat label="Total (pedido → entregue)" value={minutes(times.total_min)}
              hint={times.with_eta ? `${times.late} de ${times.with_eta} acima do tempo do bairro` : "Cadastre o tempo dos bairros para medir atrasos"}
              tone={times.late ? "warn" : undefined} />
          </StatGrid>

          <Section title="Por motoboy" onExport={() => downloadCsv(`produtividade_${suffix}.csv`, [
            { label: "Motoboy", value: (r) => r.name },
            { label: "Entregas", value: (r) => r.deliveries },
            { label: "Saídas", value: (r) => r.runs },
            { label: "Km", value: (r) => Number(r.km) },
            { label: "Tempo médio em rota (min)", value: (r) => (r.route_min === null ? "" : Number(r.route_min)) },
            { label: "Atrasos", value: (r) => r.late },
            { label: "Com código", value: (r) => r.by_code },
            { label: "Finalizadas sem código", value: (r) => r.forced },
            { label: "Problemas", value: (r) => r.problems },
            { label: "Desvios de rota", value: (r) => r.off_route },
            { label: "Avaliação média", value: (r) => (r.rating_avg === null ? "" : Number(r.rating_avg)) },
            { label: "Avaliações", value: (r) => r.rating_count },
          ], couriers)}>
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Motoboy</TableCell>
                    <TableCell align="right">Entregas</TableCell>
                    <TableCell align="right">Saídas</TableCell>
                    <TableCell align="right">Km</TableCell>
                    <TableCell align="right">Média em rota</TableCell>
                    <TableCell align="right">Atrasos</TableCell>
                    <TableCell align="right">Sem código</TableCell>
                    <TableCell align="right">Problemas</TableCell>
                    <TableCell align="right">Desvios</TableCell>
                    <TableCell align="right">Avaliação</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {couriers.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell sx={{ fontWeight: 600 }}>{c.name}</TableCell>
                      <TableCell align="right">{c.deliveries}</TableCell>
                      <TableCell align="right">{c.runs}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>{km(c.km)}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>{minutes(c.route_min)}</TableCell>
                      <TableCell align="right" sx={{ color: c.late ? "#B0793D" : undefined }}>{c.late}</TableCell>
                      <TableCell align="right">{c.forced}</TableCell>
                      <TableCell align="right" sx={{ color: c.problems ? "#B0463D" : undefined }}>{c.problems}</TableCell>
                      <TableCell align="right" sx={{ color: c.off_route ? "#B0463D" : undefined }}>{c.off_route}</TableCell>
                      <TableCell align="right">{c.rating_count ? `${Number(c.rating_avg).toFixed(1)} (${c.rating_count})` : "—"}</TableCell>
                    </TableRow>
                  ))}
                  {couriers.length === 0 && (
                    <TableRow><TableCell colSpan={10} sx={{ textAlign: "center", color: "#A8A29E", py: 3 }}>Nenhum motoboy cadastrado.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
            <Typography sx={{ fontSize: 11.5, color: "#A8A29E", mt: 1 }}>
              Km calculado pelas posições enviadas pelo celular do motoboy (com o app aberto). Avaliações vêm das tarefas avaliadas pelo cliente.
            </Typography>
          </Section>
        </>
      )}
    </Box>
  );
}
