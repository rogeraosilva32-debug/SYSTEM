import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Box, Typography, Button, TextField, MenuItem, CircularProgress, Chip, Checkbox,
  Dialog, DialogTitle, DialogContent, DialogActions, IconButton, FormControlLabel, Alert, Autocomplete,
  ToggleButton, ToggleButtonGroup, Stepper, Step, StepButton, useMediaQuery,
} from "@mui/material";
import PersonOutlineIcon from "@mui/icons-material/PersonOutlined";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import FastfoodOutlinedIcon from "@mui/icons-material/FastfoodOutlined";
import PaymentsOutlinedIcon from "@mui/icons-material/PaymentsOutlined";
import StorefrontIcon from "@mui/icons-material/StorefrontOutlined";
import SoupKitchenIcon from "@mui/icons-material/SoupKitchenOutlined";
import RemoveIcon from "@mui/icons-material/Remove";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import TwoWheelerIcon from "@mui/icons-material/TwoWheeler";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import DeliveryAddressField from "../../components/DeliveryAddressField";
import MotoboyIcon from "../../components/MotoboyIcon";
import { useCompanySettings } from "../../hooks/useCompanySettings";
import { locateAddress } from "../../utils/geocoding";
import InfoField from "../../components/InfoField";
import RouteMap from "../../components/RouteMap";
import supabase from "../../services/supabase";
import { useAuth } from "../../context/AuthContext";
import {
  ORDER_STATUS, PAYMENT_LABEL, SOURCE_LABEL, money, orderAddress, whatsappUrl,
  deliveryCodeMessage, groupByNeighborhood, suggestStopOrder, parsePrice, itemUnitPrice, storePresence,
} from "../../utils/delivery";
import PageLoading from "../../components/PageLoading";

const COLUMNS = ["received", "preparing", "ready", "on_route", "problem"];
const isLocal = (o) => o?.order_type === "local";

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

function itemLabel(it) {
  return `${it.product.name}${it.variant ? ` (${it.variant})` : ""}${it.addons.map((a) => ` + ${a.name}`).join("")}`;
}

// Escolha de produto do cardápio: opção de preço, adicionais, quantidade.
function ProductPicker({ menu, onAdd }) {
  const [product, setProduct] = useState(null);
  const [variant, setVariant] = useState("");
  const [addonIds, setAddonIds] = useState([]);
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const [input, setInput] = useState("");

  const choose = (p) => {
    setProduct(p); setVariant(p?.variants?.length === 1 ? p.variants[0].name : "");
    setAddonIds([]); setQty(1); setNotes("");
  };
  const addons = menu.addons.filter((a) => addonIds.includes(a.id));
  const unit = product ? itemUnitPrice(product, variant, addons) : 0;
  const needsVariant = product?.variants?.length > 0 && !variant;

  const add = () => {
    onAdd({ key: `${Date.now()}-${Math.random()}`, product, variant: product.variants?.length ? variant : null, addons, quantity: qty, notes: notes.trim(), unit });
    choose(null); setInput("");
  };

  return (
    <Box sx={{ p: 1.5, border: "1px solid #E7E5E4", borderRadius: "12px", display: "flex", flexDirection: "column", gap: 1.2 }}>
      <Autocomplete
        size="small" options={menu.items} value={product} inputValue={input}
        onInputChange={(_, v) => setInput(v)} onChange={(_, p) => choose(p)}
        groupBy={(p) => p.category_name} getOptionLabel={(p) => p.name}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        filterOptions={(opts, { inputValue }) => {
          const q = inputValue.trim().toLowerCase();
          return q ? opts.filter((p) => p.name.toLowerCase().includes(q) || (p.description || "").toLowerCase().includes(q)) : opts;
        }}
        renderOption={(props, p) => {
          const { key, ...rest } = props;
          return (
            <li key={key} {...rest}>
              <Box sx={{ display: "flex", justifyContent: "space-between", width: "100%", gap: 1 }}>
                <span>{p.name}</span>
                <span style={{ color: "#78716C", fontSize: 12.5 }}>{p.variants?.length ? `a partir de ${money(p.price)}` : money(p.price)}</span>
              </Box>
            </li>
          );
        }}
        renderInput={(params) => <TextField {...params} label="Adicionar produto do cardápio" placeholder="Digite o nome" />}
        noOptionsText={menu.items.length ? "Nenhum produto encontrado" : "Cardápio vazio: cadastre os produtos na aba Cardápio"}
      />
      {product && (
        <>
          {product.description && <Typography sx={{ fontSize: 12, color: "#78716C", mt: -0.5 }}>{product.description}</Typography>}
          {product.variants?.length > 0 && (
            <Box sx={{ display: "flex", gap: 0.6, flexWrap: "wrap" }}>
              {product.variants.map((v) => (
                <Chip key={v.name} label={`${v.name} · ${money(v.price)}`} onClick={() => setVariant(v.name)}
                  color={variant === v.name ? "primary" : "default"} variant={variant === v.name ? "filled" : "outlined"} />
              ))}
            </Box>
          )}
          {menu.addons.length > 0 && (
            <Box>
              <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: "#78716C", mb: 0.5 }}>ADICIONAIS</Typography>
              <Box sx={{ display: "flex", gap: 0.6, flexWrap: "wrap" }}>
                {menu.addons.map((a) => {
                  const on = addonIds.includes(a.id);
                  return (
                    <Chip key={a.id} size="small" label={`${a.name} +${money(a.price)}`} variant={on ? "filled" : "outlined"} color={on ? "primary" : "default"}
                      onClick={() => setAddonIds(on ? addonIds.filter((x) => x !== a.id) : [...addonIds, a.id])} />
                  );
                })}
              </Box>
            </Box>
          )}
          <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
            <Box sx={{ display: "flex", alignItems: "center", border: "1px solid #E7E5E4", borderRadius: "10px" }}>
              <IconButton size="small" aria-label="Diminuir quantidade" disabled={qty <= 1} onClick={() => setQty(qty - 1)}><RemoveIcon fontSize="small" /></IconButton>
              <Typography sx={{ width: 28, textAlign: "center", fontWeight: 700 }}>{qty}</Typography>
              <IconButton size="small" aria-label="Aumentar quantidade" onClick={() => setQty(qty + 1)}><AddIcon fontSize="small" /></IconButton>
            </Box>
            <TextField size="small" label="Observação do item" placeholder="Ex.: sem cebola" value={notes} onChange={(e) => setNotes(e.target.value)} sx={{ flex: 1, minWidth: 160 }} />
            <Button variant="contained" onClick={add} disabled={needsVariant}>
              {needsVariant ? "Escolha a opção" : `Adicionar ${money(unit * qty)}`}
            </Button>
          </Box>
        </>
      )}
    </Box>
  );
}

function Cart({ cart, setCart }) {
  if (cart.length === 0) return <Typography sx={{ fontSize: 12.5, color: "#A8A29E" }}>Nenhum produto no pedido.</Typography>;
  const setQty = (key, q) => setCart(cart.map((it) => (it.key === key ? { ...it, quantity: q } : it)));
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.6 }}>
      {cart.map((it) => (
        <Box key={it.key} sx={{ display: "flex", alignItems: "center", gap: 1, p: 0.8, border: "1px solid #E7E5E4", borderRadius: "10px" }}>
          <Box sx={{ display: "flex", alignItems: "center" }}>
            <IconButton size="small" aria-label="Diminuir quantidade" disabled={it.quantity <= 1} onClick={() => setQty(it.key, it.quantity - 1)}><RemoveIcon fontSize="small" /></IconButton>
            <Typography sx={{ width: 22, textAlign: "center", fontWeight: 700, fontSize: 13 }}>{it.quantity}</Typography>
            <IconButton size="small" aria-label="Aumentar quantidade" onClick={() => setQty(it.key, it.quantity + 1)}><AddIcon fontSize="small" /></IconButton>
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{itemLabel(it)}</Typography>
            {it.notes && <Typography sx={{ fontSize: 11.5, color: "#78716C" }}>{it.notes}</Typography>}
          </Box>
          <Typography sx={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>{money(it.unit * it.quantity)}</Typography>
          <IconButton size="small" aria-label="Tirar do pedido" onClick={() => setCart(cart.filter((x) => x.key !== it.key))}><DeleteOutlineIcon fontSize="small" /></IconButton>
        </Box>
      ))}
    </Box>
  );
}

function SummaryLine({ label, value, strong, muted }) {
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between", fontSize: strong ? 15 : 13 }}>
      <Typography sx={{ fontSize: "inherit", fontWeight: strong ? 800 : 500, color: muted ? "#A8A29E" : "#44403C" }}>{label}</Typography>
      <Typography sx={{ fontSize: "inherit", fontWeight: strong ? 800 : 600, color: muted ? "#A8A29E" : "#1C1917" }}>{value}</Typography>
    </Box>
  );
}

function NewOrderDialog({ open, onClose, onCreated, companyId, zones, menu, hasCourierFee }) {
  const settings = useCompanySettings();
  const store = settings?.store_lat ? {
    lat: settings.store_lat, lng: settings.store_lng, city: settings.store_city, state: settings.store_state,
  } : null;
  const [orderType, setOrderType] = useState("delivery");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [customerId, setCustomerId] = useState(null);
  const [address, setAddress] = useState(EMPTY_ADDRESS);
  const [complement, setComplement] = useState("");
  const [source, setSource] = useState("telefone");
  const [cart, setCart] = useState([]);
  const [fee, setFee] = useState("");
  const [payment, setPayment] = useState("dinheiro");
  const [changeFor, setChangeFor] = useState("");
  const [notes, setNotes] = useState("");
  const [saveCustomer, setSaveCustomer] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [found, setFound] = useState("");
  const [step, setStep] = useState("client");
  const [checking, setChecking] = useState(false);
  const narrow = useMediaQuery("(max-width:600px)");

  // Ao abrir de novo, volta para a primeira etapa (o que já foi digitado fica).
  useEffect(() => { if (open) { setStep("client"); setError(""); } }, [open]); // eslint-disable-line react-hooks/set-state-in-effect

  const local = orderType === "local";
  // Uma etapa por vez: cliente → endereço (só entrega) → produtos → pagamento.
  const steps = [
    { key: "client", label: "Cliente", icon: <PersonOutlineIcon fontSize="small" /> },
    ...(local ? [] : [{ key: "address", label: "Endereço", icon: <PlaceOutlinedIcon fontSize="small" /> }]),
    { key: "items", label: "Produtos", icon: <FastfoodOutlinedIcon fontSize="small" /> },
    { key: "payment", label: "Pagamento", icon: <PaymentsOutlinedIcon fontSize="small" /> },
  ];
  const stepIndex = Math.max(0, steps.findIndex((x) => x.key === step));
  const current = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;
  const reset = () => {
    setStep("client");
    setOrderType("delivery"); setPhone(""); setName(""); setCustomerId(null); setAddress(EMPTY_ADDRESS); setComplement("");
    setSource("telefone"); setCart([]); setFee(""); setPayment("dinheiro");
    setChangeFor(""); setNotes(""); setSaveCustomer(true); setError(""); setFound("");
  };

  // Taxa sugerida pelo bairro (o banco aplica a mesma regra se ficar vazio).
  const zoneFee = useMemo(() => {
    const norm = (t) => (t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
    const z = zones.find((z) => z.active && norm(z.name) === norm(address.neighborhood));
    return z ? Number(z.fee) : null;
  }, [zones, address.neighborhood]);

  const subtotal = cart.reduce((s, it) => s + it.unit * it.quantity, 0);
  const feeValue = local ? 0 : fee === "" ? zoneFee || 0 : parsePrice(fee) || 0;
  const feeInvalid = !local && fee.trim() !== "" && (parsePrice(fee) == null || parsePrice(fee) < 0);
  const changeInvalid = payment === "dinheiro" && changeFor.trim() !== "" && parsePrice(changeFor) == null;

  // Balcão costuma ser venda na loja; entrega, pedido por telefone.
  const changeType = (t) => {
    if (!t || t === orderType) return;
    setOrderType(t);
    setError("");
    if (t === "local" && step === "address") setStep("client");
    setSource((s) => (t === "local" && s === "telefone" ? "balcao" : t === "delivery" && s === "balcao" ? "telefone" : s));
  };

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
      setFound("Cliente encontrado: endereço preenchido. Confirme com ele na próxima etapa.");
    } else {
      setCustomerId(null); setFound("");
    }
  };

  // Antes de sair da etapa do endereço: precisa de ponto no mapa (rota do motoboy).
  const ensureLocated = async () => {
    let addr = address;
    if ((!addr.lat || !addr.lng) && (addr.street || addr.neighborhood)) {
      const r = await locateAddress({ ...addr, city: addr.city || store?.city, state: addr.state || store?.state }, store).catch(() => null);
      if (r) {
        addr = { ...addr, neighborhood: addr.neighborhood || r.neighborhood, city: addr.city || r.city, lat: r.lat, lng: r.lng, precision: r.precision };
        setAddress(addr);
      }
    }
    return Boolean(addr.lat && addr.lng);
  };

  const stepError = (key) => {
    if (key === "client" && !local && !name.trim()) return "Informe o nome do cliente.";
    if (key === "address" && !address.street && !address.neighborhood && !address.lat) return "Digite o endereço, busque ou marque o ponto no mapa.";
    if (key === "items" && cart.length === 0) return "Adicione ao menos um produto do cardápio.";
    return "";
  };

  const next = async () => {
    if (checking) return;
    const msg = stepError(current.key);
    if (msg) { setError(msg); return; }
    if (current.key === "address") {
      setChecking(true);
      const ok = await ensureLocated();
      setChecking(false);
      if (!ok) { setError("Não achei esse endereço no mapa. Confira o endereço, use a busca ou clique no mapa no ponto da entrega."); return; }
    }
    setError("");
    setStep(steps[stepIndex + 1].key);
  };

  // Volta para qualquer etapa anterior; para frente só passando pela validação.
  const goTo = (i) => {
    if (i < stepIndex) { setError(""); setStep(steps[i].key); }
    else if (i === stepIndex + 1) next();
  };

  const handleSave = async () => {
    if (saving) return;
    setError("");
    if (!local && !name.trim()) { setStep("client"); setError("Informe o nome do cliente."); return; }
    if (cart.length === 0) { setStep("items"); setError("Adicione ao menos um produto do cardápio."); return; }
    if (feeInvalid) { setError("Taxa de entrega inválida. Use só números, ex.: 5,00."); return; }
    if (changeInvalid) { setError("Valor do troco inválido. Use só números, ex.: 50,00."); return; }
    setSaving(true);
    try {
      let addressCols = {};
      if (!local) {
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
        if (!addr.lat || !addr.lng) {
          setStep("address");
          setError("Não achei esse endereço no mapa. Confira o endereço, use a busca ou clique no mapa no ponto da entrega.");
          return;
        }
        addressCols = {
          address_street: addr.street || null, address_number: addr.number || null,
          address_complement: complement || null, address_neighborhood: addr.neighborhood || null,
          address_city: addr.city || store?.city || null, lat: addr.lat, lng: addr.lng,
        };
      }
      const digits = phone.replace(/\D/g, "") || null;

      // Salvar o cliente é um extra: se falhar, o pedido sai do mesmo jeito.
      // No pedido local só nome/telefone (não apaga o endereço já salvo).
      let custId = customerId;
      if (saveCustomer && digits && name.trim()) {
        if (custId) {
          await supabase.from("customers").update({ name: name.trim(), ...addressCols }).eq("id", custId);
        } else {
          const { data } = await supabase.from("customers")
            .insert({ company_id: companyId, name: name.trim(), phone: digits, ...addressCols }).select("id").single();
          custId = data?.id || null;
        }
      }

      // Valor dos itens calculado no banco a partir do cardápio.
      const { data, error: insertError } = await supabase.rpc("create_delivery_order", {
        p_order: {
          order_type: orderType, source, customer_id: custId, customer_name: name.trim(), customer_phone: digits,
          ...addressCols,
          delivery_fee: local || fee.trim() === "" ? null : parsePrice(fee),
          payment_method: payment,
          change_for: payment === "dinheiro" && changeFor.trim() ? parsePrice(changeFor) : null,
          notes: notes.trim() || null,
        },
        p_items: cart.map((it) => ({
          product_id: it.product.id, variant: it.variant, addon_ids: it.addons.map((a) => a.id),
          quantity: it.quantity, notes: it.notes || null,
        })),
      });
      if (insertError) { setError(insertError.message); return; }
      onCreated(data);
      reset();
      onClose();
    } catch (e) {
      setError(`Não foi possível criar o pedido: ${e?.message || "falha de conexão"}. Tente de novo.`);
    } finally {
      setSaving(false);
    }
  };

  const itemCount = cart.reduce((n, it) => n + it.quantity, 0);
  const label = (t) => <Typography sx={{ fontSize: 13, fontWeight: 700, color: "#44403C", mb: 0.8 }}>{t}</Typography>;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth fullScreen={narrow}>
      <DialogTitle sx={{ fontWeight: 800, pb: 1 }}>
        {local ? "Novo pedido local" : "Novo pedido de entrega"}
        <Typography sx={{ fontSize: 12.5, color: "#78716C", fontWeight: 600 }}>
          Etapa {stepIndex + 1} de {steps.length}: {current.label}
        </Typography>
      </DialogTitle>
      <Box sx={{ px: 3, pb: 1 }}>
        <Stepper nonLinear activeStep={stepIndex} alternativeLabel>
          {steps.map((x, i) => (
            <Step key={x.key} completed={i < stepIndex}>
              <StepButton onClick={() => goTo(i)} aria-label={`Etapa ${x.label}`}>
                <Typography sx={{ fontSize: 12, fontWeight: i === stepIndex ? 800 : 600 }}>{x.label}</Typography>
              </StepButton>
            </Step>
          ))}
        </Stepper>
      </Box>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "12px !important", minHeight: { sm: 360 } }}>
        {current.key === "client" && (
          <>
            <Box>
              {label("Como o cliente vai receber?")}
              <ToggleButtonGroup exclusive fullWidth color="primary" value={orderType}
                onChange={(_, t) => changeType(t)} aria-label="Tipo do pedido">
                <ToggleButton value="delivery" sx={{ gap: 1, py: 1.5, fontWeight: 700, textTransform: "none", fontSize: 15 }}><TwoWheelerIcon /> Entrega</ToggleButton>
                <ToggleButton value="local" sx={{ gap: 1, py: 1.5, fontWeight: 700, textTransform: "none", fontSize: 15 }}><StorefrontIcon /> Pedido local</ToggleButton>
              </ToggleButtonGroup>
              <Typography sx={{ fontSize: 12.5, color: "#78716C", mt: 0.8 }}>
                {local ? "Retirada ou consumo na loja: sem endereço, sem taxa de entrega e sem motoboy." : "Vai com motoboy: na próxima etapa você informa o endereço."}
              </Typography>
            </Box>
            <Box>
              {label("Quem é o cliente?")}
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                <TextField label={local ? "Telefone (opcional)" : "Telefone do cliente"} value={phone} inputMode="tel" autoFocus
                  onChange={(e) => setPhone(e.target.value)} onBlur={lookupCustomer}
                  helperText={found && !local ? "" : "Com o telefone, o cliente já cadastrado é preenchido sozinho."} />
                {found && !local && <Alert severity="success" sx={{ py: 0 }}>{found}</Alert>}
                <TextField label={local ? "Nome do cliente (opcional)" : "Nome do cliente"} value={name} onChange={(e) => setName(e.target.value)} />
              </Box>
            </Box>
          </>
        )}

        {current.key === "address" && (
          <>
            {!store && (
              <Alert severity="info" sx={{ py: 0 }}>Cadastre o endereço da loja em "Entregas: ajustes" para as buscas priorizarem a sua cidade e as rotas saírem da loja.</Alert>
            )}
            <Alert severity="warning" sx={{ py: 0.3 }}>
              {customerId
                ? "Endereço salvo do cliente: confirme com ele se ainda é este (rua, número e referência) antes de seguir."
                : "Confirme o endereço com o cliente (rua, número e referência) antes de seguir."}
            </Alert>
            <DeliveryAddressField value={address} onChange={setAddress} store={store} />
            <TextField label="Complemento / referência" value={complement} onChange={(e) => setComplement(e.target.value)}
              placeholder="Ex.: apto 12, casa dos fundos, perto da padaria" />
          </>
        )}

        {current.key === "items" && (
          <>
            {menu.items.length === 0 && (
              <Alert severity="info" sx={{ py: 0 }}>Nenhum produto no cardápio. O admin da empresa cadastra na aba “Cardápio”.</Alert>
            )}
            <ProductPicker menu={menu} onAdd={(it) => { setCart([...cart, it]); setError(""); }} />
            <Box>
              {label(`No pedido${itemCount ? ` (${itemCount})` : ""}`)}
              <Cart cart={cart} setCart={setCart} />
            </Box>
          </>
        )}

        {current.key === "payment" && (
          <>
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5 }}>
              <TextField select label="Pagamento" value={payment} onChange={(e) => setPayment(e.target.value)}>
                {Object.entries(PAYMENT_LABEL).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
              </TextField>
              {payment === "dinheiro" ? (
                <TextField label="Troco para" value={changeFor} onChange={(e) => setChangeFor(e.target.value)} inputMode="decimal"
                  error={changeInvalid} helperText={changeInvalid ? "Valor inválido" : "Deixe vazio se não precisa de troco."} />
              ) : <Box sx={{ display: { xs: "none", sm: "block" } }} />}
              {!local && (
                <TextField label="Taxa de entrega" value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal"
                  placeholder={zoneFee != null ? String(zoneFee) : ""} error={feeInvalid}
                  helperText={feeInvalid ? "Valor inválido" : zoneFee != null && fee === "" ? `Bairro: ${money(zoneFee)}` : "Vazio = taxa do bairro."} />
              )}
              <TextField select label="Origem do pedido" value={source} onChange={(e) => setSource(e.target.value)}>
                {Object.entries(SOURCE_LABEL).filter(([k]) => k !== "ifood").map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
              </TextField>
            </Box>
            <TextField label="Observações do pedido" value={notes} onChange={(e) => setNotes(e.target.value)} multiline minRows={2} />
            <Box sx={{ p: 1.5, background: "#FAFAF9", borderRadius: "12px", display: "flex", flexDirection: "column", gap: 0.5 }}>
              <SummaryLine label="Cliente" value={name.trim() || (local ? "Cliente no balcão" : "—")} />
              {!local && <SummaryLine label="Entrega em" value={orderAddress({ address_street: address.street, address_number: address.number, address_neighborhood: address.neighborhood }) || "—"} />}
              <SummaryLine label={`Produtos (${itemCount})`} value={money(subtotal)} />
              {!local && <SummaryLine label="Taxa de entrega" value={money(feeValue)} />}
              {!local && hasCourierFee && <SummaryLine label="Taxa do motoboy" value="somada ao escolher o motoboy" muted />}
              <SummaryLine label={local ? "Total" : "Total agora"} value={money(subtotal + feeValue)} strong />
            </Box>
            <FormControlLabel
              control={<Checkbox size="small" checked={saveCustomer} onChange={(e) => setSaveCustomer(e.target.checked)} />}
              label={<Typography sx={{ fontSize: 13 }}>Salvar cliente para o próximo pedido</Typography>}
              sx={{ display: local && !phone.trim() ? "none" : undefined }}
            />
          </>
        )}
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1, flexWrap: "wrap" }}>
        {itemCount > 0 && current.key !== "payment" && (
          <Typography sx={{ mr: "auto", fontSize: 13, fontWeight: 700, color: "#57534E" }}>
            {itemCount} {itemCount === 1 ? "item" : "itens"} · {money(subtotal)}
          </Typography>
        )}
        <Button onClick={onClose}>Cancelar</Button>
        {stepIndex > 0 && <Button variant="outlined" onClick={() => goTo(stepIndex - 1)}>Voltar</Button>}
        {isLast ? (
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? <CircularProgress size={18} sx={{ color: "#fff" }} /> : local ? "Criar pedido local" : "Criar pedido"}
          </Button>
        ) : (
          <Button variant="contained" onClick={next} disabled={checking}>
            {checking ? <CircularProgress size={18} sx={{ color: "#fff" }} /> : "Continuar"}
          </Button>
        )}
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
  const [lines, setLines] = useState([]);

  // Pelo id: o pedido é atualizado a cada recarga da fila, os itens não mudam.
  const orderId = order?.id;
  useEffect(() => {
    if (!orderId) return;
    supabase.from("delivery_order_items").select("*").eq("order_id", orderId).order("position")
      .then(({ data }) => setLines(data || []));
  }, [orderId]);

  useEffect(() => {
    if (!orderId || !company?.feature_delivery_code) return;
    supabase.from("order_delivery_codes").select("code, locked, failed_attempts").eq("order_id", orderId).maybeSingle()
      .then(({ data }) => setCode(data));
  }, [orderId, company]);

  if (!order) return null;

  const run = async (fn) => {
    if (busy) return false;
    setBusy(true); setError("");
    try {
      const { error: err } = await fn();
      if (err) { setError(err.message); return false; }
    } catch (e) {
      setError(`Falha de conexão: ${e?.message || "tente de novo"}.`);
      return false;
    } finally {
      setBusy(false);
    }
    onChanged();
    return true;
  };
  const local = isLocal(order);

  const setStatus = (status) => run(() => supabase.from("delivery_orders").update({ status }).eq("id", order.id));
  const inQueue = ["received", "preparing", "ready"].includes(order.status) && !order.run_id;
  const onRoute = ["on_route", "problem"].includes(order.status);

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          Pedido #{order.number} <StatusChip status={order.status} />
          {local && <Chip size="small" icon={<StorefrontIcon />} label="Pedido local" sx={{ height: 22, fontSize: 11, fontWeight: 700 }} />}
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
          <InfoField label={local ? "Tipo" : "Motoboy"} value={local ? "Retirada / consumo na loja" : order.courier?.name || "—"} />
        </Box>
        {!local && <InfoField label="Endereço" value={orderAddress(order) || "Sem endereço"} />}
        {lines.length > 0 ? (
          <Box sx={{ p: 1.5, border: "1px solid #E7E5E4", borderRadius: "12px", display: "flex", flexDirection: "column", gap: 0.5 }}>
            {lines.map((l) => (
              <Box key={l.id} sx={{ display: "flex", justifyContent: "space-between", gap: 1 }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
                    {l.quantity}x {l.name}{l.variant ? ` (${l.variant})` : ""}{(l.addons || []).map((a) => ` + ${a.name}`).join("")}
                  </Typography>
                  {l.notes && <Typography sx={{ fontSize: 11.5, color: "#78716C" }}>{l.notes}</Typography>}
                </Box>
                <Typography sx={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>{money(l.unit_price * l.quantity)}</Typography>
              </Box>
            ))}
            <Box sx={{ borderTop: "1px solid #F5F5F4", mt: 0.5, pt: 0.7, display: "flex", flexDirection: "column", gap: 0.3 }}>
              <SummaryLine label="Produtos" value={money(order.subtotal)} />
              {!local && <SummaryLine label="Taxa de entrega" value={money(order.delivery_fee)} />}
              {order.courier_fee != null && <SummaryLine label={`Taxa do motoboy${order.courier?.name ? ` (${order.courier.name})` : ""}`} value={money(order.courier_fee)} />}
              <SummaryLine label="Total" value={money(order.total)} strong />
            </Box>
          </Box>
        ) : (
          <>
            {order.items && <InfoField label="Itens" value={<span style={{ whiteSpace: "pre-wrap", fontWeight: 500 }}>{order.items}</span>} />}
            {order.courier_fee != null && <InfoField label="Taxa do motoboy (no total)" value={money(order.courier_fee)} />}
          </>
        )}
        {order.notes && <Typography sx={{ fontSize: 12.5, color: "#78716C", fontStyle: "italic" }}>{order.notes}</Typography>}
        {order.problem_reason && order.status === "problem" && <Alert severity="warning">Motoboy informou: {order.problem_reason}</Alert>}
        {order.forced_reason && <Alert severity="info">Finalizado manualmente: {order.forced_reason}</Alert>}

        {!local && company?.feature_delivery_code && code && order.status !== "delivered" && order.status !== "cancelled" && (
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

        {!local && order.lat && order.lng && (
          <RouteMap lat={order.lat} lng={order.lng} address={orderAddress(order)}
            origin={company?.store_lat ? { lat: company.store_lat, lng: company.store_lng } : null}
            trackCollaboratorId={onRoute ? order.courier_id : null} mapHeight={220}
            checkOffRoute={Boolean(company?.strict_route_mode)} />
        )}

        {error && <Alert severity="error">{error}</Alert>}

        {inQueue && (
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            {order.status !== "received" && <Button variant="outlined" disabled={busy} onClick={() => setStatus("received")}>Voltar para recebido</Button>}
            {order.status !== "preparing" && <Button variant="outlined" disabled={busy} onClick={() => setStatus("preparing")}>Em preparo</Button>}
            {order.status !== "ready" && <Button variant={local ? "outlined" : "contained"} disabled={busy} onClick={() => setStatus("ready")}>{local ? "Pronto" : "Pronto para despacho"}</Button>}
            {local && (
              <Button variant="contained" color="success" disabled={busy}
                onClick={() => run(() => supabase.rpc("complete_local_order", { p_order_id: order.id }))}>
                Entregue ao cliente
              </Button>
            )}
            <Button color="error" disabled={busy} onClick={() => { if (window.confirm(`Cancelar o pedido #${order.number}?`)) setStatus("cancelled"); }}>Cancelar pedido</Button>
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
// fee = taxa do motoboy escolhido (entra no total dos pedidos ainda não entregues).
function StopList({ stops, setStops, fee }) {
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
              {" · total "}{money(o.status === "delivered" ? o.total : Number(o.subtotal) + Number(o.delivery_fee || 0) + Number(fee || 0))}
            </Typography>
          </Box>
          {o.status === "delivered" ? <StatusChip status="delivered" /> : (
            <>
              <IconButton size="small" aria-label="Subir parada" disabled={i === 0 || stops[i - 1]?.status === "delivered"} onClick={() => move(i, -1)}><ArrowUpwardIcon fontSize="small" /></IconButton>
              <IconButton size="small" aria-label="Descer parada" disabled={i === stops.length - 1} onClick={() => move(i, 1)}><ArrowDownwardIcon fontSize="small" /></IconButton>
              <IconButton size="small" aria-label="Tirar da saída" onClick={() => setStops(stops.filter((s) => s.id !== o.id))}><DeleteOutlineIcon fontSize="small" /></IconButton>
            </>
          )}
        </Box>
      ))}
    </Box>
  );
}

function RunDialog({ open, onClose, onDone, couriers, available, run, courierFees, shifts = [], runs = [] }) {
  const settings = useCompanySettings();
  const storePoint = settings?.store_lat ? { lat: settings.store_lat, lng: settings.store_lng } : null;
  // `run` = saída existente (editar) ou null (nova saída com os `available` selecionados).
  const [courierId, setCourierId] = useState("");
  const [stops, setStops] = useState([]);
  const [addId, setAddId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const wasOpen = useRef(false);

  // Monta a lista só ao abrir: a fila recarrega sozinha (tempo real, despacho
  // automático) e não pode apagar o que o gestor está montando.
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;
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
    if (busy) return;
    setBusy(true); setError("");
    const ids = stops.map((s) => s.id);
    try {
      const { error: err } = run
        ? await supabase.rpc("update_run", { p_run: run.id, p_order_ids: ids, p_courier: courierId })
        : await supabase.rpc("dispatch_run", { p_courier: courierId, p_order_ids: ids });
      if (err) {
        setError(/não está disponível|indisponível/.test(err.message)
          ? `${err.message} Algum pedido já saiu com outro motoboy ou mudou; feche e confira a fila.`
          : err.message);
        return;
      }
    } catch (e) {
      setError(`Falha de conexão: ${e?.message || "tente de novo"}.`);
      return;
    } finally {
      setBusy(false);
    }
    onDone();
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>{run ? "Editar saída" : "Despachar pedidos"}</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5, pt: "8px !important" }}>
        <TextField select size="small" label="Motoboy" value={courierId} onChange={(e) => setCourierId(e.target.value)}>
          {couriers.map((c) => {
            // Só dá para passar a saída para quem não está com outra.
            const busyRun = runs.some((r) => r.courier_id === c.id && r.id !== run?.id && ["planned", "in_progress"].includes(r.status));
            const shift = shifts.find((sh) => sh.courier_id === c.id);
            const state = busyRun ? "com outra saída" : shift ? (shift.paused ? "em pausa" : "livre, em expediente") : "fora do expediente";
            return (
              <MenuItem key={c.id} value={c.id} disabled={busyRun && c.id !== courierId}>
                {c.name} · {state}{courierFees[c.id] ? ` · ${money(courierFees[c.id])} por entrega` : ""}
              </MenuItem>
            );
          })}
        </TextField>
        {courierId && courierFees[courierId] > 0 && (
          <Alert severity="info" sx={{ py: 0 }}>
            A taxa de {courier?.name} ({money(courierFees[courierId])}) entra no total de cada pedido desta saída.
          </Alert>
        )}
        {groups.length > 0 && (
          <Box sx={{ display: "flex", gap: 0.6, flexWrap: "wrap" }}>
            {groups.map((g) => <Chip key={g.key} size="small" label={`${g.name}: ${g.orders.length}`} />)}
          </Box>
        )}
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: "#78716C" }}>PARADAS NA ORDEM</Typography>
          <Button size="small" startIcon={<AutoFixHighIcon />} onClick={suggest} disabled={stops.length < 2}>Sugerir ordem</Button>
        </Box>
        <StopList stops={stops} setStops={setStops} fee={courierFees[courierId]} />
        {addable.length > 0 && (
          <Box sx={{ display: "flex", gap: 1 }}>
            <TextField select size="small" label="Adicionar pedido" value={addId} onChange={(e) => setAddId(e.target.value)} sx={{ flex: 1 }}>
              {addable.map((o) => <MenuItem key={o.id} value={o.id}>#{o.number} · {o.customer_name} · {o.address_neighborhood || "sem bairro"}</MenuItem>)}
            </TextField>
            <Button disabled={!addId} onClick={() => { setStops([...stops, addable.find((o) => o.id === addId)]); setAddId(""); }}>Adicionar</Button>
          </Box>
        )}
        {run && (
          <Typography sx={{ fontSize: 11.5, color: "#A8A29E" }}>
            Pedidos removidos voltam para a fila como “Pronto”. Ao trocar o motoboy, o novo é avisado e tem o prazo inteiro para confirmar a saída.
            Depois de editada, o despacho automático não junta outros pedidos nesta saída.
          </Typography>
        )}
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

// ───────────────────────── Motoboys em expediente ─────────────────────────
function ShiftPanel({ shifts, couriers, runs, returning = [], store, onChanged }) {
  const [error, setError] = useState("");
  if (!shifts.length) return null;
  const act = async (fn) => {
    setError("");
    const { error: err } = await fn();
    if (err) setError(err.message);
    onChanged();
  };
  return (
    <Box sx={{ mb: 2 }}>
      <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: "#78716C", mb: 1 }}>EM EXPEDIENTE</Typography>
      {error && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError("")}>{error}</Alert>}
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
        {shifts.map((sh) => {
          const courier = couriers.find((c) => c.id === sh.courier_id);
          const name = courier?.name || "Motoboy";
          const run = runs.find((r) => r.courier_id === sh.courier_id);
          const back = !run && returning.find((r) => r.courier_id === sh.courier_id);
          // Na loja ou fora: automático pelo GPS (fora de rota e de volta).
          const where = run?.status === "in_progress" || back ? null : storePresence(courier, store);
          const state = (sh.paused ? "Em pausa" : run ? (run.status === "planned" ? "Saída aguardando" : "Em rota") : back ? "Voltando para a loja" : "Livre")
            + (where ? ` · ${where}` : "");
          const color = sh.paused ? "#B0793D" : run ? "#4F5BA6" : back ? "#7A5512" : "#4B7A5E";
          return (
            <Box key={sh.id} sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.2, py: 0.6, border: "1px solid #E7E5E4", borderRadius: "10px", background: "#fff" }}>
              <Box>
                <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{name}</Typography>
                <Typography sx={{ fontSize: 11, fontWeight: 700, color }}>{state}{sh.paused && sh.paused_reason ? ` · ${sh.paused_reason}` : ""}</Typography>
              </Box>
              {back && (
                <Button size="small" onClick={() => act(() => supabase.rpc("mark_back_at_store", { p_run: back.run_id, p_by: "manager" }))}>
                  Chegou
                </Button>
              )}
              <Button size="small" onClick={() => act(() => supabase.rpc("set_shift_paused", { p_paused: !sh.paused, p_courier: sh.courier_id }))}>
                {sh.paused ? "Liberar" : "Pausar"}
              </Button>
              <Button size="small" color="inherit" onClick={() => { if (window.confirm(`Encerrar o expediente de ${name}? As entregas que ainda não foram finalizadas voltam para a fila.`)) act(() => supabase.rpc("end_shift", { p_shift: sh.id })); }}>
                Encerrar
              </Button>
            </Box>
          );
        })}
      </Box>
    </Box>
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
  const [autoDispatch, setAutoDispatch] = useState(false);
  const [menu, setMenu] = useState({ items: [], addons: [] });
  const [courierFees, setCourierFees] = useState({});
  const [shifts, setShifts] = useState([]);
  const [returning, setReturning] = useState([]);
  const [deliveredToday, setDeliveredToday] = useState(0);
  const [selected, setSelected] = useState(new Set());
  const [showNew, setShowNew] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [runDialog, setRunDialog] = useState({ open: false, run: null });
  const reloadTimer = useRef(null);

  const load = useCallback(async () => {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const [o, r, z, c, comp, d, cats, prods, fees, sh, ad, back] = await Promise.all([
      supabase.from("delivery_orders").select("*, courier:courier_id(name)").eq("company_id", companyId)
        .in("status", COLUMNS).order("created_at"),
      supabase.from("delivery_runs").select("*, courier:courier_id(name)").eq("company_id", companyId)
        .in("status", ["planned", "in_progress"]).order("created_at"),
      supabase.from("delivery_zones").select("*").eq("company_id", companyId).order("name"),
      supabase.from("profiles").select("id, name, last_lat, last_lng, last_location_at").eq("company_id", companyId).eq("company_role", "collaborator").order("name"),
      supabase.rpc("my_company_settings").maybeSingle(),
      supabase.from("delivery_orders").select("id", { count: "exact", head: true }).eq("company_id", companyId)
        .eq("status", "delivered").gte("delivered_at", startOfDay.toISOString()),
      supabase.from("product_categories").select("id, name, sort_order, active").eq("company_id", companyId),
      supabase.from("products").select("*").eq("company_id", companyId).eq("active", true).order("sort_order").order("name"),
      supabase.rpc("my_courier_fees"),
      supabase.from("courier_shifts").select("id, courier_id, started_at, paused, paused_reason").eq("company_id", companyId).is("ended_at", null).order("started_at"),
      supabase.from("companies").select("auto_dispatch").eq("id", companyId).maybeSingle(),
      supabase.rpc("returning_runs"),
    ]);
    setAutoDispatch(ad.data?.auto_dispatch === true);
    setShifts(sh.data || []);
    setReturning(back.error ? [] : back.data || []);
    // Cardápio do pedido: só produtos ativos de categorias visíveis, na ordem das categorias.
    const catList = (cats.data || []).slice().sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    const catIndex = new Map(catList.map((cat, i) => [cat.id, i]));
    const hidden = new Set(catList.filter((cat) => !cat.active).map((cat) => cat.id));
    const all = prods.data || [];
    setMenu({
      items: all.filter((p) => p.kind === "item" && !hidden.has(p.category_id))
        .map((p) => ({ ...p, category_name: catList.find((cat) => cat.id === p.category_id)?.name || "Outros" }))
        .sort((a, b) => (catIndex.get(a.category_id) ?? 999) - (catIndex.get(b.category_id) ?? 999)),
      addons: all.filter((p) => p.kind === "addon"),
    });
    setCourierFees(Object.fromEntries((fees.data || []).filter((f) => Number(f.fee) > 0).map((f) => [f.courier_id, Number(f.fee)])));
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
      .on("postgres_changes", { event: "*", schema: "public", table: "courier_shifts", filter: `company_id=eq.${companyId}` }, schedule)
      .subscribe();
    // Rede de segurança do despacho automático (o banco também despacha sozinho).
    const interval = setInterval(() => { if (!document.hidden) supabase.rpc("auto_dispatch_tick").then(load); }, 30000);
    return () => { clearTimeout(reloadTimer.current); clearInterval(interval); supabase.removeChannel(channel); };
  }, [companyId, load]);

  const dispatchable = useMemo(
    () => (orders || []).filter((o) => ["received", "preparing", "ready"].includes(o.status) && !o.run_id && !isLocal(o))
      .map((o) => ({ ...o, _selected: selected.has(o.id) })),
    [orders, selected],
  );

  // Detalhe sempre com o pedido atual da fila (fecha se ele sair da fila).
  const detail = detailId ? (orders || []).find((o) => o.id === detailId) || null : null;
  const setDetail = (o) => setDetailId(o?.id || null);

  const runsWithOrders = runs.map((r) => ({
    ...r,
    orders: (orders || []).filter((o) => o.run_id === r.id).sort((a, b) => a.stop_sequence - b.stop_sequence),
  }));

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  if (orders === null) return <PageLoading />;
  const auto = autoDispatch;

  return (
    <Box>
      <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap", alignItems: "center" }}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setShowNew(true)}>Novo pedido</Button>
        {/* Com o despacho automático ligado, o sistema monta as saídas sozinho. */}
        {!auto && (
          <Button variant="outlined" startIcon={<TwoWheelerIcon />} disabled={selected.size === 0}
            onClick={() => setRunDialog({ open: true, run: null })}>
            Despachar {selected.size > 0 ? `(${selected.size})` : ""}
          </Button>
        )}
        <Button variant="text" startIcon={<SoupKitchenIcon />} onClick={() => window.open("/cozinha", "_blank", "noopener")}>
          Modo cozinha
        </Button>
        <Typography sx={{ ml: "auto", fontSize: 12.5, color: "#78716C", fontWeight: 600 }}>
          Entregues hoje: {deliveredToday}
        </Typography>
      </Box>
      {auto && (
        <Alert severity={shifts.some((sh) => !sh.paused) ? "info" : "warning"} sx={{ mb: 2 }}>
          {shifts.some((sh) => !sh.paused)
            ? "Despacho automático ligado: cada saída vai sozinha para o motoboy livre em expediente, com a melhor rota."
            : "Despacho automático ligado, mas nenhum motoboy está em expediente. Os pedidos esperam até alguém tocar em “Iniciar expediente” no app."}
        </Alert>
      )}
      <ShiftPanel shifts={shifts} couriers={couriers} runs={runs} returning={returning}
        store={company?.store_lat ? { lat: company.store_lat, lng: company.store_lng } : null} onChanged={load} />
      {zones.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>Cadastre os bairros atendidos e as taxas na aba “Entregas: ajustes” para a taxa ser preenchida sozinha.</Alert>
      )}

      {/* Fila */}
      {(() => {
        // A coluna "Com problema" só aparece quando tem pedido: as outras ficam mais largas.
        const visible = COLUMNS.filter((col) => col !== "problem" || orders.some((o) => o.status === "problem"));
        const card = (o, col, pos) => (
          <Box key={o.id} onClick={() => setDetail(o)} data-testid={col === "ready" ? "ready-order" : undefined}
            sx={{ background: "#fff", border: "1px solid #E7E5E4", borderRadius: "12px", p: 1.2, mb: 1, cursor: "pointer", "&:hover": { borderColor: "#D6D3D1" } }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.6 }}>
              {!auto && ["received", "preparing", "ready"].includes(o.status) && !o.run_id && !isLocal(o) && (
                <Checkbox size="small" sx={{ p: 0.3 }} checked={selected.has(o.id)}
                  onClick={(e) => e.stopPropagation()} onChange={() => toggle(o.id)} />
              )}
              {pos && <Typography sx={{ fontSize: 11, fontWeight: 800, color: "#fff", background: ORDER_STATUS.ready.fg, borderRadius: "6px", px: 0.6, flexShrink: 0 }}>{pos}º</Typography>}
              <Typography sx={{ fontWeight: 800, fontSize: 13.5, flexShrink: 0 }}>#{o.number}</Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.customer_name}</Typography>
              <Typography sx={{ fontSize: 11, color: "#A8A29E", flexShrink: 0 }} title={col === "ready" ? "Tempo na fila de prontos" : undefined}>
                {minutesAgo(col === "ready" && o.ready_at ? o.ready_at : o.created_at)}
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.8, mt: 0.4 }}>
              <Typography sx={{ fontSize: 11.5, color: "#78716C", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {isLocal(o) ? "🏪 Pedido local" : o.address_neighborhood || "Sem bairro"} · {money(o.total)}
              </Typography>
              {o.run_id && col !== "ready" && (
                <Typography sx={{ fontSize: 11, color: "#4F5BA6", fontWeight: 700, flexShrink: 0, maxWidth: "50%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <MotoboyIcon /> {o.courier?.name}
                </Typography>
              )}
              {o.run_id && col === "ready" && (
                <Typography sx={{ fontSize: 10.5, color: "#4F5BA6", fontWeight: 800, flexShrink: 0 }}>parada {o.stop_sequence}</Typography>
              )}
            </Box>
          </Box>
        );
        return (
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: `repeat(${visible.length}, minmax(0, 1fr))` }, gap: 1.5, mb: 3 }}>
            {visible.map((col) => {
              // Prontos formam uma fila: o que ficou pronto primeiro sai primeiro.
              const readyAt = (o) => new Date(o.ready_at || o.created_at).getTime();
              const list = orders.filter((o) => o.status === col);
              if (col === "ready") list.sort((a, b) => readyAt(a) - readyAt(b));
              // Na fila de prontos, os pedidos de uma mesma saída ficam juntos, sob o nome do motoboy.
              const blocks = [];
              if (col === "ready") {
                const pos = new Map(list.map((o, i) => [o.id, i + 1]));
                const seen = new Set();
                for (const o of list) {
                  if (!o.run_id) { blocks.push({ order: o, pos: pos.get(o.id) }); continue; }
                  if (seen.has(o.run_id)) continue;
                  seen.add(o.run_id);
                  const group = list.filter((x) => x.run_id === o.run_id).sort((a, b) => (a.stop_sequence || 0) - (b.stop_sequence || 0));
                  blocks.push({ run: o.run_id, courier: o.courier?.name, group, pos });
                }
              }
              return (
                <Box key={col} sx={{ background: "#F5F5F4", borderRadius: "14px", p: 1.2, minHeight: { md: 200 }, minWidth: 0 }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1, px: 0.5 }}>
                    <Typography sx={{ fontSize: 12, fontWeight: 800, color: ORDER_STATUS[col].fg, letterSpacing: "0.04em" }}>{ORDER_STATUS[col].label.toUpperCase()}</Typography>
                    <Typography sx={{ fontSize: 12, fontWeight: 700, color: "#A8A29E" }}>{list.length}</Typography>
                  </Box>
                  {col !== "ready" && list.map((o) => card(o, col))}
                  {col === "ready" && blocks.map((b) => b.order ? card(b.order, col, b.pos) : (
                    <Box key={b.run} sx={{ border: "1px dashed #C9CDEB", background: "#EEF0FA", borderRadius: "12px", p: 0.8, pb: 0.1, mb: 1 }}>
                      <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: "#4F5BA6", px: 0.4, mb: 0.2 }}><MotoboyIcon /> {b.courier || "Motoboy"}</Typography>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 0.4, mb: 0.6 }}>
                        <Typography sx={{ fontSize: 10.5, color: "#6B72A8", flex: 1 }}>Aguardando o motoboy confirmar a saída</Typography>
                        <Button size="small" sx={{ minWidth: 0, py: 0, fontSize: 11 }}
                          onClick={() => { const r = runsWithOrders.find((x) => x.id === b.run); if (r) setRunDialog({ open: true, run: r }); }}>
                          Editar
                        </Button>
                      </Box>
                      {b.group.map((o) => card(o, col, b.pos.get(o.id)))}
                    </Box>
                  ))}
                </Box>
              );
            })}
          </Box>
        );
      })()}

      {/* Saídas */}
      <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: "#78716C", mb: 1.5 }}>SAÍDAS EM ANDAMENTO</Typography>
      {runsWithOrders.length === 0 && <Typography sx={{ fontSize: 13, color: "#A8A29E" }}>Nenhuma saída aberta.</Typography>}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1.5 }}>
        {runsWithOrders.map((r) => (
          <Box key={r.id} sx={{ p: 2, border: "1px solid #E7E5E4", borderRadius: "14px", background: "#fff" }}>
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
              <Typography sx={{ fontWeight: 800 }}><MotoboyIcon /> {r.courier?.name}</Typography>
              <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                {r.auto && <Chip size="small" label="Automática" sx={{ height: 20, fontSize: 10.5, fontWeight: 700 }} />}
                {r.strict_route && <Chip size="small" label="Rota exata" sx={{ height: 20, fontSize: 10.5, fontWeight: 700 }} />}
                <Chip size="small" label={r.status === "planned" ? "Aguardando saída" : "Em rota"} sx={{ height: 20, fontSize: 10.5, fontWeight: 700 }} />
                <Button size="small" onClick={() => setRunDialog({ open: true, run: r })}>Editar</Button>
              </Box>
            </Box>
            {r.orders.map((o) => (
              <Typography key={o.id} sx={{ fontSize: 12.5, color: "#57534E", cursor: "pointer" }} onClick={() => setDetail(o)}>
                {o.stop_sequence}. #{o.number} {o.customer_name} · {o.address_neighborhood || "sem bairro"} · {ORDER_STATUS[o.status]?.label || o.status}
              </Typography>
            ))}
          </Box>
        ))}
      </Box>

      <NewOrderDialog open={showNew} onClose={() => setShowNew(false)} onCreated={load} companyId={companyId} zones={zones}
        menu={menu} hasCourierFee={Object.keys(courierFees).length > 0} />
      <OrderDetailDialog key={detail?.id || "none"} order={detail} company={company} onClose={() => setDetail(null)} onChanged={() => { setDetail(null); load(); }} />
      <RunDialog
        open={runDialog.open} run={runDialog.run} couriers={couriers} available={dispatchable} courierFees={courierFees}
        shifts={shifts} runs={runs}
        onClose={() => setRunDialog({ open: false, run: null })}
        onDone={() => { setSelected(new Set()); load(); }}
      />
    </Box>
  );
}
