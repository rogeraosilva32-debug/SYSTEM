import { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, Button, TextField, Switch, CircularProgress, IconButton, Alert, Chip, MenuItem,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import CollapsibleSection, { MoreOptions } from "../../components/CollapsibleSection";
import supabase from "../../services/supabase";
import { useAuth } from "../../context/AuthContext";
import { money, parsePrice } from "../../utils/delivery";
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

// Despacho automático: limites que a empresa define.
function AutoDispatch({ company, onSave }) {
  const [form, setForm] = useState({
    auto_max_stops: company.auto_max_stops ?? 3, auto_max_detour_km: String(company.auto_max_detour_km ?? 0).replace(".", ","),
    auto_hold_minutes: company.auto_hold_minutes ?? 0, auto_accept_minutes: company.auto_accept_minutes ?? 5,
    auto_dispatch_when: company.auto_dispatch_when || "ready",
  });
  const [invalid, setInvalid] = useState("");
  if (company.auto_dispatch === undefined) {
    return <Alert severity="warning">Rode de novo o supabase-b2b-schema.sql no Supabase para liberar o despacho automático.</Alert>;
  }
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = () => {
    const int = (v, min, max) => {
      const n = String(v).trim() === "" ? NaN : Number(v);
      return Number.isInteger(n) && n >= min && n <= max ? n : null;
    };
    const values = {
      auto_max_stops: int(form.auto_max_stops, 1, 20),
      auto_max_detour_km: parsePrice(form.auto_max_detour_km),
      auto_hold_minutes: int(form.auto_hold_minutes, 0, 30),
      auto_accept_minutes: int(form.auto_accept_minutes, 0, 60),
      auto_dispatch_when: form.auto_dispatch_when,
    };
    if (values.auto_max_stops == null) { setInvalid("Máximo de entregas: de 1 a 20."); return; }
    if (values.auto_max_detour_km == null || values.auto_max_detour_km < 0 || values.auto_max_detour_km > 50) { setInvalid("Desvio máximo: de 0 a 50 km."); return; }
    if (values.auto_hold_minutes == null) { setInvalid("Espera para juntar pedidos: de 0 a 30 minutos."); return; }
    if (values.auto_accept_minutes == null) { setInvalid("Prazo para iniciar a saída: de 0 a 60 minutos."); return; }
    setInvalid("");
    onSave(values);
  };
  return (
    <>
      <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2 }}>
        <Box>
          <Typography sx={{ fontWeight: 700, fontSize: 14 }}>Despachar sozinho para os motoboys em expediente</Typography>
          <Typography sx={{ fontSize: 12.5, color: "#78716C", maxWidth: 540 }}>
            O sistema monta a saída para o motoboy livre, começando pelo pedido mais antigo e juntando os prontos na
            melhor rota. Desligue só se quiser montar as saídas à mão.
          </Typography>
        </Box>
        <Switch checked={company.auto_dispatch} slotProps={{ input: { "aria-label": "Despacho automático" } }} onChange={(e) => onSave({ auto_dispatch: e.target.checked })} />
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5, mt: 2 }}>
        <TextField size="small" type="number" label="Máximo de entregas por saída" value={form.auto_max_stops}
          onChange={set("auto_max_stops")} inputProps={{ min: 1, max: 20 }}
          helperText="A saída junta os pedidos prontos até este número, na melhor rota." />
      </Box>
      <MoreOptions>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5 }}>
          <TextField size="small" label="Desvio máximo para juntar um pedido (km)" value={form.auto_max_detour_km}
            onChange={set("auto_max_detour_km")} inputMode="decimal"
            helperText="0 = sem limite (a saída vai cheia). Use um valor para não juntar pedidos muito fora do caminho." />
          <TextField select size="small" label="Despachar pedidos" value={form.auto_dispatch_when} onChange={set("auto_dispatch_when")}
            helperText=" ">
            <MenuItem value="ready">Quando marcados como prontos</MenuItem>
            <MenuItem value="any">Assim que chegam (sem esperar ficar pronto)</MenuItem>
          </TextField>
          <TextField size="small" type="number" label="Esperar para juntar pedidos (min)" value={form.auto_hold_minutes}
            onChange={set("auto_hold_minutes")} inputProps={{ min: 0, max: 30 }}
            helperText="0 = sai assim que houver motoboy livre." />
          <TextField size="small" type="number" label="Prazo para o motoboy iniciar a saída (min)" value={form.auto_accept_minutes}
            onChange={set("auto_accept_minutes")} inputProps={{ min: 0, max: 60 }}
            helperText="Passou do prazo: a saída vai para outro e ele fica em pausa. 0 = sem prazo." />
        </Box>
      </MoreOptions>
      {invalid && <Alert severity="error" sx={{ mt: 1.5 }}>{invalid}</Alert>}
      <Button variant="outlined" sx={{ mt: 1.5 }} onClick={save}>Salvar limites</Button>
    </>
  );
}

// Link da tela da cozinha: abre a fila de preparo sem login (só a fila,
// sem telefone, endereço ou valores). Trocar o link derruba o anterior.
function KitchenLink() {
  const [token, setToken] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const url = token ? `${window.location.origin}/cozinha/${token}` : "";
  const get = async (reset) => {
    if (reset && !window.confirm("Trocar o link? As telas abertas com o link antigo param de funcionar.")) return;
    setBusy(true); setMsg(null);
    try {
      const { data, error } = await supabase.rpc("kitchen_display_token", { p_reset: Boolean(reset) });
      if (error) { setMsg({ type: "error", text: /Could not find/.test(error.message) ? "Rode de novo o supabase-b2b-schema.sql para liberar o modo cozinha." : error.message }); return; }
      setToken(data);
      if (reset) setMsg({ type: "success", text: "Link trocado. Abra o novo link nas telas da cozinha." });
    } catch {
      setMsg({ type: "error", text: "Sem conexão. Tente de novo." });
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setMsg({ type: "success", text: "Link copiado." }); }
    catch { setMsg({ type: "info", text: "Selecione o link e copie." }); }
  };
  return (
    <Box>
      <Typography sx={{ fontSize: 12.5, color: "#78716C", mb: 1.5 }}>
        Tela cheia com os pedidos para preparar, com adicionais e observações. Abra na TV ou tablet da cozinha
        pelo link abaixo (não precisa de login e não mostra telefone, endereço nem valores). Os gestores também
        abrem pelo botão “Modo cozinha” na aba Pedidos.
      </Typography>
      {msg && <Alert severity={msg.type} sx={{ mb: 1.5 }} onClose={() => setMsg(null)}>{msg.text}</Alert>}
      {token ? (
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
          <TextField size="small" value={url} label="Link da cozinha" InputProps={{ readOnly: true }} onFocus={(e) => e.target.select()} sx={{ flex: 1, minWidth: 260 }} />
          <Button variant="contained" onClick={copy}>Copiar</Button>
          <Button onClick={() => window.open(url, "_blank", "noopener")}>Abrir</Button>
          <Button color="error" disabled={busy} onClick={() => get(true)}>Trocar link</Button>
        </Box>
      ) : (
        <Button variant="outlined" disabled={busy} onClick={() => get(false)}>Mostrar link da cozinha</Button>
      )}
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
    if (c.error || !c.data) {
      setError(c.error?.message || "Empresa não encontrada. Saia e entre de novo.");
      setCompany(false);
      return;
    }
    if (z.error) setError(z.error.message);
    setCompany(c.data);
    setMeters(c.data.off_route_meters ?? 250);
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
    if (!name.trim()) { setError("Informe o nome do bairro."); return; }
    const feeValue = String(fee).trim() === "" ? 0 : parsePrice(fee);
    if (feeValue == null || feeValue < 0) { setError("Taxa inválida. Use só números, ex.: 5,00."); return; }
    const etaValue = String(eta).trim() === "" ? null : Number(eta);
    if (etaValue != null && !(Number.isInteger(etaValue) && etaValue > 0 && etaValue <= 600)) { setError("Tempo inválido: minutos inteiros, ex.: 40."); return; }
    const { error: err } = await supabase.from("delivery_zones").insert({
      company_id: companyId, name: name.trim(), fee: feeValue, eta_minutes: etaValue,
    });
    if (err) { setError(err.code === "23505" ? "Esse bairro já está cadastrado." : err.message); return; }
    setName(""); setFee(""); setEta("");
    load();
  };

  const updateZone = async (z, patch) => {
    setError("");
    const { error: err } = await supabase.from("delivery_zones").update(patch).eq("id", z.id);
    if (err) setError(err.message);
    load();
  };

  const deleteZone = async (z) => {
    if (!window.confirm(`Excluir o bairro ${z.name}?`)) return;
    setError("");
    const { error: err } = await supabase.from("delivery_zones").delete().eq("id", z.id);
    if (err) setError(err.message);
    load();
  };

  const saveMeters = () => {
    const n = Number(meters);
    if (!Number.isInteger(n) || n < 50 || n > 5000) { setError("Distância de desvio: de 50 a 5000 metros."); return; }
    updateCompany({ off_route_meters: n });
  };

  if (company === false) return <Alert severity="error">{error}</Alert>;
  if (!company) return <Box sx={{ py: 8, textAlign: "center" }}><CircularProgress size={26} /></Box>;

  return (
    <Box sx={{ maxWidth: 760 }}>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>{error}</Alert>}
      {saved && <Alert severity="success" sx={{ mb: 2 }}>{saved}</Alert>}

      <CollapsibleSection id="entregas-endereco" title="Endereço da loja (ponto de partida)"
        defaultOpen={!company.store_lat}
        summary={company.store_street ? [company.store_street, company.store_number, company.store_neighborhood].filter(Boolean).join(", ") : "Ainda não informado: as rotas precisam dele"}>
        <StoreAddress key={company.id} company={company} onSaved={load} />
      </CollapsibleSection>

      <CollapsibleSection id="entregas-rotas" title="Rotas"
        summary={`Rota exata ${company.strict_route_mode ? "ligada" : "desligada"} · desvio a partir de ${company.off_route_meters ?? 250} m`}>
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
          <Button variant="outlined" onClick={saveMeters}>Salvar</Button>
        </Box>
      </CollapsibleSection>

      <CollapsibleSection id="entregas-despacho" title="Despacho automático"
        summary={company.auto_dispatch ? `Ligado · até ${company.auto_max_stops} entregas por saída` : "Desligado: o gestor despacha à mão"}>
        <AutoDispatch key={`${company.id}-${company.auto_max_stops}-${company.auto_max_detour_km}`} company={company} onSave={updateCompany} />
      </CollapsibleSection>

      <CollapsibleSection id="entregas-cozinha" title="Tela da cozinha" summary="Link para abrir a fila de preparo numa TV ou tablet">
        <KitchenLink />
      </CollapsibleSection>

      <CollapsibleSection id="entregas-taxa" title="Taxa do motoboy"
        summary={(company.courier_fee_on_order ?? true) ? "Somada ao total do pedido" : "Não somada ao pedido"}>
        <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2 }}>
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: 14 }}>Somar a taxa do motoboy ao total do pedido</Typography>
            <Typography sx={{ fontSize: 12.5, color: "#78716C", maxWidth: 520 }}>
              Ao escolher o motoboy no despacho, o valor por entrega dele (Financeiro → Valores do motoboy; vale o próprio
              dele ou o padrão da empresa) entra no total que o cliente paga, separado da taxa do bairro.
            </Typography>
          </Box>
          <Switch checked={company.courier_fee_on_order ?? true} onChange={(e) => updateCompany({ courier_fee_on_order: e.target.checked })} />
        </Box>
      </CollapsibleSection>

      <CollapsibleSection id="entregas-bairros" title="Bairros atendidos e taxas"
        defaultOpen={zones.length === 0}
        summary={zones.length ? `${zones.length} bairro${zones.length > 1 ? "s" : ""}: ${zones.slice(0, 4).map((z) => z.name).join(", ")}${zones.length > 4 ? "…" : ""}` : "Nenhum bairro cadastrado"}>
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
            <IconButton size="small" aria-label={`Excluir ${z.name}`} onClick={() => deleteZone(z)}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Box>
        ))}
      </CollapsibleSection>

      <CollapsibleSection id="entregas-recursos" title="Recursos liberados pela plataforma"
        summary={`Código de entrega ${company.feature_delivery_code ? "ativo" : "não liberado"} · marca própria ${company.feature_branding ? "liberada" : "não liberada"}`}>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Chip label={`Código de entrega: ${company.feature_delivery_code ? "ativo" : "não liberado"}`}
            color={company.feature_delivery_code ? "success" : "default"} variant="outlined" />
          <Chip label={`Marca própria: ${company.feature_branding ? "liberada" : "não liberada"}`}
            color={company.feature_branding ? "success" : "default"} variant="outlined" />
        </Box>
        <Typography sx={{ fontSize: 12, color: "#A8A29E", mt: 1 }}>Para liberar, fale com o administrador da plataforma.</Typography>
      </CollapsibleSection>
    </Box>
  );
}
