import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Box, Typography, Button, TextField, MenuItem, CircularProgress, Chip, Checkbox,
  Dialog, DialogTitle, DialogContent, DialogActions, IconButton, FormControlLabel, Alert,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import TwoWheelerIcon from "@mui/icons-material/TwoWheeler";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import DeliveryAddressField from "../../components/DeliveryAddressField";
import { useCompanySettings } from "../../hooks/useCompanySettings";
import { locateAddress } from "../../utils/geocoding";
import InfoField from "../../components/InfoField";
import RouteMap from "../../components/RouteMap";
import supabase from "../../services/supabase";
import { useAuth } from "../../context/AuthContext";
import {
  ORDER_STATUS, PAYMENT_LABEL, SOURCE_LABEL, money, orderAddress, whatsappUrl,
  deliveryCodeMessage, groupByNeighborhood, suggestStopOrder,
} from "../../utils/delivery";

const COLUMNS = ["received", "preparing", "ready", "on_route", "problem"];

function minutesAgo(iso) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

function StatusChip({ status }) {
  const s = ORDER_STATUS[status] || ORDER_STATUS.received;
  return <Chip label={s.label} size="small" sx={{ height: 22, fontSize: 11, fontWeight: 700, background: s.bg, color: s.fg }} />;
}

// ───────────────────────── Novo pedido ─────────────────────────
const EMPTY_ADDRESS = { street: "", number: "", neighborhood: "", city: "", state: "", lat: null, lng: null, precision: null };

function NewOrderDialog({ open, onClose, onCreated, companyId, zones }) {
  const settings = useCompanySettings();
  const store = settings?.store_lat ? {
    lat: settings.store_lat, lng: settings.store_lng, city: settings.store_city, state: settings.store_state,
  } : null;
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [customerId, setCustomerId] = useState(null);
  const [address, setAddress] = useState(EMPTY_ADDRESS);
  const [complement, setComplement] = useState("");
  const [source, setSource] = useState("telefone");
  const [items, setItems] = useState("");
  const [subtotal, setSubtotal] = useState("");
  const [fee, setFee] = useState("");
  const [payment, setPayment] = useState("dinheiro");
  const [changeFor, setChangeFor] = useState("");
  const [notes, setNotes] = useState("");
  const [saveCustomer, setSaveCustomer] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [found, setFound] = useState("");

  const reset = () => {
    setPhone(""); setName(""); setCustomerId(null); setAddress(EMPTY_ADDRESS); setComplement("");
    setSource("telefone"); setItems(""); setSubtotal(""); setFee(""); setPayment("dinheiro");
    setChangeFor(""); setNotes(""); setSaveCustomer(true); setError(""); setFound("");
  };

  // Taxa sugerida pelo bairro (o banco aplica a mesma regra se ficar vazio).
  const zoneFee = useMemo(() => {
    const norm = (t) => (t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
    const z = zones.find((z) => z.active && norm(z.name) === norm(address.neighborhood));
    return z ? Number(z.fee) : null;
  }, [zones, address.neighborhood]);

  const lookupCustomer = async () => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 8) return;
    const { data } = await supabase.from("customers").select("*")
      .eq("company_id", companyId).eq("phone", digits).limit(1).maybeSingle();
    if (data) {
      setCustomerId(data.id); setName(data.name); setComplement(data.address_complement || "");
      setAddress({
        street: data.address_street || "", number: data.address_number || "",
        neighborhood: data.address_neighborhood || "", city: data.address_city || "",
        lat: data.lat, lng: data.lng, precision: data.lat ? "number" : null,
      });
      setFound("Cliente encontrado: endereço preenchido.");
    } else {
      setCustomerId(null); setFound("");
    }
  };

  const handleSave = async () => {
    setError("");
    if (!name.trim()) { setError("Informe o nome do cliente."); return; }
    setSaving(true);
    // Sem ponto no mapa o motoboy fica sem rota: tenta localizar agora o que
    // foi digitado e, se não achar, pede para marcar no mapa.
    let addr = address;
    if ((!addr.lat || !addr.lng) && (addr.street || addr.neighborhood)) {
      const r = await locateAddress({ ...addr, city: addr.city || store?.city, state: addr.state || store?.state }, store).catch(() => null);
      if (r) {
        addr = { ...addr, neighborhood: addr.neighborhood || r.neighborhood, city: addr.city || r.city, lat: r.lat, lng: r.lng, precision: r.precision };
        setAddress(addr);
      }
    }
    const { lat, lng } = addr;
    if (!lat || !lng) {
      setSaving(false);
      setError("Não achei esse endereço no mapa. Confira o endereço, use a busca ou clique no mapa no ponto da entrega.");
      return;
    }
    const digits = phone.replace(/\D/g, "") || null;
    const addressCols = {
      address_street: addr.street || null, address_number: addr.number || null,
      address_complement: complement || null, address_neighborhood: addr.neighborhood || null,
      address_city: addr.city || store?.city || null, lat: lat || null, lng: lng || null,
    };

    let custId = customerId;
    if (saveCustomer && digits) {
      if (custId) {
        await supabase.from("customers").update({ name: name.trim(), ...addressCols }).eq("id", custId);
      } else {
        const { data } = await supabase.from("customers")
          .insert({ company_id: companyId, name: name.trim(), phone: digits, ...addressCols }).select("id").single();
        custId = data?.id || null;
      }
    }

    const { data, error: insertError } = await supabase.from("delivery_orders").insert({
      company_id: companyId, source, customer_id: custId, customer_name: name.trim(), customer_phone: digits,
      ...addressCols,
      items: items.trim() || null,
      subtotal: Number(String(subtotal).replace(",", ".")) || 0,
      delivery_fee: fee === "" ? null : Number(String(fee).replace(",", ".")) || 0,
      payment_method: payment,
      change_for: payment === "dinheiro" && changeFor ? Number(String(changeFor).replace(",", ".")) : null,
      notes: notes.trim() || null,
    }).select("*").single();

    setSaving(false);
    if (insertError) { setError(insertError.message); return; }
    onCreated(data);
    reset();
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>Novo pedido</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5, pt: "8px !important" }}>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.2 }}>
          <TextField label="Telefone do cliente" size="small" value={phone}
            onChange={(e) => setPhone(e.target.value)} onBlur={lookupCustomer} />
          <TextField label="Nome do cliente" size="small" value={name} onChange={(e) => setName(e.target.value)} />
        </Box>
        {found && <Typography sx={{ fontSize: 11.5, color: "#4B7A5E", fontWeight: 600 }}>{found}</Typography>}
        {!store && (
          <Alert severity="info" sx={{ py: 0 }}>Cadastre o endereço da loja em "Entregas: ajustes" para as buscas priorizarem a sua cidade e as rotas saírem da loja.</Alert>
        )}
        <DeliveryAddressField value={address} onChange={setAddress} store={store} />
        <TextField label="Complemento / referência" size="small" value={complement} onChange={(e) => setComplement(e.target.value)} />
        <TextField label="Itens do pedido" size="small" multiline minRows={2} value={items} onChange={(e) => setItems(e.target.value)} />
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1.2 }}>
          <TextField label="Valor dos itens" size="small" value={subtotal} onChange={(e) => setSubtotal(e.target.value)} inputMode="decimal" />
          <TextField label="Taxa de entrega" size="small" value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal"
            placeholder={zoneFee != null ? String(zoneFee) : ""}
            helperText={zoneFee != null && fee === "" ? `Bairro: ${money(zoneFee)}` : " "} />
          <TextField select label="Origem" size="small" value={source} onChange={(e) => setSource(e.target.value)}>
            {Object.entries(SOURCE_LABEL).filter(([k]) => k !== "ifood").map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
          </TextField>
        </Box>
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.2 }}>
          <TextField select label="Pagamento" size="small" value={payment} onChange={(e) => setPayment(e.target.value)}>
            {Object.entries(PAYMENT_LABEL).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
          </TextField>
          {payment === "dinheiro" && (
            <TextField label="Troco para" size="small" value={changeFor} onChange={(e) => setChangeFor(e.target.value)} inputMode="decimal" />
          )}
        </Box>
        <TextField label="Observações" size="small" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <FormControlLabel
          control={<Checkbox size="small" checked={saveCustomer} onChange={(e) => setSaveCustomer(e.target.checked)} />}
          label={<Typography sx={{ fontSize: 13 }}>Salvar cliente para o próximo pedido</Typography>}
        />
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? <CircularProgress size={18} sx={{ color: "#fff" }} /> : "Criar pedido"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ───────────────────────── Detalhe do pedido ─────────────────────────
function OrderDetailDialog({ order, company, onClose, onChanged }) {
  const [code, setCode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [forceReason, setForceReason] = useState("");
  const [showForce, setShowForce] = useState(false);

  useEffect(() => {
    if (!order || !company?.feature_delivery_code) return;
    supabase.from("order_delivery_codes").select("code, locked, failed_attempts").eq("order_id", order.id).maybeSingle()
      .then(({ data }) => setCode(data));
  }, [order, company]);

  if (!order) return null;

  const run = async (fn) => {
    setBusy(true); setError("");
    const { error: err } = await fn();
    setBusy(false);
    if (err) { setError(err.message); return false; }
    onChanged();
    return true;
  };

  const setStatus = (status) => run(() => supabase.from("delivery_orders").update({ status }).eq("id", order.id));
  const inQueue = ["received", "preparing", "ready"].includes(order.status) && !order.run_id;
  const onRoute = ["on_route", "problem"].includes(order.status);

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          Pedido #{order.number} <StatusChip status={order.status} />
        </Box>
        <IconButton onClick={onClose} size="small"><CloseIcon fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pb: 3 }}>
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
          <InfoField label="Cliente" value={order.customer_name} />
          <InfoField label="Telefone" value={order.customer_phone || "—"} />
          <InfoField label="Total" value={money(order.total)} />
          <InfoField label="Pagamento" value={`${PAYMENT_LABEL[order.payment_method] || "—"}${order.change_for ? ` · troco p/ ${money(order.change_for)}` : ""}`} />
          <InfoField label="Origem" value={SOURCE_LABEL[order.source]} />
          <InfoField label="Motoboy" value={order.courier?.name || "—"} />
        </Box>
        <InfoField label="Endereço" value={orderAddress(order) || "Sem endereço"} />
        {order.items && <InfoField label="Itens" value={<span style={{ whiteSpace: "pre-wrap", fontWeight: 500 }}>{order.items}</span>} />}
        {order.notes && <Typography sx={{ fontSize: 12.5, color: "#78716C", fontStyle: "italic" }}>{order.notes}</Typography>}
        {order.problem_reason && order.status === "problem" && <Alert severity="warning">Motoboy informou: {order.problem_reason}</Alert>}
        {order.forced_reason && <Alert severity="info">Finalizado manualmente: {order.forced_reason}</Alert>}

        {company?.feature_delivery_code && code && order.status !== "delivered" && order.status !== "cancelled" && (
          <Box sx={{ p: 1.5, border: "1px solid #E7E5E4", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}>
            <Box>
              <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: "#8A8580", letterSpacing: "0.06em" }}>CÓDIGO DE ENTREGA</Typography>
              <Typography sx={{ fontSize: 22, fontWeight: 800, letterSpacing: "0.2em" }}>{code.code}</Typography>
              {code.locked && <Typography sx={{ fontSize: 11.5, color: "#B0463D", fontWeight: 700 }}>Bloqueado após 5 tentativas erradas</Typography>}
            </Box>
            <Box sx={{ display: "flex", gap: 1 }}>
              {code.locked && (
                <Button size="small" variant="outlined" disabled={busy}
                  onClick={async () => { if (await run(() => supabase.rpc("unlock_delivery_code", { p_order_id: order.id }))) setCode({ ...code, locked: false }); }}>
                  Liberar
                </Button>
              )}
              <Button size="small" variant="contained" color="success" startIcon={<WhatsAppIcon />} disabled={!order.customer_phone}
                onClick={() => window.open(whatsappUrl(order.customer_phone, deliveryCodeMessage(company.name, order, code.code)), "_blank", "noopener,noreferrer")}>
                Enviar por WhatsApp
              </Button>
            </Box>
          </Box>
        )}

        {order.lat && order.lng && (
          <RouteMap lat={order.lat} lng={order.lng} address={orderAddress(order)}
            origin={company?.store_lat ? { lat: company.store_lat, lng: company.store_lng } : null}
            trackCollaboratorId={onRoute ? order.courier_id : null} mapHeight={220} />
        )}

        {error && <Alert severity="error">{error}</Alert>}

        {inQueue && (
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            {order.status !== "received" && <Button variant="outlined" disabled={busy} onClick={() => setStatus("received")}>Voltar para recebido</Button>}
            {order.status !== "preparing" && <Button variant="outlined" disabled={busy} onClick={() => setStatus("preparing")}>Em preparo</Button>}
            {order.status !== "ready" && <Button variant="contained" disabled={busy} onClick={() => setStatus("ready")}>Pronto para despacho</Button>}
            <Button color="error" disabled={busy} onClick={() => setStatus("cancelled")}>Cancelar pedido</Button>
          </Box>
        )}

        {onRoute && !showForce && (
          <Button variant="outlined" onClick={() => setShowForce(true)}>Finalizar manualmente (cliente sem código)</Button>
        )}
        {onRoute && showForce && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <TextField size="small" label="Motivo (obrigatório, fica na auditoria)" value={forceReason} onChange={(e) => setForceReason(e.target.value)} />
            <Button variant="contained" disabled={busy || !forceReason.trim()}
              onClick={() => run(() => supabase.rpc("force_complete_delivery", { p_order_id: order.id, p_reason: forceReason.trim() }))}>
              Confirmar entrega
            </Button>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── Montar / editar saída ─────────────────────────
function StopList({ stops, setStops }) {
  const move = (i, d) => {
    const next = [...stops];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setStops(next);
  };
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.8 }}>
      {stops.map((o, i) => (
        <Box key={o.id} sx={{ display: "flex", alignItems: "center", gap: 1, p: 1, border: "1px solid #E7E5E4", borderRadius: "10px", background: o.status === "delivered" ? "#F5F5F4" : "#fff" }}>
          <Typography sx={{ fontWeight: 800, width: 22, textAlign: "center" }}>{i + 1}</Typography>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700 }}>#{o.number} · {o.customer_name}</Typography>
            <Typography sx={{ fontSize: 11.5, color: "#78716C", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {o.address_neighborhood || "Sem bairro"}{!o.lat ? " · sem localização no mapa" : ""}
            </Typography>
          </Box>
          {o.status === "delivered" ? <StatusChip status="delivered" /> : (
            <>
              <IconButton size="small" disabled={i === 0 || stops[i - 1]?.status === "delivered"} onClick={() => move(i, -1)}><ArrowUpwardIcon fontSize="small" /></IconButton>
              <IconButton size="small" disabled={i === stops.length - 1} onClick={() => move(i, 1)}><ArrowDownwardIcon fontSize="small" /></IconButton>
              <IconButton size="small" onClick={() => setStops(stops.filter((s) => s.id !== o.id))}><DeleteOutlineIcon fontSize="small" /></IconButton>
            </>
          )}
        </Box>
      ))}
    </Box>
  );
}

function RunDialog({ open, onClose, onDone, couriers, available, run }) {
  const settings = useCompanySettings();
  const storePoint = settings?.store_lat ? { lat: settings.store_lat, lng: settings.store_lng } : null;
  // `run` = saída existente (editar) ou null (nova saída com os `available` selecionados).
  const [courierId, setCourierId] = useState("");
  const [stops, setStops] = useState([]);
  const [addId, setAddId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setError(""); setAddId("");
    if (run) { setCourierId(run.courier_id); setStops(run.orders); }
    else { setCourierId(""); setStops(suggestStopOrder(available.filter((o) => o._selected), storePoint)); }
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, run, available]);

  const courier = couriers.find((c) => c.id === courierId);
  const addable = available.filter((o) => !stops.some((s) => s.id === o.id));
  const groups = groupByNeighborhood(stops.filter((s) => s.status !== "delivered"));

  const suggest = () => {
    const done = stops.filter((s) => s.status === "delivered");
    // A saída começa na loja; sem loja cadastrada, onde o motoboy está.
    const start = storePoint || (courier?.last_lat ? { lat: courier.last_lat, lng: courier.last_lng } : null);
    setStops([...done, ...suggestStopOrder(stops.filter((s) => s.status !== "delivered"), start)]);
  };

  const save = async () => {
    setBusy(true); setError("");
    const ids = stops.map((s) => s.id);
    const { error: err } = run
      ? await supabase.rpc("update_run", { p_run: run.id, p_order_ids: ids, p_courier: courierId })
      : await supabase.rpc("dispatch_run", { p_courier: courierId, p_order_ids: ids });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onDone();
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>{run ? "Editar saída" : "Despachar pedidos"}</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5, pt: "8px !important" }}>
        <TextField select size="small" label="Motoboy" value={courierId} onChange={(e) => setCourierId(e.target.value)}>
          {couriers.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
        </TextField>
        {groups.length > 0 && (
          <Box sx={{ display: "flex", gap: 0.6, flexWrap: "wrap" }}>
            {groups.map((g) => <Chip key={g.key} size="small" label={`${g.name}: ${g.orders.length}`} />)}
          </Box>
        )}
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: "#78716C" }}>PARADAS NA ORDEM</Typography>
          <Button size="small" startIcon={<AutoFixHighIcon />} onClick={suggest} disabled={stops.length < 2}>Sugerir ordem</Button>
        </Box>
        <StopList stops={stops} setStops={setStops} />
        {addable.length > 0 && (
          <Box sx={{ display: "flex", gap: 1 }}>
            <TextField select size="small" label="Adicionar pedido" value={addId} onChange={(e) => setAddId(e.target.value)} sx={{ flex: 1 }}>
              {addable.map((o) => <MenuItem key={o.id} value={o.id}>#{o.number} · {o.customer_name} · {o.address_neighborhood || "sem bairro"}</MenuItem>)}
            </TextField>
            <Button disabled={!addId} onClick={() => { setStops([...stops, addable.find((o) => o.id === addId)]); setAddId(""); }}>Adicionar</Button>
          </Box>
        )}
        {run && <Typography sx={{ fontSize: 11.5, color: "#A8A29E" }}>Pedidos removidos voltam para a fila como “Pronto”.</Typography>}
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Fechar</Button>
        <Button variant="contained" onClick={save} disabled={busy || !courierId || (!run && stops.length === 0)}>
          {busy ? <CircularProgress size={18} sx={{ color: "#fff" }} /> : run ? "Salvar saída" : "Despachar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ───────────────────────── Aba principal ─────────────────────────
export function OrdersTab() {
  const { companyId } = useAuth();
  const [orders, setOrders] = useState(null);
  const [runs, setRuns] = useState([]);
  const [zones, setZones] = useState([]);
  const [couriers, setCouriers] = useState([]);
  const [company, setCompany] = useState(null);
  const [deliveredToday, setDeliveredToday] = useState(0);
  const [selected, setSelected] = useState(new Set());
  const [showNew, setShowNew] = useState(false);
  const [detail, setDetail] = useState(null);
  const [runDialog, setRunDialog] = useState({ open: false, run: null });
  const reloadTimer = useRef(null);

  const load = useCallback(async () => {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const [o, r, z, c, comp, d] = await Promise.all([
      supabase.from("delivery_orders").select("*, courier:courier_id(name)").eq("company_id", companyId)
        .in("status", COLUMNS).order("created_at"),
      supabase.from("delivery_runs").select("*, courier:courier_id(name)").eq("company_id", companyId)
        .in("status", ["planned", "in_progress"]).order("created_at"),
      supabase.from("delivery_zones").select("*").eq("company_id", companyId).order("name"),
      supabase.from("profiles").select("id, name, last_lat, last_lng, last_location_at").eq("company_id", companyId).eq("company_role", "collaborator").order("name"),
      supabase.rpc("my_company_settings").maybeSingle(),
      supabase.from("delivery_orders").select("id", { count: "exact", head: true }).eq("company_id", companyId)
        .eq("status", "delivered").gte("delivered_at", startOfDay.toISOString()),
    ]);
    setOrders(o.data || []);
    setRuns(r.data || []);
    setZones(z.data || []);
    setCouriers(c.data || []);
    setCompany(comp.data);
    setDeliveredToday(d.count || 0);
  }, [companyId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  // Tempo real: qualquer mudança em pedidos/saídas da empresa recarrega a
  // fila (agrupando rajadas de eventos numa recarga só).
  useEffect(() => {
    const schedule = () => {
      clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(load, 400);
    };
    const channel = supabase.channel(`orders-${companyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "delivery_orders", filter: `company_id=eq.${companyId}` }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "delivery_runs", filter: `company_id=eq.${companyId}` }, schedule)
      .subscribe();
    const interval = setInterval(load, 30000);
    return () => { clearTimeout(reloadTimer.current); clearInterval(interval); supabase.removeChannel(channel); };
  }, [companyId, load]);

  const dispatchable = useMemo(
    () => (orders || []).filter((o) => ["received", "preparing", "ready"].includes(o.status) && !o.run_id)
      .map((o) => ({ ...o, _selected: selected.has(o.id) })),
    [orders, selected],
  );

  const runsWithOrders = runs.map((r) => ({
    ...r,
    orders: (orders || []).filter((o) => o.run_id === r.id).sort((a, b) => a.stop_sequence - b.stop_sequence),
  }));

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  if (orders === null) return <Box sx={{ py: 8, textAlign: "center" }}><CircularProgress size={26} /></Box>;

  return (
    <Box>
      <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap", alignItems: "center" }}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setShowNew(true)}>Novo pedido</Button>
        <Button variant="outlined" startIcon={<TwoWheelerIcon />} disabled={selected.size === 0}
          onClick={() => setRunDialog({ open: true, run: null })}>
          Despachar {selected.size > 0 ? `(${selected.size})` : ""}
        </Button>
        <Typography sx={{ ml: "auto", fontSize: 12.5, color: "#78716C", fontWeight: 600 }}>
          Entregues hoje: {deliveredToday}
        </Typography>
      </Box>
      {zones.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>Cadastre os bairros atendidos e as taxas na aba “Entregas: ajustes” para a taxa ser preenchida sozinha.</Alert>
      )}

      {/* Fila */}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: `repeat(${COLUMNS.length}, minmax(0, 1fr))` }, gap: 1.5, mb: 3 }}>
        {COLUMNS.map((col) => {
          const list = orders.filter((o) => o.status === col);
          if (col === "problem" && list.length === 0) return <Box key={col} sx={{ display: { xs: "none", md: "block" } }} />;
          return (
            <Box key={col} sx={{ background: "#F5F5F4", borderRadius: "14px", p: 1.2, minHeight: { md: 200 } }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1, px: 0.5 }}>
                <Typography sx={{ fontSize: 12, fontWeight: 800, color: ORDER_STATUS[col].fg, letterSpacing: "0.04em" }}>{ORDER_STATUS[col].label.toUpperCase()}</Typography>
                <Typography sx={{ fontSize: 12, fontWeight: 700, color: "#A8A29E" }}>{list.length}</Typography>
              </Box>
              {list.map((o) => (
                <Box key={o.id} onClick={() => setDetail(o)}
                  sx={{ background: "#fff", border: "1px solid #E7E5E4", borderRadius: "12px", p: 1.2, mb: 1, cursor: "pointer", "&:hover": { borderColor: "#D6D3D1" } }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    {["received", "preparing", "ready"].includes(o.status) && !o.run_id && (
                      <Checkbox size="small" sx={{ p: 0.3 }} checked={selected.has(o.id)}
                        onClick={(e) => e.stopPropagation()} onChange={() => toggle(o.id)} />
                    )}
                    <Typography sx={{ fontWeight: 800, fontSize: 13.5 }}>#{o.number}</Typography>
                    <Typography sx={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.customer_name}</Typography>
                    <Typography sx={{ fontSize: 11, color: "#A8A29E" }}>{minutesAgo(o.created_at)}</Typography>
                  </Box>
                  <Typography sx={{ fontSize: 11.5, color: "#78716C", mt: 0.3 }}>
                    {o.address_neighborhood || "Sem bairro"} · {money(o.total)}
                  </Typography>
                  {o.run_id && <Typography sx={{ fontSize: 11, color: "#4F5BA6", fontWeight: 700, mt: 0.3 }}>🛵 {o.courier?.name} · parada {o.stop_sequence}</Typography>}
                </Box>
              ))}
            </Box>
          );
        })}
      </Box>

      {/* Saídas */}
      <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: "#78716C", mb: 1.5 }}>SAÍDAS EM ANDAMENTO</Typography>
      {runsWithOrders.length === 0 && <Typography sx={{ fontSize: 13, color: "#A8A29E" }}>Nenhuma saída aberta.</Typography>}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1.5 }}>
        {runsWithOrders.map((r) => (
          <Box key={r.id} sx={{ p: 2, border: "1px solid #E7E5E4", borderRadius: "14px", background: "#fff" }}>
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
              <Typography sx={{ fontWeight: 800 }}>🛵 {r.courier?.name}</Typography>
              <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                {r.strict_route && <Chip size="small" label="Rota exata" sx={{ height: 20, fontSize: 10.5, fontWeight: 700 }} />}
                <Chip size="small" label={r.status === "planned" ? "Aguardando saída" : "Em rota"} sx={{ height: 20, fontSize: 10.5, fontWeight: 700 }} />
                <Button size="small" onClick={() => setRunDialog({ open: true, run: r })}>Editar</Button>
              </Box>
            </Box>
            {r.orders.map((o) => (
              <Typography key={o.id} sx={{ fontSize: 12.5, color: "#57534E", cursor: "pointer" }} onClick={() => setDetail(o)}>
                {o.stop_sequence}. #{o.number} {o.customer_name} · {o.address_neighborhood || "sem bairro"} · {ORDER_STATUS[o.status].label}
              </Typography>
            ))}
          </Box>
        ))}
      </Box>

      <NewOrderDialog open={showNew} onClose={() => setShowNew(false)} onCreated={load} companyId={companyId} zones={zones} />
      <OrderDetailDialog order={detail} company={company} onClose={() => setDetail(null)} onChanged={() => { setDetail(null); load(); }} />
      <RunDialog
        open={runDialog.open} run={runDialog.run} couriers={couriers} available={dispatchable}
        onClose={() => setRunDialog({ open: false, run: null })}
        onDone={() => { setSelected(new Set()); load(); }}
      />
    </Box>
  );
}
