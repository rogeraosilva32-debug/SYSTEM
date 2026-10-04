import { useState, useEffect, useRef } from "react";
import { Box, TextField, Typography, Button, CircularProgress, Paper, MenuItem, MenuList } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { suggestAddresses, locateAddress, resolveSuggestion, lookupCep, addressProvider } from "../utils/geocoding";

const pinIcon = new L.DivIcon({
  className: "",
  html: `<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;background:#B0463D;border:3px solid #fff;box-shadow:0 0 6px rgba(0,0,0,.35);transform:translate(-9px,-20px) rotate(-45deg)"></div>`,
  iconSize: [0, 0],
});
const storeIcon = new L.DivIcon({
  className: "",
  html: `<div style="transform:translate(-11px,-11px);width:22px;height:22px;border-radius:6px;background:#1C1917;color:#fff;font:700 12px sans-serif;display:flex;align-items:center;justify-content:center;border:2px solid #fff">L</div>`,
  iconSize: [0, 0],
});

const PRECISION = {
  number: "Endereço localizado no mapa.",
  street: addressProvider === "google"
    ? "Localizada a rua, sem o número. Clique no mapa no ponto exato da entrega."
    : "Localizada a rua. O mapa gratuito não tem os números desta rua: o ponto fica no meio dela. Clique no mapa no ponto exato, se souber.",
  neighborhood: "Só o bairro foi localizado. Clique no mapa no ponto exato da entrega.",
  manual: "Ponto marcado no mapa.",
  suggestion: "Endereço localizado no mapa.",
};

function Recenter({ point }) {
  const map = useMap();
  useEffect(() => {
    if (point) map.setView(point, Math.max(map.getZoom(), 16));
    const t = setTimeout(() => map.invalidateSize(), 250);
    return () => clearTimeout(t);
  }, [map, point]);
  return null;
}

function ClickToPlace({ onPlace }) {
  useMapEvents({ click: (e) => onPlace(e.latlng.lat, e.latlng.lng) });
  return null;
}

/**
 * Endereço de entrega digitado (não usa o GPS do aparelho): sugestões
 * enquanto digita, campos separados, busca automática do ponto e mapa onde
 * dá para clicar ou arrastar o marcador para ajustar.
 * value = { street, number, neighborhood, city, state, lat, lng, precision }
 * store = { lat, lng, city, state } da loja (prioriza resultados perto dela).
 */
export default function DeliveryAddressField({ value, onChange, store, showNumber = true, mapHeight = 200 }) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");
  const [cep, setCep] = useState("");
  const [cepBusy, setCepBusy] = useState(false);
  const near = store?.lat ? { lat: store.lat, lng: store.lng } : null;
  const lastAuto = useRef("");

  const set = (patch) => onChange({ ...value, ...patch });
  const setText = (patch) => onChange({ ...value, ...patch, lat: null, lng: null, precision: null });

  // Sugestões do campo de busca (espera parar de digitar).
  useEffect(() => {
    const q = query.trim();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (q.length < 4) { setSuggestions([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const withCity = store?.city && !q.toLowerCase().includes(store.city.toLowerCase()) ? `${q}, ${store.city}` : q;
        let list = await suggestAddresses(withCity, near);
        if (!list.length && withCity !== q) list = await suggestAddresses(q, near);
        setSuggestions(list);
        setError("");
      } catch (e) {
        setError(e.message);
      } finally {
        setSearching(false);
      }
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const locate = async (auto = false) => {
    if (!value.street && !value.neighborhood) { if (!auto) setError("Digite ao menos a rua ou o bairro."); return; }
    setLocating(true); setError("");
    try {
      const r = await locateAddress({ ...value, city: value.city || store?.city, state: value.state || store?.state }, near);
      if (!r) { setError("Não achei esse endereço no mapa. Confira a rua e a cidade, ou clique no mapa no ponto da entrega."); return; }
      onChange({
        ...value,
        neighborhood: value.neighborhood || r.neighborhood,
        city: value.city || r.city,
        state: value.state || r.state,
        lat: r.lat, lng: r.lng, precision: r.precision,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLocating(false);
    }
  };

  // Busca o ponto sozinha quando rua (e número) param de mudar.
  useEffect(() => {
    if (value.lat || !value.street) return;
    const key = [value.street, value.number, value.neighborhood, value.city].join("|");
    if (key === lastAuto.current) return;
    const t = setTimeout(() => { lastAuto.current = key; locate(true); }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.street, value.number, value.neighborhood, value.city, value.lat]);

  const pick = async (picked) => {
    setQuery(""); setSuggestions([]);
    let s;
    try { s = await resolveSuggestion(picked); } catch (e) { setError(e.message); return; }
    if (!s?.lat) { setError("Não consegui abrir esse endereço. Tente outro ou preencha os campos."); return; }
    const number = s.number || value.number || "";
    const next = {
      street: s.street || value.street, number, neighborhood: s.neighborhood || value.neighborhood,
      city: s.city || value.city, state: s.state || value.state, lat: s.lat, lng: s.lng,
      precision: s.precision === "number" || !showNumber ? "number" : s.precision,
    };
    lastAuto.current = [next.street, next.number, next.neighborhood, next.city].join("|");
    // Sugestão era só a rua, mas o número foi digitado: tenta achar o número.
    if (showNumber && number && next.precision !== "number") {
      onChange(next);
      setLocating(true);
      try {
        const r = await locateAddress(next, near);
        if (r && r.precision === "number") onChange({ ...next, lat: r.lat, lng: r.lng, precision: r.precision });
      } catch { /* fica com o ponto da sugestão */ } finally { setLocating(false); }
      return;
    }
    onChange(next);
    setError("");
  };

  const onCep = async (text) => {
    const masked = text.replace(/\D/g, "").slice(0, 8).replace(/^(\d{5})(\d)/, "$1-$2");
    setCep(masked);
    if (masked.replace(/\D/g, "").length !== 8) return;
    setCepBusy(true); setError("");
    try {
      const r = await lookupCep(masked);
      if (!r) { setError("CEP não encontrado."); return; }
      onChange({ ...value, street: r.street || value.street, neighborhood: r.neighborhood || value.neighborhood,
        city: r.city, state: r.state, lat: null, lng: null, precision: null });
    } catch {
      setError("Não consegui consultar o CEP agora. Preencha os campos.");
    } finally {
      setCepBusy(false);
    }
  };

  const point = value.lat && value.lng ? [value.lat, value.lng] : null;
  const center = point || (near ? [near.lat, near.lng] : [-15.78, -47.93]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.2 }}>
      <Box sx={{ position: "relative" }}>
        <TextField size="small" fullWidth label="Buscar endereço" placeholder="Ex.: Rua Direita 100, Centro"
          value={query} onChange={(e) => setQuery(e.target.value)}
          InputProps={{ startAdornment: <SearchIcon sx={{ fontSize: 18, color: "#A8A29E", mr: 1 }} />,
            endAdornment: searching ? <CircularProgress size={14} /> : null }} />
        {suggestions.length > 0 && (
          <Paper sx={{ position: "absolute", zIndex: 1500, left: 0, right: 0, mt: 0.5, maxHeight: 260, overflowY: "auto" }}>
            <MenuList dense>
            {suggestions.map((s, i) => (
              <MenuItem key={`${s.display}-${i}`} onClick={() => pick(s)} sx={{ whiteSpace: "normal", fontSize: 13, py: 1 }}>
                {s.display}
              </MenuItem>
            ))}
            </MenuList>
          </Paper>
        )}
      </Box>

      <TextField label="CEP (opcional)" size="small" value={cep} onChange={(e) => onCep(e.target.value)}
        placeholder="00000-000" inputProps={{ inputMode: "numeric" }} sx={{ maxWidth: 200 }}
        InputProps={{ endAdornment: cepBusy ? <CircularProgress size={14} /> : null }} />
      <Box sx={{ display: "grid", gridTemplateColumns: showNumber ? "2fr 1fr" : "1fr", gap: 1.2 }}>
        <TextField label="Rua" size="small" value={value.street || ""} onChange={(e) => setText({ street: e.target.value })} />
        {showNumber && <TextField label="Número" size="small" value={value.number || ""} onChange={(e) => setText({ number: e.target.value })} />}
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.2 }}>
        <TextField label="Bairro" size="small" value={value.neighborhood || ""} onChange={(e) => setText({ neighborhood: e.target.value })} />
        <TextField label="Cidade" size="small" value={value.city || ""} placeholder={store?.city || ""}
          onChange={(e) => setText({ city: e.target.value })} InputLabelProps={store?.city ? { shrink: true } : undefined} />
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Button size="small" variant="outlined" onClick={() => locate(false)} disabled={locating}
          startIcon={locating ? <CircularProgress size={12} /> : null}>
          {locating ? "Localizando…" : "Localizar no mapa"}
        </Button>
        {point && !error && (
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: value.precision === "neighborhood" || value.precision === "street" ? "#B0793D" : "#4B7A5E" }}>
            ✓ {PRECISION[value.precision] || PRECISION.number}
          </Typography>
        )}
        {!point && !error && !locating && (value.street || value.neighborhood) && (
          <Typography sx={{ fontSize: 12, color: "#B0793D", fontWeight: 600 }}>Ainda sem ponto no mapa.</Typography>
        )}
      </Box>
      {error && <Typography sx={{ fontSize: 12, color: "#B0463D", fontWeight: 600 }}>{error}</Typography>}

      <Box sx={{ height: mapHeight, borderRadius: "10px", overflow: "hidden", border: "1px solid #E7E5E4" }}>
        <MapContainer center={center} zoom={point ? 16 : near ? 13 : 4} style={{ height: "100%", width: "100%" }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
          <Recenter point={point} />
          <ClickToPlace onPlace={(lat, lng) => { set({ lat, lng, precision: "manual" }); setError(""); }} />
          {near && <Marker position={[near.lat, near.lng]} icon={storeIcon} />}
          {point && (
            <Marker position={point} icon={pinIcon} draggable
              eventHandlers={{ dragend: (e) => { const p = e.target.getLatLng(); set({ lat: p.lat, lng: p.lng, precision: "manual" }); } }} />
          )}
        </MapContainer>
      </Box>
      <Typography sx={{ fontSize: 11, color: "#A8A29E", mt: -0.5 }}>Clique no mapa ou arraste o marcador para ajustar o ponto exato.</Typography>
    </Box>
  );
}
