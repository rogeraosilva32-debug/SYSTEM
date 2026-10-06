import { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, Button, TextField, Dialog, DialogTitle, DialogContent, DialogActions, Alert,
  CircularProgress, MenuItem, Autocomplete, Chip,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import supabase from "../../services/supabase";

const LEVELS = [
  { key: "info", label: "Informação", color: "#1F4E80", bg: "#EEF4FB" },
  { key: "warning", label: "Atenção", color: "#7A5512", bg: "#FDF6E7" },
  { key: "critical", label: "Urgente", color: "#8C2F27", bg: "#F6EBEA" },
];
const levelOf = (k) => LEVELS.find((l) => l.key === k) || LEVELS[0];

// "2026-10-06T18:30" para o campo de data/hora (hora local).
const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
const fmt = (iso) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

function NoticeDialog({ notice, companies, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: notice?.title || "", body: notice?.body || "", level: notice?.level || "info",
    audience: notice?.audience || "admins",
    targets: (notice?.company_ids || []).map((id) => companies.find((c) => c.id === id)).filter(Boolean),
    starts_at: toLocalInput(notice?.starts_at), ends_at: toLocalInput(notice?.ends_at),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.title.trim()) { setError("Escreva um título."); return; }
    if (form.ends_at && form.starts_at && form.ends_at <= form.starts_at) { setError("O fim precisa ser depois do início."); return; }
    setSaving(true); setError("");
    const { error: err } = await supabase.rpc("save_platform_notice", {
      p_id: notice?.id || null, p_title: form.title.trim(), p_body: form.body.trim(), p_level: form.level,
      p_audience: form.audience, p_company_ids: form.targets.length ? form.targets.map((c) => c.id) : null,
      p_starts_at: fromLocalInput(form.starts_at), p_ends_at: fromLocalInput(form.ends_at),
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>{notice ? "Editar aviso" : "Novo aviso"}</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField label="Título" value={form.title} onChange={set("title")} fullWidth autoFocus inputProps={{ maxLength: 120 }} />
        <TextField label="Mensagem" value={form.body} onChange={set("body")} fullWidth multiline minRows={3} inputProps={{ maxLength: 2000 }} />
        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
          <TextField select label="Tipo" value={form.level} onChange={set("level")} sx={{ flex: 1, minWidth: 160 }}>
            {LEVELS.map((l) => <MenuItem key={l.key} value={l.key}>{l.label}</MenuItem>)}
          </TextField>
          <TextField select label="Quem vê" value={form.audience} onChange={set("audience")} sx={{ flex: 1, minWidth: 200 }}>
            <MenuItem value="admins">Gestores e supervisores</MenuItem>
            <MenuItem value="all">Todos, inclusive motoboys</MenuItem>
          </TextField>
        </Box>
        <Autocomplete multiple options={companies} value={form.targets} getOptionLabel={(c) => c.name}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          onChange={(_, v) => setForm((f) => ({ ...f, targets: v }))}
          renderInput={(p) => <TextField {...p} label="Empresas" placeholder={form.targets.length ? "" : "Todas as empresas"} helperText="Vazio = todas as empresas" />} />
        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
          <TextField type="datetime-local" label="Mostrar a partir de" value={form.starts_at} onChange={set("starts_at")}
            InputLabelProps={{ shrink: true }} helperText="Vazio = agora" sx={{ flex: 1, minWidth: 200 }} />
          <TextField type="datetime-local" label="Até" value={form.ends_at} onChange={set("ends_at")}
            InputLabelProps={{ shrink: true }} helperText="Vazio = até apagar" sx={{ flex: 1, minWidth: 200 }} />
        </Box>
      </DialogContent>
      <DialogActions sx={{ p: 2.5, pt: 0 }}>
        <Button onClick={onClose} sx={{ color: "#78716C" }}>Cancelar</Button>
        <Button onClick={save} disabled={saving} variant="contained">{saving ? <CircularProgress size={18} sx={{ color: "#fff" }} /> : "Publicar aviso"}</Button>
      </DialogActions>
    </Dialog>
  );
}

// Avisos para as empresas (manutenção, novidade, cobrança). Aparecem no
// topo do painel delas até a pessoa clicar em "Entendi".
export default function PlatformNoticesAdmin({ companies }) {
  const [notices, setNotices] = useState(null);
  const [reads, setReads] = useState({});
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [n, r] = await Promise.all([
      supabase.from("platform_notices").select("*").order("created_at", { ascending: false }),
      supabase.from("platform_notice_reads").select("notice_id"),
    ]);
    if (n.error) {
      setError(/Could not find|does not exist/i.test(n.error.message)
        ? "O banco ainda não tem avisos. Rode o supabase-b2b-schema.sql atualizado no Supabase." : n.error.message);
      setNotices([]);
      return;
    }
    setNotices(n.data || []);
    const c = {};
    (r.data || []).forEach((x) => { c[x.notice_id] = (c[x.notice_id] || 0) + 1; });
    setReads(c);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const remove = async (n) => {
    if (!window.confirm(`Apagar o aviso "${n.title}"? Ele some do painel das empresas.`)) return;
    const { error: err } = await supabase.rpc("delete_platform_notice", { p_id: n.id });
    if (err) setError(err.message); else load();
  };

  if (notices === null) return <Box sx={{ py: 8, textAlign: "center" }}><CircularProgress size={26} /></Box>;
  const nowMs = notices.length ? new Date().getTime() : 0;
  const state = (n) => (new Date(n.starts_at).getTime() > nowMs ? "Agendado"
    : n.ends_at && new Date(n.ends_at).getTime() <= nowMs ? "Encerrado" : "No ar");
  const names = (ids) => (ids?.length ? ids.map((id) => companies.find((c) => c.id === id)?.name || "?").join(", ") : "Todas as empresas");

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, mb: 2, flexWrap: "wrap" }}>
        <Typography sx={{ fontSize: 13, color: "#78716C", maxWidth: 560 }}>
          O aviso aparece no topo do painel das empresas escolhidas até cada pessoa clicar em "Entendi".
        </Typography>
        <Button startIcon={<AddIcon />} variant="contained" onClick={() => setEditing({})}>Novo aviso</Button>
      </Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>{error}</Alert>}
      {notices.length === 0 && !error && <Typography sx={{ fontSize: 13, color: "#A8A29E", py: 3 }}>Nenhum aviso publicado.</Typography>}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        {notices.map((n) => {
          const l = levelOf(n.level);
          const st = state(n);
          return (
            <Box key={n.id} data-testid="aviso" sx={{ border: "1px solid #E7E5E4", borderRadius: "14px", p: 2, background: "#fff" }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                <Chip label={l.label} size="small" sx={{ height: 20, fontSize: 10.5, fontWeight: 800, background: l.bg, color: l.color }} />
                <Typography sx={{ fontWeight: 800, fontSize: 14.5, flex: 1, minWidth: 160 }}>{n.title}</Typography>
                <Chip label={st} size="small" variant="outlined" sx={{ height: 20, fontSize: 10.5, fontWeight: 700, color: st === "No ar" ? "#4B7A5E" : "#78716C" }} />
              </Box>
              {n.body && <Typography sx={{ fontSize: 13, color: "#44403C", mt: 0.8, whiteSpace: "pre-wrap" }}>{n.body}</Typography>}
              <Typography sx={{ fontSize: 12, color: "#78716C", mt: 1 }}>
                {names(n.company_ids)} · {n.audience === "all" ? "todos" : "gestores e supervisores"} · de {fmt(n.starts_at)}{n.ends_at ? ` até ${fmt(n.ends_at)}` : ""} · {reads[n.id] || 0} pessoa(s) leram
              </Typography>
              <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
                <Button size="small" variant="outlined" onClick={() => setEditing(n)}>Editar</Button>
                <Button size="small" onClick={() => remove(n)} sx={{ color: "#B0463D" }}>Apagar</Button>
              </Box>
            </Box>
          );
        })}
      </Box>
      {editing && <NoticeDialog notice={editing.id ? editing : null} companies={companies || []}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </Box>
  );
}
