import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import {
  Box, Typography, TextField, MenuItem, Chip, Switch, FormControlLabel, Button, CircularProgress, Alert, Tooltip,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import DownloadIcon from "@mui/icons-material/Download";
import supabase from "../../services/supabase";

// Log do sistema, no estilo do log do Mikrotik: uma linha por evento com
// hora, tópicos (assunto + nível) e a mensagem; clicando, abre o detalhe
// (antes/depois de cada campo, IP, aparelho). Só a plataforma enxerga.

const TOPICS = [
  { key: "pedido", label: "Pedidos" },
  { key: "despacho", label: "Saídas" },
  { key: "expediente", label: "Expediente" },
  { key: "ajustes", label: "Ajustes" },
  { key: "cardápio", label: "Cardápio" },
  { key: "cliente", label: "Clientes" },
  { key: "equipe", label: "Equipe" },
  { key: "financeiro", label: "Financeiro" },
  { key: "conta", label: "Login" },
  { key: "rede", label: "Conexão" },
  { key: "erro", label: "Erros" },
  { key: "segurança", label: "Segurança" },
  { key: "integração", label: "Integração" },
  { key: "auditoria", label: "Auditoria" },
  { key: "plataforma", label: "Plataforma" },
];

const LEVELS = [
  { key: "info", label: "Info", fg: "#57534E", bg: "transparent" },
  { key: "warning", label: "Aviso", fg: "#9A6B1F", bg: "#FFF8EB" },
  { key: "error", label: "Erro", fg: "#B0463D", bg: "#FDF0EF" },
  { key: "critical", label: "Crítico", fg: "#FFFFFF", bg: "#B0463D" },
];
const LEVEL = Object.fromEntries(LEVELS.map((l) => [l.key, l]));

const PERIODS = [
  { key: "1h", label: "Última hora", ms: 3600e3 },
  { key: "24h", label: "Últimas 24 h", ms: 86400e3 },
  { key: "7d", label: "Últimos 7 dias", ms: 7 * 86400e3 },
  { key: "30d", label: "Últimos 30 dias", ms: 30 * 86400e3 },
  { key: "all", label: "Tudo", ms: null },
];

const ROLE_LABEL = {
  plataforma: "plataforma", gestor: "gestor", supervisor: "supervisor", motoboy: "motoboy",
  sistema: "sistema", visitante: "visitante", cozinha: "cozinha", "usuário": "usuário",
};

const PAGE = 200;
const LIVE_MS = 5000;
const MAX_ROWS = 1000; // a tela aberta por horas não cresce sem fim
const mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

const fmtTime = (d) => new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const fmtValue = (v) => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

function Detail({ e }) {
  const changes = e.changes ? Object.entries(e.changes) : [];
  const device = e.details?.aparelho;
  const rest = e.details ? Object.fromEntries(Object.entries(e.details).filter(([k]) => k !== "aparelho")) : null;
  const row = (label, value) => value ? (
    <Box sx={{ display: "flex", gap: 1, fontSize: 12.5 }}>
      <Box sx={{ color: "#A8A29E", minWidth: 92, flexShrink: 0 }}>{label}</Box>
      <Box sx={{ wordBreak: "break-word" }}>{value}</Box>
    </Box>
  ) : null;
  return (
    <Box sx={{ p: 1.5, background: "#FAFAF9", borderTop: "1px dashed #E7E5E4", display: "flex", flexDirection: "column", gap: 0.6 }}>
      {row("Quando", new Date(e.created_at).toLocaleString("pt-BR"))}
      {row("Empresa", e.company_name)}
      {row("Quem", [e.actor_name, e.actor_email, ROLE_LABEL[e.actor_role] || e.actor_role].filter(Boolean).join(" · "))}
      {row("IP", e.ip)}
      {row("Aparelho", device ? [device.navegador, device.sistema, device.celular ? "celular" : "computador", device.app_instalado ? "app instalado" : null, device.rede ? `rede ${device.rede}` : null].filter(Boolean).join(" · ") : e.user_agent)}
      {device && e.user_agent && row("Navegador", <span style={{ fontFamily: mono, fontSize: 11 }}>{e.user_agent}</span>)}
      {row("Origem", e.source === "app" ? "aviso do app" : "registrado pelo banco")}
      {row("Registro", e.entity ? `${e.entity} ${e.entity_id || ""}` : null)}
      {row("Código", <span style={{ fontFamily: mono }}>{e.action} #{e.id}</span>)}
      {changes.length > 0 && (
        <Box sx={{ mt: 1, overflowX: "auto" }}>
          <Box component="table" sx={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 360, "& td, & th": { border: "1px solid #E7E5E4", px: 1, py: 0.5, textAlign: "left", verticalAlign: "top" } }}>
            <thead><tr><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead>
            <tbody>
              {changes.map(([k, v]) => (
                <tr key={k}>
                  <td>{Array.isArray(v) && v[2] ? v[2] : k}</td>
                  <td style={{ color: "#B0463D", fontFamily: mono, wordBreak: "break-all" }}>{fmtValue(Array.isArray(v) ? v[0] : v)}</td>
                  <td style={{ color: "#4B7A5E", fontFamily: mono, wordBreak: "break-all" }}>{fmtValue(Array.isArray(v) ? v[1] : null)}</td>
                </tr>
              ))}
            </tbody>
          </Box>
        </Box>
      )}
      {rest && Object.keys(rest).length > 0 && (
        <Box component="pre" sx={{ m: 0, mt: 1, p: 1, background: "#fff", border: "1px solid #E7E5E4", borderRadius: "8px", fontFamily: mono, fontSize: 11, maxHeight: 260, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
          {JSON.stringify(rest, null, 2)}
        </Box>
      )}
    </Box>
  );
}

export default function SystemLog({ companyId = null }) {
  const [companies, setCompanies] = useState([]);
  const [company, setCompany] = useState(companyId || "");
  const [topics, setTopics] = useState([]);
  const [levels, setLevels] = useState([]);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState("24h");
  const [live, setLive] = useState(true);
  const [rows, setRows] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(() => new Set());
  const [fresh, setFresh] = useState(() => new Set());
  const rowsRef = useRef(null);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  // Muda a cada troca de filtro: resposta de uma busca antiga é ignorada.
  const reqSeq = useRef(0);

  useEffect(() => {
    if (companyId) return;
    supabase.from("companies").select("id, name").order("name").then(({ data }) => setCompanies(data || []));
  }, [companyId]);

  // Busca só depois que a pessoa para de digitar.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 400);
    return () => clearTimeout(t);
  }, [search]);

  const params = useCallback((extra = {}) => {
    const p = PERIODS.find((x) => x.key === period);
    return {
      p_company: company || null,
      p_topics: topics.length ? topics : null,
      p_levels: levels.length ? levels : null,
      p_search: query || null,
      p_since: p?.ms ? new Date(Date.now() - p.ms).toISOString() : null,
      p_limit: PAGE,
      ...extra,
    };
  }, [company, topics, levels, query, period]);

  const load = useCallback(async () => {
    setError("");
    const seq = ++reqSeq.current;
    const { data, error: err } = await supabase.rpc("platform_system_log", params());
    if (seq !== reqSeq.current) return;
    if (err) {
      setRows([]);
      setError(/Could not find|does not exist/i.test(err.message)
        ? "O banco ainda não tem o log do sistema. Rode o supabase-b2b-schema.sql atualizado no Supabase."
        : err.message);
      return;
    }
    setRows(data || []);
    setHasMore((data || []).length === PAGE);
    setOpen(new Set());
  }, [params]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setRows(null); load(); }, [load]);

  // Ao vivo: a cada 5 s busca os últimos 30 s antes da linha mais nova (uma
  // gravação mais demorada pode chegar com número menor) e junta sem repetir.
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(async () => {
      const current = rowsRef.current;
      if (!current || document.hidden) return;
      const seq = reqSeq.current;
      const newest = current[0]?.created_at;
      const since = newest ? new Date(new Date(newest).getTime() - 30000).toISOString() : undefined;
      const { data } = await supabase.rpc("platform_system_log", params(since ? { p_since: since } : {}));
      if (seq !== reqSeq.current || !data?.length) return;
      // Chegou mais que uma página de uma vez: recarrega para não deixar buraco.
      if (data.length >= PAGE) { load(); return; }
      setRows((prev) => {
        const seen = new Set((prev || []).map((r) => r.id));
        const added = data.filter((r) => !seen.has(r.id));
        if (!added.length) return prev;
        setFresh(new Set(added.map((r) => r.id)));
        const merged = [...added, ...(prev || [])].sort((a, b) => b.id - a.id);
        if (merged.length > MAX_ROWS) setHasMore(true);
        return merged.slice(0, MAX_ROWS);
      });
    }, LIVE_MS);
    return () => clearInterval(timer);
  }, [live, params, load]);

  const loadMore = async () => {
    if (!rows?.length) return;
    setLoadingMore(true);
    const seq = reqSeq.current;
    const { data } = await supabase.rpc("platform_system_log", params({ p_before: rows[rows.length - 1].id }));
    setLoadingMore(false);
    if (seq !== reqSeq.current) return;
    setRows((prev) => [...prev, ...(data || [])]);
    setHasMore((data || []).length === PAGE);
  };

  const toggle = (set, setter, key) => {
    const next = set.includes(key) ? set.filter((k) => k !== key) : [...set, key];
    setter(next);
  };

  const toggleOpen = (id) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const exportCsv = () => {
    // Aspa simples na frente de = + - @ evita que o Excel trate o texto como fórmula.
    const esc = (v) => {
      const t = String(v ?? "");
      return `"${(/^[=+\-@\t\r]/.test(t) ? "'" + t : t).replace(/"/g, '""')}"`;
    };
    const header = ["id", "data_hora", "topico", "nivel", "empresa", "quem", "email", "cargo", "mensagem", "ip", "acao"];
    const lines = (rows || []).map((r) => [r.id, new Date(r.created_at).toLocaleString("pt-BR"), r.topic, r.level, r.company_name,
      r.actor_name, r.actor_email, r.actor_role, r.message, r.ip, r.action].map(esc).join(";"));
    const blob = new Blob(["﻿" + [header.join(";"), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `log-sistema-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const chip = (active, label, onClick, color) => (
    <Chip key={label} label={label} size="small" onClick={onClick} clickable
      sx={{
        height: 26, fontSize: 12, fontWeight: 700,
        background: active ? (color || "#1C1917") : "#F5F5F4",
        color: active ? "#fff" : "#57534E",
        "&:hover": { background: active ? (color || "#1C1917") : "#E7E5E4" },
      }} />
  );

  return (
    <Box>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: companyId ? "2fr 1fr auto" : "2fr 1.2fr 1fr auto" }, gap: 1.5, mb: 1.5, alignItems: "center" }}>
        <TextField size="small" label="Buscar (cliente, pedido, pessoa, IP...)" value={search} onChange={(e) => setSearch(e.target.value)} />
        {!companyId && (
          <TextField size="small" select label="Empresa" value={company} onChange={(e) => setCompany(e.target.value)}
            SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }}>
            <MenuItem value="">Todas</MenuItem>
            {companies.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
          </TextField>
        )}
        <TextField size="small" select label="Período" value={period} onChange={(e) => setPeriod(e.target.value)}>
          {PERIODS.map((p) => <MenuItem key={p.key} value={p.key}>{p.label}</MenuItem>)}
        </TextField>
        <Box sx={{ display: "flex", gap: 0.5, alignItems: "center", justifyContent: { xs: "space-between", md: "flex-end" } }}>
          <FormControlLabel control={<Switch size="small" checked={live} onChange={(e) => setLive(e.target.checked)} />}
            label={<Typography sx={{ fontSize: 13, fontWeight: 700 }}>Ao vivo</Typography>} sx={{ mr: 0.5 }} />
          <Tooltip title="Atualizar"><span><Button size="small" onClick={() => { setRows(null); load(); }} sx={{ minWidth: 36 }}><RefreshIcon fontSize="small" /></Button></span></Tooltip>
          <Tooltip title="Baixar o que está na tela (CSV)"><span><Button size="small" onClick={exportCsv} disabled={!rows?.length} sx={{ minWidth: 36 }}><DownloadIcon fontSize="small" /></Button></span></Tooltip>
        </Box>
      </Box>

      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.6, mb: 1 }}>
        {TOPICS.map((t) => chip(topics.includes(t.key), t.label, () => toggle(topics, setTopics, t.key)))}
      </Box>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.6, mb: 2, alignItems: "center" }}>
        {LEVELS.map((l) => chip(levels.includes(l.key), l.label, () => toggle(levels, setLevels, l.key), l.key === "info" ? "#57534E" : l.key === "warning" ? "#B0793D" : "#B0463D"))}
        {(topics.length > 0 || levels.length > 0 || (company && !companyId) || search) && (
          <Button size="small" onClick={() => { setTopics([]); setLevels([]); setCompany(companyId || ""); setSearch(""); }} sx={{ textTransform: "none", fontWeight: 700, color: "#78716C" }}>
            Limpar filtros
          </Button>
        )}
        {rows && <Typography sx={{ ml: "auto", fontSize: 12, color: "#A8A29E" }}>{rows.length}{hasMore ? "+" : ""} eventos</Typography>}
      </Box>

      {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}

      {rows === null ? (
        <Box sx={{ py: 6, textAlign: "center" }}><CircularProgress size={24} /></Box>
      ) : rows.length === 0 && !error ? (
        <Box sx={{ py: 6, textAlign: "center", color: "#A8A29E", fontSize: 14 }}>Nenhum evento com esses filtros.</Box>
      ) : (
        <Box sx={{ border: "1px solid #E7E5E4", borderRadius: "12px", overflow: "hidden", background: "#fff" }}>
          <Box sx={{
            display: { xs: "none", md: "grid" }, gridTemplateColumns: "128px 150px 150px 170px 1fr",
            px: 1.5, py: 0.8, background: "#F5F5F4", fontSize: 11, fontWeight: 800, color: "#78716C", textTransform: "uppercase", letterSpacing: 0.4,
          }}>
            <Box>Hora</Box><Box>Tópicos</Box><Box>Empresa</Box><Box>Quem</Box><Box>Mensagem</Box>
          </Box>
          {rows.map((e) => {
            const lv = LEVEL[e.level] || LEVEL.info;
            const isOpen = open.has(e.id);
            return (
              <Fragment key={e.id}>
                <Box onClick={() => toggleOpen(e.id)} data-testid="log-row" sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", md: "128px 150px 150px 170px 1fr" },
                  gap: { xs: 0.2, md: 0 }, px: 1.5, py: 0.7, cursor: "pointer",
                  borderTop: "1px solid #F5F5F4", fontFamily: mono, fontSize: 12.5,
                  background: fresh.has(e.id) ? "#F0F7F2" : (e.level === "info" ? "#fff" : lv.bg),
                  color: e.level === "critical" ? "#B0463D" : e.level === "info" ? "#1C1917" : lv.fg,
                  fontWeight: e.level === "critical" ? 800 : 400,
                  transition: "background 1.5s",
                  "&:hover": { background: "#FAFAF9" },
                }}>
                  <Box sx={{ color: "#78716C", display: "flex", gap: 1 }}>
                    {fmtTime(e.created_at)}
                    <Box component="span" sx={{ display: { md: "none" }, color: lv.fg, fontWeight: 700 }}>{e.topic},{e.level}</Box>
                  </Box>
                  <Box sx={{ display: { xs: "none", md: "block" }, fontWeight: 700, color: e.level === "info" ? "#57534E" : lv.fg === "#FFFFFF" ? "#B0463D" : lv.fg }}>
                    {e.topic},{e.level}
                  </Box>
                  <Box sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: { md: "nowrap" }, color: "#57534E", order: { xs: 3, md: 0 }, fontSize: { xs: 11.5, md: 12.5 } }}>
                    {e.company_name || "—"}
                    <Box component="span" sx={{ display: { md: "none" } }}> · {e.actor_name || "—"}{e.actor_role ? ` (${ROLE_LABEL[e.actor_role] || e.actor_role})` : ""}</Box>
                  </Box>
                  <Box sx={{ display: { xs: "none", md: "block" }, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#57534E" }}>
                    {e.actor_name || "—"}{e.actor_role ? ` (${ROLE_LABEL[e.actor_role] || e.actor_role})` : ""}
                  </Box>
                  <Box sx={{ wordBreak: "break-word", fontFamily: { xs: "inherit" } }}>{e.message}</Box>
                </Box>
                {isOpen && <Detail e={e} />}
              </Fragment>
            );
          })}
        </Box>
      )}

      {hasMore && rows?.length > 0 && (
        <Box sx={{ textAlign: "center", mt: 1.5 }}>
          <Button onClick={loadMore} disabled={loadingMore} sx={{ fontWeight: 700, textTransform: "none" }}>
            {loadingMore ? <CircularProgress size={16} /> : "Carregar mais antigos"}
          </Button>
        </Box>
      )}
      <Typography sx={{ mt: 2, fontSize: 11.5, color: "#A8A29E" }}>
        O log guarda 180 dias. Valores secretos (chaves, códigos de convite) aparecem só como alterados.
      </Typography>
    </Box>
  );
}
