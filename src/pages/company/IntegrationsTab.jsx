import { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, Button, TextField, IconButton, Chip, CircularProgress,
  Table, TableHead, TableRow, TableCell, TableBody, Dialog, DialogTitle,
  DialogContent, DialogActions, Tooltip, Alert,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import SyncIcon from "@mui/icons-material/Sync";
import CollapsibleSection from "../../components/CollapsibleSection";
import supabase from "../../services/supabase";
import { useAuth } from "../../context/AuthContext";
import { generateCode } from "../../utils/codeGenerator";

function copyToClipboard(text) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

function ApiKeysSection() {
  const { companyId } = useAuth();
  const [keys, setKeys] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [newKeyValue, setNewKeyValue] = useState("");
  const [creating, setCreating] = useState(false);
  const [keyError, setKeyError] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.from("api_keys").select("*").eq("company_id", companyId).order("created_at", { ascending: false });
    setKeys(data || []);
  }, [companyId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const createKey = async () => {
    if (creating) return;
    setCreating(true);
    setKeyError("");
    try {
      const key = `sa_${generateCode(4, 6).replace(/-/g, "").toLowerCase()}`;
      const { data, error } = await supabase.from("api_keys").insert({ company_id: companyId, key, label: label.trim() || null }).select("*").single();
      if (error) { setKeyError("Não foi possível gerar a chave: " + error.message); return; }
      setKeys((prev) => [data, ...(prev || [])]);
      setNewKeyValue(key);
      setLabel("");
    } catch (err) {
      setKeyError("Não foi possível gerar a chave: " + (err?.message || err));
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async (id) => {
    if (!window.confirm("Revogar esta chave? Qualquer sistema usando ela para de funcionar imediatamente.")) return;
    setKeyError("");
    const { data, error } = await supabase.from("api_keys").update({ revoked: true }).eq("id", id).select("*").single();
    if (error) { setKeyError("Não foi possível revogar a chave: " + error.message); return; }
    if (data) setKeys((prev) => prev.map((k) => (k.id === id ? data : k)));
  };

  return (
    <Box>
      <Typography sx={{ fontSize: 12.5, color: "#78716C", mb: 2 }}>
        Use uma chave pra ler os dados da sua empresa (colaboradores, serviços, designações) de outro
        sistema. Veja como usar na seção de documentação abaixo.
      </Typography>

      <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
        <TextField size="small" placeholder="Rótulo (ex: Integração financeira)" value={label} onChange={(e) => setLabel(e.target.value)} fullWidth />
        <Button startIcon={<AddIcon />} variant="outlined" onClick={() => { setKeyError(""); setDialogOpen(true); }} sx={{ flexShrink: 0 }}>
          Gerar chave
        </Button>
      </Box>

      {keyError && !dialogOpen && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setKeyError("")}>{keyError}</Alert>}

      {keys === null ? (
        <CircularProgress size={20} />
      ) : (
        <Table size="small">
          <TableHead><TableRow><TableCell>Rótulo</TableCell><TableCell>Chave</TableCell><TableCell>Status</TableCell><TableCell align="right">Ações</TableCell></TableRow></TableHead>
          <TableBody>
            {keys.map((k) => (
              <TableRow key={k.id}>
                <TableCell>{k.label || "—"}</TableCell>
                <TableCell sx={{ fontFamily: "monospace", fontSize: 12.5 }}>{k.key}</TableCell>
                <TableCell>
                  <Chip label={k.revoked ? "Revogada" : "Ativa"} size="small" sx={{
                    height: 20, fontSize: 10.5, fontWeight: 700,
                    background: k.revoked ? "#F6EBEA" : "#EEF3EF",
                    color: k.revoked ? "#B0463D" : "#4B7A5E",
                  }} />
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="Copiar"><IconButton size="small" onClick={() => copyToClipboard(k.key)}><ContentCopyIcon sx={{ fontSize: 15 }} /></IconButton></Tooltip>
                  {!k.revoked && (
                    <Tooltip title="Revogar"><IconButton size="small" onClick={() => revokeKey(k.id)}><DeleteOutlineIcon sx={{ fontSize: 16, color: "#B0463D" }} /></IconButton></Tooltip>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {keys.length === 0 && <TableRow><TableCell colSpan={4} sx={{ textAlign: "center", py: 3, color: "#A8A29E" }}>Nenhuma chave gerada ainda.</TableCell></TableRow>}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>Nova chave de API</DialogTitle>
        <DialogContent>
          {keyError && <Alert severity="error" sx={{ mb: 2 }}>{keyError}</Alert>}
          {newKeyValue ? (
            <Box>
              <Alert severity="warning" sx={{ mb: 2 }}>Copie agora — por segurança, essa chave não é mostrada de novo por completo.</Alert>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1.5, background: "#F5F5F4", borderRadius: "10px" }}>
                <Typography sx={{ fontFamily: "monospace", fontSize: 13, wordBreak: "break-all" }}>{newKeyValue}</Typography>
                <IconButton size="small" onClick={() => copyToClipboard(newKeyValue)}><ContentCopyIcon sx={{ fontSize: 15 }} /></IconButton>
              </Box>
            </Box>
          ) : (
            <Typography sx={{ fontSize: 13, color: "#57534E" }}>Clique em gerar pra criar uma nova chave.</Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2.5, pt: 0 }}>
          {!newKeyValue ? (
            <Button variant="contained" onClick={createKey} disabled={creating}>
              {creating ? <CircularProgress size={18} sx={{ color: "#fff" }} /> : "Gerar"}
            </Button>
          ) : (
            <Button variant="contained" onClick={() => { setDialogOpen(false); setNewKeyValue(""); }}>Concluído</Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function CrmIntegrationSection() {
  const { companyId } = useAuth();
  const [config, setConfig] = useState(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [fieldMapping, setFieldMapping] = useState('{\n  "collaborators": { "name": "full_name", "email": "email", "phone": "phone" },\n  "services": { "name": "title", "default_duration_minutes": "duration", "price": "price" }\n}');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("crm_integrations").select("*").eq("company_id", companyId).maybeSingle();
    if (data) {
      setConfig(data);
      setBaseUrl(data.base_url || "");
      setApiKey(data.api_key || "");
      if (data.field_mapping && Object.keys(data.field_mapping).length) {
        setFieldMapping(JSON.stringify(data.field_mapping, null, 2));
      }
    }
  }, [companyId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const parseMapping = () => {
    try { return JSON.parse(fieldMapping); }
    catch { return null; }
  };

  const handleSave = async () => {
    const mapping = parseMapping();
    if (!mapping) { setMessage({ type: "error", text: "O mapeamento de campos precisa ser um JSON válido." }); return; }
    setSaving(true);
    setMessage(null);
    const { data, error } = await supabase
      .from("crm_integrations")
      .upsert({ company_id: companyId, base_url: baseUrl.trim(), api_key: apiKey.trim(), field_mapping: mapping })
      .select("*")
      .single();
    setSaving(false);
    if (error) { setMessage({ type: "error", text: error.message }); return; }
    setConfig(data);
    setMessage({ type: "success", text: "Configuração salva." });
  };

  // Testar conexão e importar chamam uma Edge Function (crm-import) em vez de
  // buscar direto do navegador — evita expor a chave da CRM no cliente e
  // evita bloqueio de CORS, já que o navegador não consegue chamar a maioria
  // das APIs de terceiros diretamente. A função ainda precisa ser publicada
  // no Supabase (fonte em supabase/functions/crm-import) — sem publicar, os
  // botões abaixo retornam erro de função não encontrada, o que é esperado
  // até o deploy ser feito.
  const testConnection = async () => {
    setTesting(true);
    setMessage(null);
    const { data, error } = await supabase.functions.invoke("crm-import", { body: { company_id: companyId, mode: "test" } });
    setTesting(false);
    if (error) { setMessage({ type: "error", text: `Não foi possível testar: ${error.message}` }); return; }
    setMessage({ type: data?.ok ? "success" : "error", text: data?.message || "Teste concluído." });
  };

  const runImport = async () => {
    setImporting(true);
    setMessage(null);
    const { data, error } = await supabase.functions.invoke("crm-import", { body: { company_id: companyId, mode: "import" } });
    setImporting(false);
    if (error) { setMessage({ type: "error", text: `Falha na importação: ${error.message}` }); return; }
    setMessage({ type: "success", text: data?.message || "Importação concluída." });
    load();
  };

  return (
    <Box>
      <Typography sx={{ fontSize: 12.5, color: "#78716C", mb: 2 }}>
        Configure a API do seu CRM pra puxar colaboradores e serviços de lá automaticamente,
        em vez de cadastrar tudo manualmente aqui.
      </Typography>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 520 }}>
        <TextField label="URL base da API do CRM" placeholder="https://api.seucrm.com/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} fullWidth />
        <TextField label="Chave de API do CRM" value={apiKey} onChange={(e) => setApiKey(e.target.value)} fullWidth type="password" />
        <TextField
          label="Mapeamento de campos (JSON)" value={fieldMapping} onChange={(e) => setFieldMapping(e.target.value)}
          fullWidth multiline minRows={6}
          helperText='Diz de onde vem cada campo na resposta do seu CRM — ajuste os nomes à direita conforme a API real.'
          sx={{ "& textarea": { fontFamily: "monospace", fontSize: 12.5 } }}
        />

        {message && <Alert severity={message.type}>{message.text}</Alert>}

        {config?.last_synced_at && (
          <Typography sx={{ fontSize: 12, color: "#A8A29E" }}>
            Última sincronização: {new Date(config.last_synced_at).toLocaleString("pt-BR")}
          </Typography>
        )}

        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
          <Button variant="outlined" onClick={testConnection} disabled={testing}>
            {testing ? <CircularProgress size={16} /> : "Testar conexão"}
          </Button>
          <Button variant="outlined" startIcon={<SyncIcon sx={{ fontSize: 16 }} />} onClick={runImport} disabled={importing || !config}>
            {importing ? <CircularProgress size={16} /> : "Importar agora"}
          </Button>
          <Button variant="contained" onClick={handleSave} disabled={saving} sx={{ ml: "auto" }}>
            {saving ? <CircularProgress size={16} sx={{ color: "#fff" }} /> : "Salvar configuração"}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}

export function IntegrationsTab() {
  return (
    <Box sx={{ maxWidth: 860 }}>
      <Typography sx={{ fontSize: 13, color: "#78716C", mb: 2 }}>
        Só para quem liga o sistema a outros programas. Se você não usa, pode ignorar esta tela.
      </Typography>
      <CollapsibleSection id="integracoes-api" title="Chaves de API (saída de dados)" summary="Para outro sistema ler os dados da sua empresa">
        <ApiKeysSection />
      </CollapsibleSection>
      <CollapsibleSection id="integracoes-crm" title="Importar de um CRM (entrada de dados)" summary="Puxar colaboradores e serviços de outro sistema">
        <CrmIntegrationSection />
      </CollapsibleSection>
    </Box>
  );
}
