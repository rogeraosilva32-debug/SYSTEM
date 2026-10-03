import { useState, useEffect, useCallback, useRef } from "react";
import { Box, Typography, CircularProgress } from "@mui/material";
import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";
import L from "leaflet";
import supabase from "../../services/supabase";
import { useAuth } from "../../context/AuthContext";
import { orderAddress } from "../../utils/delivery";

const courierIcon = (label, active) => new L.DivIcon({
  className: "",
  html: `<div style="display:flex;align-items:center;gap:4px;transform:translate(-8px,-8px)">
    <div style="flex-shrink:0;width:16px;height:16px;border-radius:50%;background:${active ? "#4F5BA6" : "#A8A29E"};border:3px solid #fff;box-shadow:0 0 6px rgba(0,0,0,.3)"></div>
    <div style="background:#fff;border:1px solid #E7E5E4;border-radius:8px;padding:1px 6px;font:700 11px sans-serif;white-space:nowrap">${label}</div>
  </div>`,
  iconSize: [0, 0],
});

const stopIcon = (n) => new L.DivIcon({
  className: "",
  html: `<div style="width:20px;height:20px;border-radius:50%;background:#1C1917;color:#fff;font:700 11px sans-serif;display:flex;align-items:center;justify-content:center;transform:translate(-10px,-10px);border:2px solid #fff">${n}</div>`,
  iconSize: [0, 0],
});

function timeAgo(iso) {
  if (!iso) return "sem posição";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  return `há ${Math.round(s / 3600)} h`;
}

// Mapa ao vivo: todos os motoboys da empresa, as paradas de cada saída em
// andamento e o trajeto percorrido (histórico de posições da saída).
export function LiveMapTab() {
  const { companyId } = useAuth();
  const [couriers, setCouriers] = useState(null);
  const [runs, setRuns] = useState([]);
  const [trails, setTrails] = useState({});
  const timer = useRef(null);

  const load = useCallback(async () => {
    const [c, r] = await Promise.all([
      supabase.from("profiles").select("id, name, last_lat, last_lng, last_location_at")
        .eq("company_id", companyId).eq("company_role", "collaborator"),
      supabase.from("delivery_runs").select("id, courier_id, status, started_at, orders:delivery_orders(id, number, customer_name, address_street, address_number, address_neighborhood, lat, lng, status, stop_sequence)")
        .eq("company_id", companyId).eq("status", "in_progress"),
    ]);
    setCouriers(c.data || []);
    setRuns(r.data || []);
    const ids = (r.data || []).map((x) => x.id);
    if (ids.length) {
      const { data } = await supabase.from("location_pings").select("run_id, lat, lng, recorded_at")
        .in("run_id", ids).order("recorded_at").limit(5000);
      const byRun = {};
      for (const p of data || []) (byRun[p.run_id] ||= []).push([p.lat, p.lng]);
      setTrails(byRun);
    } else {
      setTrails({});
    }
  }, [companyId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const schedule = () => { clearTimeout(timer.current); timer.current = setTimeout(load, 1000); };
    const channel = supabase.channel(`live-${companyId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `company_id=eq.${companyId}` }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "delivery_runs", filter: `company_id=eq.${companyId}` }, schedule)
      .subscribe();
    const interval = setInterval(load, 20000);
    return () => { clearTimeout(timer.current); clearInterval(interval); supabase.removeChannel(channel); };
  }, [companyId, load]);

  if (couriers === null) return <Box sx={{ py: 8, textAlign: "center" }}><CircularProgress size={26} /></Box>;

  const located = couriers.filter((c) => c.last_lat && c.last_lng);
  const allStops = runs.flatMap((r) => (r.orders || []).filter((o) => o.lat && o.lng));
  const center = located[0] ? [located[0].last_lat, located[0].last_lng]
    : allStops[0] ? [allStops[0].lat, allStops[0].lng] : [-15.78, -47.93];
  const activeCourierIds = new Set(runs.map((r) => r.courier_id));

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 280px" }, gap: 2 }}>
      <Box sx={{ height: { xs: 420, md: 600 }, borderRadius: "14px", overflow: "hidden", border: "1px solid #E7E5E4" }}>
        <MapContainer center={center} zoom={located.length || allStops.length ? 13 : 4} style={{ height: "100%", width: "100%" }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
          {Object.entries(trails).map(([runId, path]) => (
            <Polyline key={runId} positions={path} pathOptions={{ color: "#4F5BA6", weight: 3, opacity: 0.6 }} />
          ))}
          {runs.flatMap((r) => (r.orders || []).filter((o) => o.lat && o.lng && o.status === "on_route").map((o) => (
            <Marker key={o.id} position={[o.lat, o.lng]} icon={stopIcon(o.stop_sequence)}>
              <Popup>#{o.number} · {o.customer_name}<br />{orderAddress(o)}</Popup>
            </Marker>
          )))}
          {located.map((c) => (
            <Marker key={c.id} position={[c.last_lat, c.last_lng]} icon={courierIcon(c.name, activeCourierIds.has(c.id))}>
              <Popup>{c.name} · visto {timeAgo(c.last_location_at)}</Popup>
            </Marker>
          ))}
        </MapContainer>
      </Box>
      <Box>
        <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: "#78716C", mb: 1 }}>MOTOBOYS</Typography>
        {couriers.length === 0 && <Typography sx={{ fontSize: 13, color: "#A8A29E" }}>Nenhum motoboy cadastrado.</Typography>}
        {couriers.map((c) => {
          const run = runs.find((r) => r.courier_id === c.id);
          const pending = (run?.orders || []).filter((o) => o.status === "on_route").length;
          return (
            <Box key={c.id} sx={{ p: 1.2, mb: 1, border: "1px solid #E7E5E4", borderRadius: "12px", background: "#fff" }}>
              <Typography sx={{ fontWeight: 700, fontSize: 13.5 }}>{c.name}</Typography>
              <Typography sx={{ fontSize: 12, color: run ? "#4F5BA6" : "#A8A29E", fontWeight: 600 }}>
                {run ? `Em rota · ${pending} parada(s) restante(s)` : "Livre"} · {timeAgo(c.last_location_at)}
              </Typography>
            </Box>
          );
        })}
        <Typography sx={{ fontSize: 11, color: "#A8A29E", mt: 1 }}>
          A posição é enviada pelo celular do motoboy enquanto a saída está em andamento e o app está aberto.
        </Typography>
      </Box>
    </Box>
  );
}
