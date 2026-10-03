import { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, Button, TextField, Switch, CircularProgress, IconButton, Alert, Chip,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import supabase from "../../services/supabase";
import { useAuth } from "../../context/AuthContext";
import { money } from "../../utils/delivery";
import DeliveryAddressField from "../../components/DeliveryAddressField";
import { refreshCompanySettings } from "../../hooks/useCompanySettings";

// Endereço da loja: ponto de partida das rotas e referência das buscas.
function StoreAddress({ company, onSaved }) {
  const [addr, setAddr] = useState({
    street: company.store_street || "", number: company.store_number || "", neighborhood: company.store_neighborhood || "",
    city: company.store_city || "", state: company.store_state || "", lat: company.store_lat, lng: company.store_lng,
    precision: company.store_lat ? "number" : null,
  });
  const [msg, setMsg] = useState(null);
  const save = async () => {
    if (!addr.lat || !addr.lng) { setMsg({ type: "error", text: "Localize o endereço da loja no mapa antes de salvar." }); return; }
    if (!addr.city) { setMsg({ type: "error", text: "Informe a cidade da loja." }); return; }
    const { error } = await supabase.from("companies").update({
      store_street: addr.street || null, store_number: addr.number || null, store_neighborhood: addr.neighborhood || null,
      store_city: addr.city || null, store_state: addr.state || null, store_lat: addr.lat, store_lng: addr.lng,
    }).eq("id", company.id);
    setMsg(error ? { type: "error", text: error.message } : { type: "success", text: "Endereço da loja salvo." });
    if (!error) { refreshCompanySettings(); onSaved(); }
  };
  return (
    <Box>
      <Typography sx={{ fontSize: 12.5, color: "#78716C", mb: 1.5 }}>
        As rotas dos motoboys saem daqui, e a busca de endereço dos pedidos dá preferência para esta cidade.
      </Typography>
      {msg && <Alert severity={msg.type} sx={{ mb: 1.5 }} onClose={() => setMsg(null)}>{msg.text}</Alert>}
      <DeliveryAddressField value={addr} onChange={setAddr} store={null} mapHeight={220} />
      <Button variant="contained" sx={{ mt: 1.5 }} onClick={save}>Salvar endereço da loja</Button>
    </Box>
  );
}

function Section({ title, children }) {
  return (
    <Box sx={{ p: 2.5, border: "1px solid #E7E5E4", borderRadius: "16px", background: "#fff", mb: 2 }}>
      <Typography sx={{ fontWeight: 800, mb: 1.5 }}>{title}</Typography>
      {children}
    </Box>
  );
}

// Ajustes de entrega do admin da empresa: bairros/taxas, modo rota exata e
// distância de desvio. As liberações da plataforma aparecem só para leitura.
export function DeliverySettingsTab() {
  const { companyId } = useAuth();
  const [company, setCompany] = useState(null);
  const [zones, setZones] = useState([]);
  const [name, setName] = useState("");
  const [fee, setFee] = useState("");
  const [eta, setEta] = useState("");
  const [meters, setMeters] = useState(250);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const load = useCallback(async () => {
    const [c, z] = await Promise.all([
      supabase.from("companies").select("*").eq("id", companyId).maybeSingle(),
      supabase.from("delivery_zones").select("*").eq("company_id", companyId).order("name"),
    ]);
    setCompany(c.data);
    setMeters(c.data?.off_route_meters ?? 250);
    setZones(z.data || []);
  }, [companyId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const flash = (msg) => { setSaved(msg); setTimeout(() => setSaved(""), 2500); };

  const updateCompany = async (patch) => {
    setError("");
    const { data, error: err } = await supabase.from("companies").update(patch).eq("id", companyId).select("*").single();
    if (err) { setError(err.message); return; }
    setCompany(data);
    flash("Salvo.");
  };

  const addZone = async () => {
    setError("");
    if (!name.trim()) return;
    const { error: err } = await supabase.from("delivery_zones").insert({
      company_id: companyId, name: name.trim(),
      fee: Number(String(fee).replace(",", ".")) || 0,
      eta_minutes: eta ? Number(eta) : null,
    });
    if (err) { setError(err.code === "23505" ? "Esse bairro já está cadastrado." : err.message); return; }
    setName(""); setFee(""); setEta("");
    load();
  };

  const updateZone = async (z, patch) => {
    await supabase.from("delivery_zones").update(patch).eq("id", z.id);
    load();
  };

  if (!company) return <Box sx={{ py: 8, textAlign: "center" }}><CircularProgress size={26} /></Box>;

  return (
    <Box sx={{ maxWidth: 760 }}>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {saved && <Alert severity="success" sx={{ mb: 2 }}>{saved}</Alert>}

      <Section title="Endereço da loja (ponto de partida)">
        <StoreAddress key={company.id} company={company} onSaved={load} />
      </Section>

      <Section title="Rotas">
        <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2 }}>
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: 14 }}>Modo rota exata</Typography>
            <Typography sx={{ fontSize: 12.5, color: "#78716C", maxWidth: 520 }}>
              O motoboy não escolhe entre as 3 rotas: segue a principal, navegando pelo mapa do app.
              Desvios geram alerta para ele, aviso para a empresa e ficam registrados.
            </Typography>
          </Box>
          <Switch checked={company.strict_route_mode} onChange={(e) => updateCompany({ strict_route_mode: e.target.checked })} />
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mt: 2 }}>
          <TextField size="small" type="number" label="Considerar desvio a partir de (metros)" value={meters}
            onChange={(e) => setMeters(e.target.value)} sx={{ width: 300 }} inputProps={{ min: 50, max: 5000 }} />
          <Button variant="outlined" onClick={() => updateCompany({ off_route_meters: Number(meters) })}>Salvar</Button>
        </Box>
      </Section>

      <Section title="Bairros atendidos e taxas">
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "2fr 1fr 1fr auto" }, gap: 1, mb: 2 }}>
          <TextField size="small" label="Bairro" value={name} onChange={(e) => setName(e.target.value)} />
          <TextField size="small" label="Taxa (R$)" value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal" />
          <TextField size="small" label="Tempo (min)" value={eta} onChange={(e) => setEta(e.target.value)} type="number" />
          <Button variant="contained" onClick={addZone}>Adicionar</Button>
        </Box>
        {zones.length === 0 && <Typography sx={{ fontSize: 13, color: "#A8A29E" }}>Nenhum bairro cadastrado.</Typography>}
        {zones.map((z) => (
          <Box key={z.id} sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.8, borderTop: "1px solid #F5F5F4", opacity: z.active ? 1 : 0.5 }}>
            <Typography sx={{ flex: 1, fontWeight: 600, fontSize: 13.5 }}>{z.name}</Typography>
            <Typography sx={{ fontSize: 13, width: 90 }}>{money(z.fee)}</Typography>
            <Typography sx={{ fontSize: 13, width: 70, color: "#78716C" }}>{z.eta_minutes ? `${z.eta_minutes} min` : "—"}</Typography>
            <Switch size="small" checked={z.active} onChange={(e) => updateZone(z, { active: e.target.checked })} />
            <IconButton size="small" onClick={async () => { await supabase.from("delivery_zones").delete().eq("id", z.id); load(); }}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Box>
        ))}
      </Section>

      <Section title="Recursos liberados pela plataforma">
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Chip label={`Código de entrega: ${company.feature_delivery_code ? "ativo" : "não liberado"}`}
            color={company.feature_delivery_code ? "success" : "default"} variant="outlined" />
          <Chip label={`Marca própria: ${company.feature_branding ? "liberada" : "não liberada"}`}
            color={company.feature_branding ? "success" : "default"} variant="outlined" />
        </Box>
        <Typography sx={{ fontSize: 12, color: "#A8A29E", mt: 1 }}>Para liberar, fale com o administrador da plataforma.</Typography>
      </Section>
    </Box>
  );
}
