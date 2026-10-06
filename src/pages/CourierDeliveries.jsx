import { useState, useEffect, useCallback, useRef } from "react";
import {
  Box, Typography, Button, CircularProgress, Alert, TextField, MenuItem, Chip,
} from "@mui/material";
import { MapContainer, TileLayer, Marker, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import CheckIcon from "@mui/icons-material/Check";
import DirectionsIcon from "@mui/icons-material/Directions";
import NearMeIcon from "@mui/icons-material/NearMe";
import PhoneIcon from "@mui/icons-material/Phone";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
import AppShell from "../components/AppShell";
import CollaboratorNav from "../components/CollaboratorNav";
import supabase from "../services/supabase";
import { useAuth } from "../context/AuthContext";
import {
  ORDER_STATUS, PAYMENT_LABEL, money, orderAddress, googleMapsUrl, wazeUrl, fetchRouteOptions,
  distanceToPath, ROUTE_COLORS, ROUTE_NAMES, GOOGLE_MAX_WAYPOINTS,
} from "../utils/delivery";
import { fetchMultiStopRoute } from "../utils/geocoding";

const PING_INTERVAL_MS = 15000;
const PROBLEMS = ["Cliente não atende", "Endereço não encontrado", "Cliente recusou o pedido", "Pedido danificado", "Outro"];

const meIcon = new L.DivIcon({
  className: "",
  html: `<div style="width:16px;height:16px;border-radius:50%;background:#4F5BA6;border:3px solid #fff;box-shadow:0 0 8px rgba(79,91,166,.6);transform:translate(-8px,-8px)"></div>`,
  iconSize: [0, 0],
});
const storeIcon = new L.DivIcon({
  className: "",
  html: `<div style="transform:translate(-11px,-11px);width:22px;height:22px;border-radius:6px;background:#1C1917;color:#fff;font:700 12px sans-serif;display:flex;align-items:center;justify-content:center;border:2px solid #fff">L</div>`,
  iconSize: [0, 0],
});
const numberIcon = (n) => new L.DivIcon({
  className: "",
  html: `<div style="width:22px;height:22px;border-radius:50%;background:#B0463D;color:#fff;font:700 12px sans-serif;display:flex;align-items:center;justify-content:center;transform:translate(-11px,-11px);border:2px solid #fff">${n}</div>`,
  iconSize: [0, 0],
});

// Mapa da saída inteira (loja → paradas na ordem), antes de iniciar.
function RunOverview({ store, orders }) {
  const [route, setRoute] = useState(null);
  const stops = orders.filter((o) => o.lat && o.lng);
  const key = [store?.lat, store?.lng, ...stops.map((o) => o.id)].join("|");
  useEffect(() => {
    let alive = true;
    fetchMultiStopRoute([store, ...stops]).then((r) => { if (alive) setRoute(r); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!stops.length) return null;
  const points = [...(store ? [[store.lat, store.lng]] : []), ...stops.map((o) => [o.lat, o.lng])];
  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ height: 260, borderRadius: "14px", overflow: "hidden", border: "1px solid #E7E5E4" }}>
        <MapContainer center={points[0]} zoom={13} style={{ height: "100%", width: "100%" }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
          <FitBounds points={route?.path?.length ? [points[0], ...points.slice(1), route.path[Math.floor(route.path.length / 2)]] : points} />
          {route && <Polyline positions={route.path} pathOptions={{ color: "#1C1917", weight: 5, opacity: 0.85 }} />}
          {store && <Marker position={[store.lat, store.lng]} icon={storeIcon} />}
          {stops.map((o) => <Marker key={o.id} position={[o.lat, o.lng]} icon={numberIcon(o.stop_sequence)} />)}
        </MapContainer>
      </Box>
      {route && (
        <Typography sx={{ fontSize: 12.5, color: "#57534E", mt: 0.6, fontWeight: 600 }}>
          Trajeto {store ? "da loja " : ""}por {stops.length} parada(s): {(route.distanceMeters / 1000).toFixed(1)} km · cerca de {Math.round(route.durationSeconds / 60)} min
        </Typography>
      )}
      {!store && <Typography sx={{ fontSize: 11.5, color: "#A8A29E", mt: 0.4 }}>A empresa ainda não cadastrou o endereço da loja; o trajeto começa na 1ª parada.</Typography>}
    </Box>
  );
}

const destIcon = new L.DivIcon({
  className: "",
  html: `<div style="width:18px;height:18px;border-radius:50%;background:#1C1917;border:3px solid #fff;box-shadow:0 0 0 2px #1C1917;transform:translate(-9px,-9px)"></div>`,
  iconSize: [0, 0],
});

function FitBounds({ points }) {
  const map = useMap();
  const key = points.map((p) => p.join(",")).join("|");
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 200);
    if (points.length >= 2) map.fitBounds(points, { padding: [30, 30], animate: false });
    else if (points.length === 1) map.setView(points[0], 15, { animate: false });
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

// Mantém a tela ligada durante a saída: no PWA, com a tela apagada o
// navegador para de mandar a posição (o app nativo da Fase 2 resolve isso).
function useWakeLock(active) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock = null;
    const acquire = () => navigator.wakeLock.request("screen").then((l) => { lock = l; }).catch(() => {});
    acquire();
    const onVisible = () => { if (document.visibilityState === "visible") acquire(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { document.removeEventListener("visibilitychange", onVisible); lock?.release().catch(() => {}); };
  }, [active]);
}

// Expediente: com ele aberto (e sem pausa) o motoboy recebe as saídas do
// despacho automático. Pausar devolve a saída ainda não iniciada.
function ShiftBar({ shift, unavailable, onChange, onError }) {
  const [busy, setBusy] = useState(false);
  if (shift === undefined && unavailable) {
    // Sem o expediente o motoboy não recebe saídas automáticas: avisa em vez de sumir com o botão.
    return (
      <Alert severity="warning" sx={{ mb: 2 }}
        action={<Button size="small" color="inherit" onClick={onChange}>Tentar de novo</Button>}>
        Não foi possível carregar o expediente. Se continuar, avise o gestor: o banco de dados pode estar desatualizado.
      </Alert>
    );
  }
  if (shift === undefined) return null;
  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await fn();
      if (error) onError(error.message.includes("function") ? "Expediente indisponível: o banco ainda não foi atualizado." : error.message);
    } catch {
      onError("Sem conexão. Confira a internet e tente de novo.");
    } finally {
      setBusy(false);
    }
    onChange();
  };
  const since = shift ? new Date(shift.started_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
  const on = shift && !shift.paused;
  return (
    <Box sx={{ p: 1.5, mb: 2, borderRadius: "12px", border: "1px solid", borderColor: on ? "#C9CDEB" : shift ? "#E9D9BF" : "#E7E5E4",
      background: on ? "#EEF0FA" : shift ? "#FBF3EA" : "#fff" }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}>
        <Box>
          <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: on ? "#4F5BA6" : shift ? "#B0793D" : "#57534E" }}>
            {!shift ? "Fora do expediente" : shift.paused ? "Em pausa: não recebe novas saídas" : `Em expediente desde ${since}`}
          </Typography>
          {shift?.paused && shift.paused_reason && <Typography sx={{ fontSize: 11.5, color: "#78716C" }}>{shift.paused_reason}</Typography>}
          {on && <Typography sx={{ fontSize: 11.5, color: "#78716C" }}>As saídas chegam sozinhas quando você estiver livre.</Typography>}
        </Box>
        <Box sx={{ display: "flex", gap: 1 }}>
          {shift && (
            <Button size="small" variant={shift.paused ? "contained" : "outlined"} disabled={busy}
              onClick={() => run(() => supabase.rpc("set_shift_paused", { p_paused: !shift.paused }))}>
              {shift.paused ? "Voltar a receber" : "Pausar"}
            </Button>
          )}
          <Button size="small" variant={shift ? "outlined" : "contained"} color={shift ? "error" : "primary"} disabled={busy}
            onClick={() => {
              if (shift && !window.confirm("Encerrar o expediente? Você para de receber saídas e a saída ainda não iniciada volta para a fila.")) return;
              run(() => supabase.rpc(shift ? "end_shift" : "start_shift"));
            }}>
            {shift ? "Encerrar expediente" : "Iniciar expediente"}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}

export default function CourierDeliveries() {
  const { profile } = useAuth();
  const [runs, setRuns] = useState(null);
  const [company, setCompany] = useState(null);
  const [myPos, setMyPos] = useState(null);
  const [geoError, setGeoError] = useState("");
  const [options, setOptions] = useState([]);
  const [choice, setChoice] = useState(0);
  const [offRoute, setOffRoute] = useState(false);
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState("");
  const [showProblem, setShowProblem] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [shift, setShift] = useState(undefined);
  const [shiftUnavailable, setShiftUnavailable] = useState(false);
  const lastPing = useRef(0);
  const routeFrom = useRef(null);
  const offRef = useRef(false);

  const load = useCallback(async () => {
    const [r, c, s] = await Promise.all([
      supabase.from("delivery_runs").select("*, orders:delivery_orders(*)").eq("courier_id", profile.id)
        .in("status", ["planned", "in_progress"]).order("created_at"),
      supabase.rpc("my_company_settings").maybeSingle(),
      supabase.from("courier_shifts").select("id, started_at, paused, paused_reason").eq("courier_id", profile.id).is("ended_at", null).maybeSingle(),
    ]);
    // Falha de rede: mantém o expediente que já estava na tela.
    if (!s.error) setShift(s.data || null);
    setShiftUnavailable(Boolean(s.error));
    if (c.data) setCompany(c.data);
    // Falha: mantém a saída que já estava na tela; a próxima recarga tenta de novo.
    if (r.error) { setRuns((prev) => prev ?? []); return; }
    setRuns((r.data || []).map((run) => ({ ...run, orders: (run.orders || []).sort((a, b) => a.stop_sequence - b.stop_sequence) })));
  }, [profile.id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const channel = supabase.channel(`courier-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "delivery_runs", filter: `courier_id=eq.${profile.id}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "delivery_orders", filter: `courier_id=eq.${profile.id}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "courier_shifts", filter: `courier_id=eq.${profile.id}` }, () => load())
      .subscribe();
    // Rede de segurança do despacho automático (o banco também despacha sozinho).
    const interval = setInterval(() => { supabase.rpc("auto_dispatch_tick").then(() => load()); }, 30000);
    return () => { clearInterval(interval); supabase.removeChannel(channel); };
  }, [profile.id, load]);

  const activeRun = runs?.find((r) => r.status === "in_progress") || null;
  const plannedRun = !activeRun ? runs?.find((r) => r.status === "planned") || null : null;
  const strict = Boolean(activeRun?.strict_route);
  const currentStop = activeRun?.orders.find((o) => o.status === "on_route") || null;
  const remainingStops = activeRun?.orders.filter((o) => o.status === "on_route") || [];
  useWakeLock(Boolean(activeRun));
  const store = company?.store_lat ? { lat: company.store_lat, lng: company.store_lng } : null;
  // De onde sai o trecho atual: a parada anterior (ou a loja, na 1ª). Se o
  // motoboy pedir para recalcular, sai de onde ele está.
  const prevStop = currentStop
    ? [...(activeRun?.orders || [])].filter((o) => o.stop_sequence < currentStop.stop_sequence && o.lat && o.lng).pop() || null
    : null;
  const [legOrigin, setLegOrigin] = useState(null);

  // ── GPS ────────────────────────────────────────────────────────────────
  const gpsOn = Boolean(runs?.length || shift);
  useEffect(() => {
    if (!gpsOn) return;
    if (!window.isSecureContext || !navigator.geolocation) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGeoError("O GPS só funciona em conexão segura (https).");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => { setGeoError(""); setMyPos({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, speed: pos.coords.speed }); },
      (err) => setGeoError(err.code === err.PERMISSION_DENIED ? "Permissão de localização negada. Ative a localização para este site." : "Não foi possível obter sua localização."),
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [gpsOn]);

  // Envia posição (última posição + histórico) durante a saída e o
  // expediente; o km do acerto vem desse histórico.
  useEffect(() => {
    if ((!activeRun && !shift) || !myPos) return;
    const now = Date.now();
    if (now - lastPing.current < PING_INTERVAL_MS) return;
    lastPing.current = now;
    const at = new Date().toISOString();
    supabase.from("profiles").update({ last_lat: myPos.lat, last_lng: myPos.lng, last_location_at: at }).eq("id", profile.id).then(() => {});
    supabase.from("location_pings").insert({
      company_id: profile.company_id, courier_id: profile.id, run_id: activeRun?.id ?? null,
      lat: myPos.lat, lng: myPos.lng, accuracy: myPos.accuracy, speed: myPos.speed, off_route: offRef.current,
    }).then(() => {});
  }, [myPos, activeRun, shift, profile.id, profile.company_id]);

  // ── 3 opções de rota até a parada atual ─────────────────────────────────
  // A rota é calculada uma vez por parada (a partir de onde o motoboy está
  // ao começar o trecho). Recalcular sozinho ao se afastar esconderia o
  // desvio; fora do modo rota exata, o motoboy pode recalcular pelo botão.
  const [recalc, setRecalc] = useState(0);
  useEffect(() => {
    if (!currentStop?.lat) return;
    const origin = recalc > 0 && myPos ? myPos : (prevStop || store || myPos);
    if (!origin) return;
    const key = `${currentStop.id}:${recalc}`;
    if (routeFrom.current?.key === key) return;
    const stopChanged = routeFrom.current?.key?.split(":")[0] !== String(currentStop.id);
    routeFrom.current = { key };
    // Parada nova: some com a rota antiga (senão acusaria desvio da rota errada).
    if (stopChanged) setOptions([]);
    fetchRouteOptions(origin, currentStop).then((opts) => {
      if (routeFrom.current?.key !== key) return; // já mudou de parada
      // Sem rota (sem internet): libera para tentar de novo na próxima posição.
      if (!opts?.length) routeFrom.current = null;
      setLegOrigin(origin);
      setOptions(opts || []);
      setChoice(strict ? 0 : Math.min(currentStop.route_choice ?? 0, Math.max((opts?.length || 1) - 1, 0)));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStop, myPos, strict, recalc, prevStop?.id, store?.lat, store?.lng]);

  // ── Desvio de rota ──────────────────────────────────────────────────────
  useEffect(() => {
    const path = options[choice]?.path;
    if (!activeRun || !myPos || !path) return;
    const limit = company?.off_route_meters || 250;
    const d = distanceToPath(myPos, path);
    const isOff = d > limit;
    if (isOff && !offRef.current) {
      supabase.rpc("notify_run_off_route", { p_run: activeRun.id, p_meters: Math.round(d) }).then(() => {});
      navigator.vibrate?.([300, 100, 300]);
    }
    offRef.current = isOff;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOffRoute(isOff);
  }, [myPos, options, choice, activeRun, company?.off_route_meters]);

  const pickRoute = async (i) => {
    if (strict && i !== 0) return;
    setChoice(i);
    if (currentStop) await supabase.rpc("choose_route", { p_order_id: currentStop.id, p_choice: i });
  };

  const call = async (fn, okMsg) => {
    if (busy) return null;
    setBusy(true); setMsg(null);
    let data, error;
    try {
      ({ data, error } = await fn());
    } catch {
      error = { message: "Sem conexão. Confira a internet e tente de novo." };
    } finally {
      setBusy(false);
    }
    if (error) { setMsg({ type: "error", text: error.message }); return null; }
    if (okMsg) setMsg({ type: "success", text: okMsg });
    load();
    return data ?? true;
  };

  const complete = async () => {
    const result = await call(() => supabase.rpc("complete_delivery", {
      p_order_id: currentStop.id, p_code: company?.feature_delivery_code ? code.trim() : null,
      p_lat: myPos?.lat ?? null, p_lng: myPos?.lng ?? null,
    }));
    if (result === "ok") { setCode(""); setOptions([]); setMsg({ type: "success", text: "Entrega finalizada!" }); }
    else if (result === "wrong_code") setMsg({ type: "error", text: "Código incorreto. Confira com o cliente." });
    else if (result === "locked") setMsg({ type: "error", text: "Código bloqueado após 5 tentativas. A empresa foi avisada; aguarde a liberação." });
  };

  const sendProblem = async () => {
    if (await call(() => supabase.rpc("report_problem", { p_order_id: currentStop.id, p_reason: problem }), "Problema enviado para a empresa.")) {
      setShowProblem(false); setProblem(""); setOptions([]);
    }
  };

  const mapPoints = [];
  if (myPos) mapPoints.push([myPos.lat, myPos.lng]);
  if (legOrigin) mapPoints.push([legOrigin.lat, legOrigin.lng]);
  if (currentStop?.lat) mapPoints.push([currentStop.lat, currentStop.lng]);

  if (runs === null) return <AppShell title="Minhas entregas"><CollaboratorNav /><Box sx={{ py: 8, textAlign: "center" }}><CircularProgress size={26} /></Box></AppShell>;

  return (
    <AppShell title="Minhas entregas">
      <CollaboratorNav />
      <ShiftBar shift={shift} unavailable={shiftUnavailable} onChange={load} onError={(text) => setMsg({ type: "error", text })} />
      {msg && <Alert severity={msg.type} sx={{ mb: 2 }} onClose={() => setMsg(null)}>{msg.text}</Alert>}
      {geoError && <Alert severity="warning" sx={{ mb: 2 }}>{geoError}</Alert>}

      {!activeRun && !plannedRun && (
        <Box sx={{ py: 8, textAlign: "center", color: "#A8A29E", fontSize: 14 }}>{shift && !shift.paused ? "Aguardando pedidos. A próxima saída aparece aqui sozinha." : "Nenhuma entrega no momento. Você será avisado quando chegar uma saída."}</Box>
      )}

      {plannedRun && (
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: 17, mb: 1 }}>Nova saída: {plannedRun.orders.length} parada(s)</Typography>
          {plannedRun.auto && (
            <Alert severity="info" sx={{ mb: 1 }}>Saída montada automaticamente. Inicie logo: se demorar, ela passa para outro motoboy.</Alert>
          )}
          <RunOverview store={store} orders={plannedRun.orders} />
          {plannedRun.orders.map((o) => (
            <Box key={o.id} sx={{ p: 1.5, mb: 1, border: "1px solid #E7E5E4", borderRadius: "12px", background: "#fff" }}>
              <Typography sx={{ fontWeight: 700, fontSize: 14 }}>{o.stop_sequence}. #{o.number} · {o.customer_name}</Typography>
              <Typography sx={{ fontSize: 12.5, color: "#78716C" }}>{orderAddress(o) || "Sem endereço"}</Typography>
            </Box>
          ))}
          <Button fullWidth variant="contained" size="large" startIcon={<PlayArrowIcon />} sx={{ mt: 1, py: 1.4 }} disabled={busy}
            onClick={() => call(() => supabase.rpc("start_run", { p_run: plannedRun.id }), "Saída iniciada. Boa entrega!")}>
            Iniciar saída
          </Button>
        </Box>
      )}

      {activeRun && currentStop && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Typography sx={{ fontWeight: 800, fontSize: 17 }}>
              Parada {currentStop.stop_sequence} de {activeRun.orders.length}
            </Typography>
            {strict && <Chip size="small" label="Rota exata" sx={{ fontWeight: 700 }} />}
          </Box>

          <Box sx={{ p: 1.8, border: "1px solid #E7E5E4", borderRadius: "14px", background: "#fff" }}>
            <Typography sx={{ fontWeight: 800, fontSize: 15 }}>#{currentStop.number} · {currentStop.customer_name}</Typography>
            <Typography sx={{ fontSize: 13, color: "#57534E", mt: 0.3 }}>{orderAddress(currentStop) || "Sem endereço"}</Typography>
            <Typography sx={{ fontSize: 13, mt: 0.6, fontWeight: 700 }}>
              {money(currentStop.total)} · {PAYMENT_LABEL[currentStop.payment_method] || "—"}
              {currentStop.change_for ? ` · levar troco p/ ${money(currentStop.change_for)}` : ""}
            </Typography>
            {currentStop.notes && <Typography sx={{ fontSize: 12.5, color: "#78716C", fontStyle: "italic", mt: 0.4 }}>{currentStop.notes}</Typography>}
            {currentStop.customer_phone && (
              <Button size="small" startIcon={<PhoneIcon />} href={`tel:${currentStop.customer_phone}`} sx={{ mt: 0.5, px: 0 }}>Ligar para o cliente</Button>
            )}
          </Box>

          {offRoute && (
            <Alert severity="error" variant="filled">
              Você saiu do trajeto{strict ? " definido pela empresa" : " escolhido"}. A empresa foi avisada.
            </Alert>
          )}

          {currentStop.lat ? (
            <Box sx={{ height: 300, borderRadius: "14px", overflow: "hidden", border: "1px solid #E7E5E4" }}>
              <MapContainer center={[currentStop.lat, currentStop.lng]} zoom={14} style={{ height: "100%", width: "100%" }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
                <FitBounds points={mapPoints} />
                {options.map((o, i) => (strict && i !== 0) || i === choice ? null : (
                  <Polyline key={i} positions={o.path} eventHandlers={{ click: () => pickRoute(i) }}
                    pathOptions={{ color: ROUTE_COLORS[i], weight: 4, opacity: 0.35, dashArray: "6 6" }} />
                ))}
                {options[choice] && (
                  <Polyline positions={options[choice].path} pathOptions={{ color: offRoute ? "#B0463D" : ROUTE_COLORS[choice], weight: 6, opacity: 0.9 }} />
                )}
                <Marker position={[currentStop.lat, currentStop.lng]} icon={destIcon} />
                {store && <Marker position={[store.lat, store.lng]} icon={storeIcon} />}
                {myPos && <Marker position={[myPos.lat, myPos.lng]} icon={meIcon} />}
              </MapContainer>
            </Box>
          ) : (
            <Alert severity="info">Este endereço não tem localização no mapa. Use o endereço escrito.</Alert>
          )}

          {options.length > 0 && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.8 }}>
              {options.map((o, i) => {
                const locked = strict && i !== 0;
                return (
                  <Box key={i} onClick={() => pickRoute(i)}
                    sx={{
                      p: 1.2, borderRadius: "12px", cursor: locked ? "not-allowed" : "pointer", opacity: locked ? 0.45 : 1,
                      border: `2px solid ${i === choice ? ROUTE_COLORS[i] : "#E7E5E4"}`, background: "#fff",
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                    }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Box sx={{ width: 12, height: 12, borderRadius: "50%", background: ROUTE_COLORS[i] }} />
                      <Typography sx={{ fontWeight: 700, fontSize: 13.5 }}>{ROUTE_NAMES[i]}</Typography>
                    </Box>
                    <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
                      {Math.round(o.durationSeconds / 60)} min · {(o.distanceMeters / 1000).toFixed(1)} km
                    </Typography>
                  </Box>
                );
              })}
              {options.length < 3 && <Typography sx={{ fontSize: 11.5, color: "#A8A29E" }}>Neste trajeto só existe{options.length > 1 ? "m" : ""} {options.length} caminho{options.length > 1 ? "s" : ""} diferente{options.length > 1 ? "s" : ""}.</Typography>}
              {strict
                ? <Typography sx={{ fontSize: 11.5, color: "#A8A29E" }}>Esta empresa exige seguir a rota principal, navegando por este mapa.</Typography>
                : <Button size="small" sx={{ alignSelf: "flex-start" }} onClick={() => setRecalc((n) => n + 1)}>Recalcular a partir daqui</Button>}
            </Box>
          )}

          {!strict && currentStop.lat && (
            <Box sx={{ display: "flex", gap: 1 }}>
              <Button fullWidth variant="outlined" startIcon={<DirectionsIcon />} sx={{ fontWeight: 700 }}
                onClick={() => window.open(googleMapsUrl(remainingStops), "_blank", "noopener,noreferrer")}>
                Google Maps{remainingStops.length > 1 ? ` (${Math.min(remainingStops.length, GOOGLE_MAX_WAYPOINTS + 1)} paradas)` : ""}
              </Button>
              <Button fullWidth variant="outlined" startIcon={<NearMeIcon />} sx={{ fontWeight: 700 }}
                onClick={() => window.open(wazeUrl(currentStop), "_blank", "noopener,noreferrer")}>
                Waze
              </Button>
            </Box>
          )}

          <Box sx={{ p: 1.8, border: "1px solid #E7E5E4", borderRadius: "14px", background: "#fff", display: "flex", flexDirection: "column", gap: 1.2 }}>
            {company?.feature_delivery_code && (
              <TextField label="Código de entrega (o cliente informa)" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                inputProps={{ inputMode: "numeric", style: { fontSize: 22, letterSpacing: "0.3em", textAlign: "center", fontWeight: 800 } }} />
            )}
            <Button variant="contained" color="success" size="large" startIcon={<CheckIcon />} sx={{ py: 1.3 }}
              disabled={busy || (company?.feature_delivery_code && code.length !== 4)} onClick={complete}>
              Finalizar entrega
            </Button>
            {!showProblem ? (
              <Button color="error" startIcon={<ReportProblemOutlinedIcon />} onClick={() => setShowProblem(true)}>Tive um problema</Button>
            ) : (
              <Box sx={{ display: "flex", gap: 1 }}>
                <TextField select size="small" label="O que aconteceu?" value={problem} onChange={(e) => setProblem(e.target.value)} sx={{ flex: 1 }}>
                  {PROBLEMS.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
                </TextField>
                <Button variant="contained" color="error" disabled={!problem || busy} onClick={sendProblem}>Enviar</Button>
              </Box>
            )}
          </Box>

          <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: "#78716C", mt: 1 }}>TODAS AS PARADAS</Typography>
          {activeRun.orders.map((o) => (
            <Box key={o.id} sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1, py: 0.8, borderBottom: "1px solid #F5F5F4" }}>
              <Typography sx={{ fontSize: 13, fontWeight: o.id === currentStop.id ? 800 : 500 }}>
                {o.stop_sequence}. #{o.number} {o.customer_name} · {o.address_neighborhood || "sem bairro"}
              </Typography>
              <Chip size="small" label={ORDER_STATUS[o.status].label} sx={{ height: 20, fontSize: 10.5, fontWeight: 700, background: ORDER_STATUS[o.status].bg, color: ORDER_STATUS[o.status].fg }} />
            </Box>
          ))}
          <Typography sx={{ fontSize: 11, color: "#A8A29E", textAlign: "center" }}>
            Sua localização é compartilhada com a empresa durante a saída. Mantenha o app aberto.
          </Typography>
        </Box>
      )}

      {activeRun && !currentStop && (
        <Box sx={{ py: 6, textAlign: "center" }}>
          <Typography sx={{ fontWeight: 700 }}>Paradas resolvidas.</Typography>
          <Typography sx={{ fontSize: 13, color: "#78716C" }}>
            {activeRun.orders.some((o) => o.status === "problem") ? "Aguarde a empresa resolver os pedidos com problema." : "Volte para a base."}
          </Typography>
        </Box>
      )}
    </AppShell>
  );
}
