import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import {
  Box, Typography, Button, IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, MenuItem, FormControlLabel, Switch, CircularProgress,
} from "@mui/material";
import SettingsIcon from "@mui/icons-material/SettingsOutlined";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import supabase from "../services/supabase";
import { setKitchenToken } from "../services/eventLog";

// Modo cozinha: tela cheia com a fila de preparo, para deixar numa TV ou
// tablet na cozinha. Abre com login de gestor (/cozinha) ou pelo link da
// tela (/cozinha/<link>), que não precisa de login e só vê a fila.
// Os ajustes (quantos pedidos por tela, fixo ou alternando) ficam em cada aparelho.

const SETTINGS_KEY = "kitchen-display";
const DEFAULTS = { perPage: 4, mode: "static", seconds: 15, buttons: true, sound: true };
const POLL_MS = 8000;

function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; } catch { return DEFAULTS; }
}
function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* aparelho sem armazenamento: vale até recarregar */ }
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25].forEach((t) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.25, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1000);
  } catch { /* sem som neste aparelho */ }
}

function waitColor(min) {
  if (min < 10) return "#4ADE80";
  if (min < 20) return "#FBBF24";
  return "#F87171";
}

function OrderCard({ order, now, showButtons, onAdvance, busy }) {
  const min = Math.max(0, Math.floor((now - new Date(order.created_at).getTime()) / 60000));
  const preparing = order.status === "preparing";
  const items = order.items?.length ? order.items : null;
  return (
    <Box data-testid="kitchen-order" sx={{
      background: "#1F1F23", borderRadius: "16px", p: 2, display: "flex", flexDirection: "column", gap: 1.2, minHeight: 0,
      border: "3px solid", borderColor: preparing ? "#FBBF24" : min < 2 ? "#60A5FA" : "#2E2E33", overflow: "hidden",
    }}>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1.2 }}>
        <Typography sx={{ fontSize: "clamp(26px, 3.2vw, 44px)", fontWeight: 900, color: "#fff", lineHeight: 1 }}>#{order.number}</Typography>
        <Typography sx={{ fontSize: "clamp(13px, 1.3vw, 18px)", fontWeight: 800, color: order.order_type === "local" ? "#C4B5FD" : "#93C5FD" }}>
          {order.order_type === "local" ? "🏪 LOCAL" : "🛵 ENTREGA"}
        </Typography>
        <Typography sx={{ ml: "auto", fontSize: "clamp(18px, 2vw, 28px)", fontWeight: 900, color: waitColor(min) }}>{min} min</Typography>
      </Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1 }}>
        <Typography sx={{ fontSize: "clamp(15px, 1.5vw, 22px)", fontWeight: 700, color: "#D4D4D8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {order.customer_name}
        </Typography>
        <Typography sx={{ fontSize: "clamp(12px, 1.1vw, 15px)", fontWeight: 800, color: preparing ? "#FBBF24" : "#60A5FA", whiteSpace: "nowrap" }}>
          {preparing ? "EM PREPARO" : "NOVO"}
        </Typography>
      </Box>
      <Box sx={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1, borderTop: "1px solid #2E2E33", pt: 1 }}>
        {items ? items.map((it, i) => (
          <Box key={i}>
            <Typography sx={{ fontSize: "clamp(17px, 1.8vw, 26px)", fontWeight: 800, color: "#fff", lineHeight: 1.2 }}>
              {it.quantity}x {it.name}{it.variant ? ` (${it.variant})` : ""}
            </Typography>
            {it.addons?.length > 0 && (
              <Typography sx={{ fontSize: "clamp(15px, 1.5vw, 21px)", fontWeight: 800, color: "#FDE047" }}>+ {it.addons.join(", ")}</Typography>
            )}
            {it.notes && <Typography sx={{ fontSize: "clamp(15px, 1.5vw, 21px)", fontWeight: 800, color: "#FCA5A5" }}>⚠ {it.notes}</Typography>}
          </Box>
        )) : (
          <Typography sx={{ fontSize: "clamp(16px, 1.6vw, 22px)", fontWeight: 700, color: "#fff", whiteSpace: "pre-wrap" }}>{order.items_text || "—"}</Typography>
        )}
        {order.notes && (
          <Typography sx={{ fontSize: "clamp(14px, 1.4vw, 19px)", fontWeight: 700, color: "#FCA5A5", background: "#3F1D1D", borderRadius: "8px", px: 1, py: 0.5 }}>
            Obs.: {order.notes}
          </Typography>
        )}
      </Box>
      {showButtons && (
        <Button fullWidth variant="contained" disabled={busy} onClick={() => onAdvance(order)}
          sx={{ py: 1.4, fontSize: "clamp(15px, 1.4vw, 20px)", fontWeight: 900, borderRadius: "12px",
            background: preparing ? "#16A34A" : "#2563EB", "&:hover": { background: preparing ? "#15803D" : "#1D4ED8" } }}>
          {preparing ? "Pronto" : "Iniciar preparo"}
        </Button>
      )}
    </Box>
  );
}

function SettingsDialog({ open, value, onClose, onChange }) {
  const [form, setForm] = useState(value);
  useEffect(() => { if (open) setForm(value); }, [open, value]); // eslint-disable-line react-hooks/set-state-in-effect
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>Ajustes desta tela</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
        <TextField select label="Pedidos por tela" value={form.perPage} onChange={(e) => setForm({ ...form, perPage: Number(e.target.value) })}>
          {[3, 4, 5].map((n) => <MenuItem key={n} value={n}>{n} pedidos</MenuItem>)}
        </TextField>
        <TextField select label="Quando houver mais pedidos" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
          <MenuItem value="static">Fixo: mostra os mais antigos</MenuItem>
          <MenuItem value="rotate">Alternar as páginas por tempo</MenuItem>
        </TextField>
        {form.mode === "rotate" && (
          <TextField select label="Trocar de página a cada" value={form.seconds} onChange={(e) => setForm({ ...form, seconds: Number(e.target.value) })}>
            {[10, 15, 20, 30, 60].map((n) => <MenuItem key={n} value={n}>{n} segundos</MenuItem>)}
          </TextField>
        )}
        <FormControlLabel control={<Switch checked={form.buttons} onChange={(e) => setForm({ ...form, buttons: e.target.checked })} />}
          label="Botões “Iniciar preparo” e “Pronto”" />
        <FormControlLabel control={<Switch checked={form.sound} onChange={(e) => setForm({ ...form, sound: e.target.checked })} />}
          label="Som quando chega pedido novo" />
        <Typography sx={{ fontSize: 12, color: "#78716C" }}>Os ajustes ficam salvos neste aparelho.</Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={() => { onChange(form); onClose(); }}>Salvar</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function KitchenDisplay() {
  const { token } = useParams();
  const [board, setBoard] = useState(null);
  const [fatal, setFatal] = useState("");
  const [offline, setOffline] = useState(false);
  const [settings, setSettings] = useState(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [page, setPage] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState("");
  const [full, setFull] = useState(false);
  const known = useRef(null);
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  // Sem login, os avisos de conexão desta tela vão para o log pelo link dela.
  useEffect(() => { setKitchenToken(token); return () => setKitchenToken(null); }, [token]);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc("kitchen_board", { p_token: token || null });
      if (error) {
        // Link trocado/inválido ou sem permissão: não adianta tentar de novo.
        if (/inválido|permissão|Could not find/i.test(error.message)) setFatal(error.message.includes("Could not find")
          ? "O banco ainda não foi atualizado para o modo cozinha." : error.message);
        else setOffline(true);
        return;
      }
      setOffline(false);
      setFatal("");
      const ids = new Set((data?.orders || []).map((o) => o.id));
      if (known.current && settingsRef.current.sound && [...ids].some((id) => !known.current.has(id))) beep();
      known.current = ids;
      setBoard(data);
    } catch {
      setOffline(true);
    }
  }, [token]);

  useEffect(() => {
    load(); // eslint-disable-line react-hooks/set-state-in-effect
    const poll = setInterval(load, POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 15000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [load]);

  // Tela sempre acesa (quando o aparelho permite).
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let lock = null;
    const acquire = () => navigator.wakeLock.request("screen").then((l) => { lock = l; }).catch(() => {});
    acquire();
    const onVisible = () => { if (document.visibilityState === "visible") acquire(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { document.removeEventListener("visibilitychange", onVisible); lock?.release().catch(() => {}); };
  }, []);

  useEffect(() => {
    const onChange = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const orders = board?.orders || [];
  const perPage = settings.perPage;
  const pages = Math.max(1, Math.ceil(orders.length / perPage));
  const rotating = settings.mode === "rotate" && pages > 1;
  const safePage = rotating ? page % pages : 0;

  useEffect(() => {
    if (!rotating) return;
    const t = setInterval(() => setPage((p) => p + 1), settings.seconds * 1000);
    return () => clearInterval(t);
  }, [rotating, settings.seconds]);

  const visible = orders.slice(safePage * perPage, safePage * perPage + perPage);
  const hidden = orders.length - visible.length;

  const advance = async (order) => {
    if (busyId) return;
    setBusyId(order.id); setActionError("");
    try {
      const { error } = await supabase.rpc("kitchen_advance", { p_order_id: order.id, p_token: token || null });
      if (error) setActionError(error.message);
    } catch {
      setActionError("Sem conexão. Tente de novo.");
    } finally {
      setBusyId(null);
    }
    load();
  };

  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const changeSettings = (s) => { setSettings(s); saveSettings(s); setPage(0); };

  if (fatal) {
    return (
      <Box sx={{ minHeight: "100vh", background: "#111114", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", p: 3, textAlign: "center" }}>
        <Box>
          <Typography sx={{ fontSize: 26, fontWeight: 900, mb: 1 }}>Modo cozinha</Typography>
          <Typography sx={{ fontSize: 18, color: "#FCA5A5" }}>{fatal}</Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ height: "100vh", background: "#111114", color: "#fff", display: "flex", flexDirection: "column", p: { xs: 1.5, md: 2 }, gap: 1.5, overflow: "hidden" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
        <Typography sx={{ fontSize: "clamp(18px, 2vw, 28px)", fontWeight: 900 }}>{board?.company || "Cozinha"}</Typography>
        <Typography sx={{ fontSize: "clamp(14px, 1.4vw, 20px)", fontWeight: 700, color: "#A1A1AA" }}>
          {orders.length} {orders.length === 1 ? "pedido" : "pedidos"} para preparar
        </Typography>
        {rotating && <Typography sx={{ fontSize: "clamp(14px, 1.4vw, 20px)", fontWeight: 800, color: "#FBBF24" }}>Página {safePage + 1} de {pages}</Typography>}
        {offline && <Typography sx={{ fontSize: 15, fontWeight: 800, color: "#F87171" }}>Sem conexão: tentando de novo…</Typography>}
        <Typography sx={{ ml: "auto", fontSize: "clamp(18px, 2vw, 28px)", fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>
          {new Date(now).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
        </Typography>
        <IconButton aria-label="Ajustes da tela" onClick={() => setShowSettings(true)} sx={{ color: "#A1A1AA" }}><SettingsIcon /></IconButton>
        <IconButton aria-label={full ? "Sair da tela cheia" : "Tela cheia"} onClick={toggleFull} sx={{ color: "#A1A1AA" }}>
          {full ? <FullscreenExitIcon /> : <FullscreenIcon />}
        </IconButton>
      </Box>
      {actionError && (
        <Typography onClick={() => setActionError("")} sx={{ background: "#7F1D1D", borderRadius: "10px", px: 2, py: 1, fontWeight: 700, cursor: "pointer" }}>{actionError}</Typography>
      )}

      {!board ? (
        <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}><CircularProgress sx={{ color: "#fff" }} /></Box>
      ) : orders.length === 0 ? (
        <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Typography sx={{ fontSize: "clamp(22px, 3vw, 40px)", fontWeight: 800, color: "#52525B" }}>Nenhum pedido para preparar</Typography>
        </Box>
      ) : (
        <Box sx={{ flex: 1, minHeight: 0, display: "grid", gap: 1.5,
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: `repeat(${perPage}, minmax(0, 1fr))` },
          overflowY: { xs: "auto", lg: "hidden" } }}>
          {visible.map((o) => (
            <OrderCard key={o.id} order={o} now={now} showButtons={settings.buttons} onAdvance={advance} busy={busyId === o.id} />
          ))}
        </Box>
      )}

      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, minHeight: 44, flexWrap: "wrap" }}>
        {!rotating && hidden > 0 && (
          <Typography sx={{ fontSize: "clamp(15px, 1.5vw, 22px)", fontWeight: 900, color: "#FBBF24" }}>+ {hidden} na fila</Typography>
        )}
        {(board?.ready || []).length > 0 && (
          <>
            <Typography sx={{ fontSize: "clamp(14px, 1.3vw, 18px)", fontWeight: 900, color: "#4ADE80" }}>PRONTOS:</Typography>
            {board.ready.map((r) => (
              <Box key={r.number} sx={{ px: 1.2, py: 0.4, borderRadius: "8px", background: "#14532D", fontWeight: 800, fontSize: "clamp(13px, 1.2vw, 17px)" }}>
                #{r.number} {r.customer_name}
              </Box>
            ))}
          </>
        )}
      </Box>

      <SettingsDialog open={showSettings} value={settings} onClose={() => setShowSettings(false)} onChange={changeSettings} />
    </Box>
  );
}
