import { useState, useEffect, useCallback } from "react";
import { Box, Typography, Button, CircularProgress, Alert, TextField } from "@mui/material";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import supabase from "../../services/supabase";
import { useAuth } from "../../context/AuthContext";
import { refreshCompanySettings } from "../../hooks/useCompanySettings";
import { BRAND_SLOTS, checkBrandImage, brandAccept } from "../../utils/branding";
import PageLoading from "../../components/PageLoading";

function SlotCard({ slot, value, companyId, onSaved }) {
  const [preview, setPreview] = useState(null);
  const [file, setFile] = useState(null);
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState(false);

  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const result = await checkBrandImage(slot, f);
    setCheck(result);
    if (result.error) { setFile(null); setPreview(null); return; }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const save = async () => {
    const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[file.type];
    if (!ext) { setCheck({ error: `Formato inválido. Use ${slot.typesLabel}.` }); return; }
    setBusy(true);
    const path = `${companyId}/${slot.file}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("company-branding").upload(path, file, { contentType: file.type, upsert: true });
    if (upErr) { setBusy(false); setCheck({ error: upErr.message }); return; }
    const { data } = supabase.storage.from("company-branding").getPublicUrl(path);
    const { error } = await supabase.from("companies").update({ [slot.key]: data.publicUrl }).eq("id", companyId);
    setBusy(false);
    if (error) { setCheck({ error: error.message }); return; }
    setFile(null); setPreview(null); setCheck(null);
    onSaved();
  };

  const remove = async () => {
    await supabase.from("companies").update({ [slot.key]: null }).eq("id", companyId);
    onSaved();
  };

  const shown = preview || value;
  return (
    <Box sx={{ p: 2, border: "1px solid #E7E5E4", borderRadius: "14px", background: "#fff", display: "flex", flexDirection: "column", gap: 1 }}>
      <Typography sx={{ fontWeight: 800 }}>{slot.title}</Typography>
      <Typography sx={{ fontSize: 12.5, color: "#57534E" }}>
        <b>Tamanho recomendado:</b> {slot.size}<br />
        <b>Formato:</b> {slot.typesLabel} · <b>máximo</b> {slot.maxKb >= 1024 ? `${slot.maxKb / 1024} MB` : `${slot.maxKb} KB`}<br />
        <b>Onde aparece:</b> {slot.where}
      </Typography>
      <Box sx={{
        height: 120, borderRadius: "10px", border: "1px dashed #D6D3D1", display: "flex", alignItems: "center", justifyContent: "center",
        background: "repeating-conic-gradient(#F5F5F4 0% 25%, #fff 0% 50%) 50% / 16px 16px", overflow: "hidden",
      }}>
        {shown
          ? <Box component="img" src={shown} alt={slot.title} sx={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
          : <Typography sx={{ fontSize: 12, color: "#A8A29E" }}>Nenhuma imagem</Typography>}
      </Box>
      {check?.error && <Alert severity="error">{check.error}</Alert>}
      {check?.warning && <Alert severity="warning">{check.warning}</Alert>}
      {check?.dim && !check.warning && <Alert severity="success">Medida ok: {check.dim.width} × {check.dim.height} px.</Alert>}
      <Box sx={{ display: "flex", gap: 1 }}>
        <Button component="label" variant="outlined" startIcon={<UploadFileOutlinedIcon />} size="small">
          Escolher arquivo
          <input hidden type="file" accept={brandAccept(slot)} onChange={pick} />
        </Button>
        {file && <Button variant="contained" size="small" onClick={save} disabled={busy}>{busy ? <CircularProgress size={16} sx={{ color: "#fff" }} /> : "Salvar"}</Button>}
        {!file && value && <Button size="small" color="error" onClick={remove}>Remover</Button>}
      </Box>
    </Box>
  );
}

export function BrandingTab() {
  const { companyId } = useAuth();
  const [company, setCompany] = useState(null);
  const [color, setColor] = useState("#1F2933");
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("companies").select("*").eq("id", companyId).maybeSingle();
    setCompany(data);
    setColor(data?.brand_color || "#1F2933");
    refreshCompanySettings();
  }, [companyId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const saveColor = async (value) => {
    const { error } = await supabase.from("companies").update({ brand_color: value }).eq("id", companyId);
    setMsg(error ? { type: "error", text: error.message } : { type: "success", text: "Cor salva." });
    if (!error) load();
  };

  if (!company) return <PageLoading />;
  if (!company.feature_branding) {
    return <Alert severity="info">A marca própria ainda não foi liberada para a sua empresa. Fale com o administrador da plataforma.</Alert>;
  }

  return (
    <Box>
      <Typography sx={{ fontSize: 13, color: "#78716C", mb: 2, maxWidth: 720 }}>
        Envie as imagens da sua empresa para o sistema aparecer com a sua marca para a equipe e para os seus clientes.
        Cada campo mostra a medida recomendada; o sistema confere a imagem antes de salvar.
      </Typography>
      {msg && <Alert severity={msg.type} sx={{ mb: 2 }} onClose={() => setMsg(null)}>{msg.text}</Alert>}
      <Box sx={{ p: 2, border: "1px solid #E7E5E4", borderRadius: "14px", background: "#fff", mb: 2, display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
        <Box>
          <Typography sx={{ fontWeight: 800 }}>Cor principal</Typography>
          <Typography sx={{ fontSize: 12.5, color: "#57534E" }}>Botões e destaques. Código de cor (ex.: #E30613).</Typography>
        </Box>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 44, height: 36, border: "none", background: "none" }} />
        <TextField size="small" value={color} onChange={(e) => setColor(e.target.value)} sx={{ width: 120 }} />
        <Button variant="outlined" size="small" disabled={!/^#[0-9A-Fa-f]{6}$/.test(color)} onClick={() => saveColor(color)}>Salvar cor</Button>
        {company.brand_color && <Button size="small" color="error" onClick={() => saveColor(null)}>Voltar ao padrão</Button>}
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2 }}>
        {BRAND_SLOTS.map((slot) => (
          <SlotCard key={slot.key} slot={slot} value={company[slot.key]} companyId={companyId} onSaved={load} />
        ))}
      </Box>
    </Box>
  );
}
