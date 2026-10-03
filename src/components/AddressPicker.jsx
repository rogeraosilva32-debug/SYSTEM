import { useState } from "react";
import { Box, Button, TextField, Typography, CircularProgress } from "@mui/material";
import GpsFixedIcon from "@mui/icons-material/GpsFixed";
import { reverseGeocode, getCurrentPosition } from "../utils/geocoding";

/**
 * Campo de endereço com botão de GPS ou preenchimento manual.
 * `value`  = { street, number, neighborhood, city, lat, lng }
 * `onChange(next)` recebe o objeto atualizado a cada mudança/geocodificação.
 * `showNumber` exibe o campo "Número" (útil pra endereço de serviço; não pra
 * localização base do profissional, por exemplo).
 */
export default function AddressPicker({ value, onChange, showNumber = false, gpsLabel = "Usar minha localização atual" }) {
  const [gpsLoading, setGpsLoading] = useState(false);
  const [error, setError] = useState("");

  const set = (patch) => onChange({ ...value, ...patch });

  const handleUseGps = async () => {
    setGpsLoading(true);
    setError("");
    try {
      const pos = await getCurrentPosition();
      const { latitude: lat, longitude: lng } = pos.coords;
      const addr = await reverseGeocode(lat, lng);
      if (!addr) { setError("Não foi possível identificar o endereço pela localização."); }
      else { set({ lat, lng, street: addr.street, neighborhood: addr.neighborhood, city: addr.city }); }
    } catch (err) {
      setError(err.message || "Permissão de GPS negada ou tempo esgotado.");
    } finally {
      setGpsLoading(false);
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.2 }}>
      <Button
        onClick={handleUseGps}
        disabled={gpsLoading}
        startIcon={gpsLoading ? <CircularProgress size={14} sx={{ color: "#0f3460" }} /> : <GpsFixedIcon sx={{ fontSize: 16 }} />}
        sx={{
          alignSelf: "flex-start", textTransform: "none", fontWeight: 700, fontSize: 12,
          borderRadius: "10px", background: "#eff6ff", color: "#1d4ed8", px: 1.6, py: 0.6,
          "&:hover": { background: "#dbeafe" },
        }}
      >
        {gpsLoading ? "Localizando..." : gpsLabel}
      </Button>

      <Box sx={{ display: "grid", gridTemplateColumns: showNumber ? "2fr 1fr" : "1fr 1fr", gap: 1.2 }}>
        <TextField
          label="Rua" size="small" value={value.street || ""}
          onChange={(e) => set({ street: e.target.value, lat: null, lng: null })}
        />
        {showNumber && (
          <TextField
            label="Número" size="small" value={value.number || ""}
            onChange={(e) => set({ number: e.target.value, lat: null, lng: null })}
          />
        )}
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.2 }}>
        <TextField
          label="Bairro" size="small" value={value.neighborhood || ""}
          onChange={(e) => set({ neighborhood: e.target.value, lat: null, lng: null })}
        />
        <TextField
          label="Cidade" size="small" value={value.city || ""}
          onChange={(e) => set({ city: e.target.value, lat: null, lng: null })}
        />
      </Box>

      {error && <Typography sx={{ fontSize: 11, color: "#dc2626" }}>{error}</Typography>}
      {value.lat && value.lng && !error && (
        <Typography sx={{ fontSize: 11, color: "#16a34a", fontWeight: 600 }}>✓ Localização definida</Typography>
      )}
    </Box>
  );
}
