import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Box, Typography, Button, TextField, IconButton, CircularProgress, Switch, MenuItem,
  Dialog, DialogTitle, DialogContent, DialogActions, Alert, ToggleButtonGroup, ToggleButton,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/EditOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import CollapsibleSection from "../../components/CollapsibleSection";
import supabase from "../../services/supabase";
import { useAuth } from "../../context/AuthContext";
import { money, parsePrice } from "../../utils/delivery";
import PageLoading from "../../components/PageLoading";

function Section({ title, action, children }) {
  return (
    <Box sx={{ p: 2.5, border: "1px solid #E7E5E4", borderRadius: "16px", background: "#fff", mb: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, mb: 1.5, flexWrap: "wrap" }}>
        <Typography sx={{ fontWeight: 800 }}>{title}</Typography>
        {action}
      </Box>
      {children}
    </Box>
  );
}

// Grava a nova ordem; uma reordenação por vez (cliques rápidos seriam
// gravados por cima de uma lista velha) e avisa se alguma linha falhar.
let reordering = false;
async function saveOrder(table, rows, start) {
  if (reordering) return null;
  reordering = true;
  try {
    const res = await Promise.all(rows.map((r, j) => supabase.from(table).update({ sort_order: j + start }).eq("id", r.id)));
    return res.find((r) => r.error)?.error || null;
  } catch (e) {
    return e;
  } finally {
    reordering = false;
  }
}

function priceLabel(p) {
  if (!p.variants?.length) return money(p.price);
  return p.variants.map((v) => `${v.name}: ${money(v.price)}`).join(" · ");
}

// ───────────────────────── Produto / adicional ─────────────────────────
function ProductDialog({ open, onClose, onSaved, editing, kind, categories, companyId }) {
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState("single");
  const [price, setPrice] = useState("");
  const [variants, setVariants] = useState([]);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setName(editing?.name || "");
    setCategoryId(editing?.category_id || (editing ? "" : categories[0]?.id || ""));
    setDescription(editing?.description || "");
    const hasVariants = (editing?.variants || []).length > 0;
    setMode(hasVariants ? "variants" : "single");
    setPrice(editing && !hasVariants ? String(editing.price).replace(".", ",") : "");
    setVariants(hasVariants ? editing.variants.map((v) => ({ name: v.name, price: String(v.price).replace(".", ",") })) : [{ name: "", price: "" }, { name: "", price: "" }]);
    setActive(editing?.active ?? true);
    setError("");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, editing, categories]);

  const setVariant = (i, patch) => setVariants(variants.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const moveVariant = (i, d) => {
    const next = [...variants];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setVariants(next);
  };

  const save = async () => {
    setError("");
    if (!name.trim()) { setError("Informe o nome."); return; }
    const row = {
      company_id: companyId, kind, name: name.trim(), active,
      description: kind === "item" ? description.trim() || null : null,
      category_id: kind === "item" ? categoryId || null : null,
    };
    if (kind === "item" && mode === "variants") {
      const list = variants.filter((v) => v.name.trim() || v.price !== "");
      if (list.length === 0) { setError("Cadastre ao menos uma opção ou use preço único."); return; }
      for (const v of list) {
        if (!v.name.trim()) { setError("Toda opção precisa de nome."); return; }
        if (parsePrice(v.price) == null || parsePrice(v.price) < 0) { setError(`Informe o preço de "${v.name}".`); return; }
      }
      if (new Set(list.map((v) => v.name.trim().toLowerCase())).size !== list.length) {
        setError("Há opções com o mesmo nome. Use nomes diferentes (ex.: Pequeno, Grande).");
        return;
      }
      row.variants = list.map((v) => ({ name: v.name.trim(), price: parsePrice(v.price) }));
    } else {
      const p = parsePrice(price);
      if (p == null || p < 0) { setError("Informe o preço."); return; }
      row.price = p;
      row.variants = [];
    }
    if (saving) return;
    setSaving(true);
    let err;
    try {
      ({ error: err } = editing
        ? await supabase.from("products").update(row).eq("id", editing.id)
        : await supabase.from("products").insert(row));
    } catch (e) {
      err = e;
    } finally {
      setSaving(false);
    }
    if (err) { setError(err.message || "Falha de conexão. Tente de novo."); return; }
    onSaved();
    onClose();
  };

  const isItem = kind === "item";
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        {editing ? "Editar" : "Novo"} {isItem ? "produto" : "adicional"}
      </DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5, pt: "8px !important" }}>
        <TextField label="Nome" size="small" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        {isItem && (
          <>
            <TextField select label="Categoria" size="small" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <MenuItem value="">Sem categoria</MenuItem>
              {categories.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
            <TextField label="Descrição / ingredientes" size="small" multiline minRows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v) => v && setMode(v)}>
              <ToggleButton value="single">Preço único</ToggleButton>
              <ToggleButton value="variants">Com opções de preço</ToggleButton>
            </ToggleButtonGroup>
          </>
        )}
        {(!isItem || mode === "single") && (
          <TextField label="Preço (R$)" size="small" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" sx={{ maxWidth: 200 }} />
        )}
        {isItem && mode === "variants" && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <Typography sx={{ fontSize: 12, color: "#78716C" }}>
              Ex.: Hambúrguer / Frango ou lombo, ou Normal / Aberto. No pedido, escolhe-se uma opção.
            </Typography>
            {variants.map((v, i) => (
              <Box key={i} sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                <TextField size="small" label="Opção" value={v.name} onChange={(e) => setVariant(i, { name: e.target.value })} sx={{ flex: 1 }} />
                <TextField size="small" label="Preço (R$)" value={v.price} onChange={(e) => setVariant(i, { price: e.target.value })} inputMode="decimal" sx={{ width: 120 }} />
                <IconButton size="small" disabled={i === 0} onClick={() => moveVariant(i, -1)}><ArrowUpwardIcon fontSize="small" /></IconButton>
                <IconButton size="small" disabled={i === variants.length - 1} onClick={() => moveVariant(i, 1)}><ArrowDownwardIcon fontSize="small" /></IconButton>
                <IconButton size="small" onClick={() => setVariants(variants.filter((_, j) => j !== i))}><DeleteOutlineIcon fontSize="small" /></IconButton>
              </Box>
            ))}
            <Button size="small" startIcon={<AddIcon />} sx={{ alignSelf: "flex-start" }} onClick={() => setVariants([...variants, { name: "", price: "" }])}>
              Adicionar opção
            </Button>
          </Box>
        )}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Switch checked={active} onChange={(e) => setActive(e.target.checked)} />
          <Typography sx={{ fontSize: 13 }}>{active ? "Disponível para pedidos" : "Fora do cardápio (não aparece no pedido)"}</Typography>
        </Box>
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={save} disabled={saving}>
          {saving ? <CircularProgress size={18} sx={{ color: "#fff" }} /> : "Salvar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ───────────────────────── Categorias ─────────────────────────
function Categories({ categories, products, companyId, onChanged, setError }) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(null);

  const add = async () => {
    if (!name.trim()) return;
    const sort = Math.max(0, ...categories.map((c) => c.sort_order)) + 1;
    const { error } = await supabase.from("product_categories").insert({ company_id: companyId, name: name.trim(), sort_order: sort });
    if (error) { setError(error.code === "23505" ? "Essa categoria já existe." : error.message); return; }
    setName("");
    onChanged();
  };

  const update = async (c, patch) => {
    const { error } = await supabase.from("product_categories").update(patch).eq("id", c.id);
    if (error) { setError(error.code === "23505" ? "Essa categoria já existe." : error.message); return; }
    onChanged();
  };

  // Troca a ordem com a vizinha (renumera tudo para não depender de valores repetidos).
  const move = async (i, d) => {
    const list = [...categories];
    [list[i], list[i + d]] = [list[i + d], list[i]];
    const err = await saveOrder("product_categories", list, 1);
    if (err) setError(err.message || "Não foi possível salvar a nova ordem.");
    onChanged();
  };

  const remove = async (c) => {
    const n = products.filter((p) => p.category_id === c.id).length;
    if (!window.confirm(n ? `Excluir "${c.name}"? Os ${n} produto(s) dela ficam sem categoria.` : `Excluir "${c.name}"?`)) return;
    const { error } = await supabase.from("product_categories").delete().eq("id", c.id);
    if (error) { setError(error.message); return; }
    onChanged();
  };

  return (
    <>
      <Box sx={{ display: "flex", gap: 1, mb: 1.5 }}>
        <TextField size="small" label="Nova categoria" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()} sx={{ flex: 1, maxWidth: 360 }} />
        <Button variant="contained" onClick={add}>Adicionar</Button>
      </Box>
      {categories.length === 0 && <Typography sx={{ fontSize: 13, color: "#A8A29E" }}>Nenhuma categoria. Ex.: Lanches, Hot dog, Bebidas.</Typography>}
      {categories.map((c, i) => (
        <Box key={c.id} sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.6, borderTop: "1px solid #F5F5F4", opacity: c.active ? 1 : 0.5 }}>
          {editing?.id === c.id ? (
            <TextField size="small" value={editing.name} autoFocus sx={{ flex: 1 }}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter" && editing.name.trim()) { update(c, { name: editing.name.trim() }); setEditing(null); } if (e.key === "Escape") setEditing(null); }}
              onBlur={() => { if (editing.name.trim() && editing.name.trim() !== c.name) update(c, { name: editing.name.trim() }); setEditing(null); }} />
          ) : (
            <Typography sx={{ flex: 1, fontWeight: 600, fontSize: 13.5 }}>
              {c.name} <span style={{ color: "#A8A29E", fontWeight: 500 }}>· {products.filter((p) => p.category_id === c.id).length}</span>
            </Typography>
          )}
          <IconButton size="small" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUpwardIcon fontSize="small" /></IconButton>
          <IconButton size="small" disabled={i === categories.length - 1} onClick={() => move(i, 1)}><ArrowDownwardIcon fontSize="small" /></IconButton>
          <IconButton size="small" aria-label={`Renomear ${c.name}`} onClick={() => setEditing({ id: c.id, name: c.name })}><EditIcon fontSize="small" /></IconButton>
          <Switch size="small" checked={c.active} onChange={(e) => update(c, { active: e.target.checked })} />
          <IconButton size="small" aria-label={`Excluir ${c.name}`} onClick={() => remove(c)}><DeleteOutlineIcon fontSize="small" /></IconButton>
        </Box>
      ))}
    </>
  );
}

// ───────────────────────── Aba Cardápio ─────────────────────────
// O admin da empresa cadastra categorias, produtos (com opções de preço)
// e adicionais. No pedido, o valor vem daqui.
export function MenuTab() {
  const { companyId } = useAuth();
  const [categories, setCategories] = useState(null);
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState({ open: false, kind: "item", editing: null });
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [c, p] = await Promise.all([
      supabase.from("product_categories").select("*").eq("company_id", companyId).order("sort_order").order("name"),
      supabase.from("products").select("*").eq("company_id", companyId).order("sort_order").order("name"),
    ]);
    if (c.error || p.error) {
      setError("Não foi possível carregar o cardápio. Se acabou de atualizar o sistema, rode de novo o supabase-b2b-schema.sql no Supabase.");
    }
    setCategories(c.data || []);
    setProducts(p.data || []);
  }, [companyId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => p.kind === "item" && (!q || p.name.toLowerCase().includes(q) || (p.description || "").toLowerCase().includes(q)));
  }, [products, search]);
  const addons = products.filter((p) => p.kind === "addon");

  const groups = useMemo(() => {
    const list = (categories || []).map((c) => ({ key: c.id, name: c.name, active: c.active, items: items.filter((p) => p.category_id === c.id) }));
    const loose = items.filter((p) => !p.category_id || !(categories || []).some((c) => c.id === p.category_id));
    if (loose.length) list.push({ key: "none", name: "Sem categoria", active: true, items: loose });
    return list.filter((g) => g.items.length > 0 || !search.trim());
  }, [categories, items, search]);

  const toggleProduct = async (p, active) => {
    const { error: err } = await supabase.from("products").update({ active }).eq("id", p.id);
    if (err) setError(err.message); else load();
  };

  const removeProduct = async (p) => {
    if (!window.confirm(`Excluir "${p.name}"? Pedidos antigos continuam com o nome e o valor.`)) return;
    const { error: err } = await supabase.from("products").delete().eq("id", p.id);
    if (err) setError(err.message); else load();
  };

  const moveProduct = async (list, i, d) => {
    const next = [...list];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    const err = await saveOrder("products", next, 0);
    if (err) setError(err.message || "Não foi possível salvar a nova ordem.");
    load();
  };

  if (categories === null) return <PageLoading />;

  const row = (p, list, i) => (
    <Box key={p.id} sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.9, borderTop: "1px solid #F5F5F4", opacity: p.active ? 1 : 0.5 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontWeight: 700, fontSize: 13.5 }}>{p.name}</Typography>
        {p.description && <Typography sx={{ fontSize: 11.5, color: "#78716C" }}>{p.description}</Typography>}
        <Typography sx={{ fontSize: 12, color: "#44403C", fontWeight: 600, mt: 0.2 }}>{priceLabel(p)}</Typography>
      </Box>
      {!search.trim() && (
        <>
          <IconButton size="small" disabled={i === 0} onClick={() => moveProduct(list, i, -1)}><ArrowUpwardIcon fontSize="small" /></IconButton>
          <IconButton size="small" disabled={i === list.length - 1} onClick={() => moveProduct(list, i, 1)}><ArrowDownwardIcon fontSize="small" /></IconButton>
        </>
      )}
      <IconButton size="small" aria-label={`Editar ${p.name}`} onClick={() => setDialog({ open: true, kind: p.kind, editing: p })}><EditIcon fontSize="small" /></IconButton>
      <Switch size="small" checked={p.active} onChange={(e) => toggleProduct(p, e.target.checked)} />
      <IconButton size="small" aria-label={`Excluir ${p.name}`} onClick={() => removeProduct(p)}><DeleteOutlineIcon fontSize="small" /></IconButton>
    </Box>
  );

  return (
    <Box sx={{ maxWidth: 860 }}>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>{error}</Alert>}

      <Section title="Produtos" action={
        <Box sx={{ display: "flex", gap: 1 }}>
          <TextField size="small" placeholder="Buscar" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ width: 180 }} />
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({ open: true, kind: "item", editing: null })}>Novo produto</Button>
        </Box>
      }>
        {items.length === 0 && (
          <Typography sx={{ fontSize: 13, color: "#A8A29E" }}>
            {search.trim() ? "Nenhum produto encontrado." : "Nenhum produto cadastrado. Crie as categorias abaixo e depois os produtos."}
          </Typography>
        )}
        {groups.map((g) => (
          <Box key={g.key} sx={{ mb: 2, opacity: g.active ? 1 : 0.6 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 800, color: "#78716C", letterSpacing: "0.04em", mb: 0.5 }}>
              {g.name.toUpperCase()}{!g.active ? " (oculta)" : ""}
            </Typography>
            {g.items.length === 0 && <Typography sx={{ fontSize: 12.5, color: "#A8A29E", py: 0.5 }}>Sem produtos.</Typography>}
            {g.items.map((p, i) => row(p, g.items, i))}
          </Box>
        ))}
      </Section>

      <CollapsibleSection id="cardapio-adicionais" title="Adicionais (opcionais)"
        summary={addons.length ? `${addons.length} adicional${addons.length > 1 ? "is" : ""}: ${addons.slice(0, 4).map((a) => a.name).join(", ")}${addons.length > 4 ? "…" : ""}` : "Nenhum adicional (ex.: bacon, cheddar)"}
        action={<Button variant="outlined" startIcon={<AddIcon />} onClick={() => setDialog({ open: true, kind: "addon", editing: null })}>Novo adicional</Button>}>
        <Typography sx={{ fontSize: 12.5, color: "#78716C", mb: 1 }}>Podem ser somados a qualquer produto no pedido. Ex.: Bacon, Catupiry ou cheddar.</Typography>
        {addons.length === 0 && <Typography sx={{ fontSize: 13, color: "#A8A29E" }}>Nenhum adicional.</Typography>}
        {addons.map((p, i) => row(p, addons, i))}
      </CollapsibleSection>

      <CollapsibleSection id="cardapio-categorias" title="Categorias" defaultOpen={categories.length === 0}
        summary={categories.length ? categories.map((c) => c.name).join(", ") : "Nenhuma categoria: crie antes dos produtos"}>
        <Categories categories={categories} products={products} companyId={companyId} onChanged={load} setError={setError} />
      </CollapsibleSection>

      <ProductDialog
        open={dialog.open} kind={dialog.kind} editing={dialog.editing} categories={categories} companyId={companyId}
        onClose={() => setDialog({ ...dialog, open: false })} onSaved={load}
      />
    </Box>
  );
}
