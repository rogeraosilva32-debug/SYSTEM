import { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, Button, TextField, IconButton, Chip, CircularProgress,
  Table, TableHead, TableRow, TableCell, TableBody, Dialog, DialogTitle,
  DialogContent, DialogActions, Switch, Tooltip, MenuItem, Alert,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import EditIcon from "@mui/icons-material/EditOutlined";
import supabase from "../../services/supabase";
import { useAuth } from "../../context/AuthContext";

function copyToClipboard(text) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

function CollaboratorDialog({ open, onClose, onSaved, editing, supervisors }) {
  const [name, setName] = useState(editing?.name || "");
  const [phone, setPhone] = useState(editing?.phone || "");
  const [role, setRole] = useState(editing?.company_role || "collaborator");
  const [supervisedBy, setSupervisedBy] = useState(editing?.supervised_by || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(editing?.name || "");
    setPhone(editing?.phone || "");
    setRole(editing?.company_role || "collaborator");
    setSupervisedBy(editing?.supervised_by || "");
    setError("");
  }, [editing, open]);

  const handleSave = async () => {
    if (!name.trim()) { setError("Informe o nome."); return; }
    setSaving(true);

    const { data, error: saveError } = await supabase
      .from("profiles")
      .update({ name: name.trim(), phone: phone.trim() || null })
      .eq("id", editing.id)
      .select("*")
      .single();
    if (saveError) { setSaving(false); setError(saveError.message); return; }

    // company_role/supervised_by não podem ser alterados por update direto
    // (bloqueado no banco) — precisa passar pela função set_collaborator_role.
    if (role !== editing.company_role || supervisedBy !== (editing.supervised_by || "")) {
      const { error: roleError } = await supabase.rpc("set_collaborator_role", {
        p_collaborator_id: editing.id, p_role: role, p_supervised_by: role === "collaborator" ? (supervisedBy || null) : null,
      });
      if (roleError) { setSaving(false); setError(roleError.message.replace(/^.*?:\s*/, "")); return; }
    }

    setSaving(false);
    onSaved({ ...data, company_role: role, supervised_by: role === "collaborator" ? (supervisedBy || null) : null });
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>Editar colaborador</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
        <TextField label="Nome" value={name} onChange={(e) => { setName(e.target.value); setError(""); }} error={!!error} helperText={error} fullWidth />
        <TextField label="Telefone" value={phone} onChange={(e) => setPhone(e.target.value)} fullWidth />

        <TextField select label="Papel" value={role} onChange={(e) => setRole(e.target.value)} fullWidth>
          <MenuItem value="collaborator">Colaborador</MenuItem>
          <MenuItem value="supervisor">Supervisor (gerencia uma parte da equipe)</MenuItem>
        </TextField>

        {role === "collaborator" && supervisors.length > 0 && (
          <TextField select label="Supervisionado por (opcional)" value={supervisedBy} onChange={(e) => setSupervisedBy(e.target.value)} fullWidth>
            <MenuItem value="">Ninguém — reporta direto ao admin</MenuItem>
            {supervisors.filter((s) => s.id !== editing?.id).map((s) => (
              <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
            ))}
          </TextField>
        )}

        <Typography sx={{ fontSize: 11.5, color: "#A8A29E" }}>
          O e-mail de login não pode ser alterado por aqui.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ p: 2.5, pt: 0 }}>
        <Button onClick={onClose} sx={{ color: "#78716C" }}>Cancelar</Button>
        <Button onClick={handleSave} disabled={saving} variant="contained">
          {saving ? <CircularProgress size={18} sx={{ color: "#fff" }} /> : "Salvar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function CollaboratorsTab() {
  const { companyId } = useAuth();
  const [company, setCompany] = useState(null);
  const [collaborators, setCollaborators] = useState(null);
  const [editing, setEditing] = useState(null);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const [{ data: c, error: companyError }, { data: list, error: listError }] = await Promise.all([
        supabase.from("companies").select("*").eq("id", companyId).maybeSingle(),
        supabase.from("profiles").select("*").eq("company_id", companyId).in("company_role", ["collaborator", "supervisor"]).order("name"),
      ]);
      // Sem isso, um erro (ou empresa não encontrada) deixava o spinner girando pra sempre.
      if (companyError || listError || !c) {
        setLoadError((companyError || listError)?.message || "Empresa não encontrada.");
        return;
      }
      setCompany(c);
      setCollaborators(list || []);
    } catch (err) {
      setLoadError(err?.message || "Falha ao carregar.");
    }
  }, [companyId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const removeCollaborator = async (id) => {
    if (!window.confirm("Remover esta pessoa da empresa? Ela perde acesso e libera uma vaga.")) return;
    // Chama a função no banco em vez de um update direto — a coluna
    // company_role foi bloqueada pra update direto por qualquer usuário
    // (ver supabase-b2b-schema.sql), então a remoção precisa passar por
    // uma função que confirma que quem está pedindo é admin da empresa certa.
    const { error } = await supabase.rpc("remove_collaborator", { p_collaborator_id: id });
    if (error) { alert("Erro ao remover: " + error.message); return; }
    setCollaborators((prev) => prev.filter((p) => p.id !== id));
  };

  if (loadError) {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={load}>Tentar de novo</Button>}>
        Não foi possível carregar os colaboradores: {loadError}
      </Alert>
    );
  }

  if (!company || collaborators === null) {
    return <Box sx={{ py: 6, textAlign: "center" }}><CircularProgress size={24} /></Box>;
  }

  const seatsUsed = collaborators.length;
  const seatsFull = seatsUsed >= company.seats_limit;
  const supervisors = collaborators.filter((c) => c.company_role === "supervisor");
  const nameById = Object.fromEntries(collaborators.map((c) => [c.id, c.name]));

  return (
    <Box>
      <Box sx={{
        display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 2,
        mb: 3, p: 2.5, border: "1px solid #E7E5E4", borderRadius: "14px", background: "#fff",
      }}>
        <Box>
          <Typography sx={{ fontSize: 12, fontWeight: 700, color: "#78716C", mb: 0.5 }}>
            CÓDIGO DE CONVITE PRA NOVOS COLABORADORES
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography sx={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700 }}>
              {company.collaborator_invite_code}
            </Typography>
            <Tooltip title="Copiar">
              <IconButton size="small" onClick={() => copyToClipboard(company.collaborator_invite_code)}>
                <ContentCopyIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
          </Box>
          <Typography sx={{ fontSize: 12, color: "#A8A29E", mt: 0.3 }}>
            Compartilhe este código com quem você quer adicionar como colaborador — a pessoa cria a conta
            e usa "Sou colaborador" na tela de ativação.
          </Typography>
        </Box>
        <Chip
          label={`${seatsUsed} de ${company.seats_limit} vagas usadas (colaboradores e supervisores)`}
          sx={{
            fontWeight: 700, fontSize: 12.5, height: 30,
            background: seatsFull ? "#F6EBEA" : "#F5F5F4",
            color: seatsFull ? "#B0463D" : "#57534E",
          }}
        />
      </Box>

      {seatsFull && (
        <Typography sx={{ fontSize: 12.5, color: "#B0793D", mb: 2 }}>
          Limite de vagas atingido (colaboradores e supervisores contam). Pra adicionar mais gente, fale com quem administra sua licença.
        </Typography>
      )}

      <Table size="small">
        <TableHead>
          <TableRow><TableCell>Nome</TableCell><TableCell>E-mail</TableCell><TableCell>Papel</TableCell><TableCell>Supervisor</TableCell><TableCell align="right">Ações</TableCell></TableRow>
        </TableHead>
        <TableBody>
          {collaborators.map((c) => (
            <TableRow key={c.id}>
              <TableCell sx={{ fontWeight: 600 }}>{c.name}</TableCell>
              <TableCell>{c.email}</TableCell>
              <TableCell>
                {c.company_role === "supervisor" ? (
                  <Chip label="Supervisor" size="small" sx={{ height: 20, fontSize: 10.5, fontWeight: 700, background: "#EEF2F6", color: "#4A6C8C" }} />
                ) : "Colaborador"}
              </TableCell>
              <TableCell sx={{ color: "#78716C" }}>{c.supervised_by ? (nameById[c.supervised_by] || "—") : "—"}</TableCell>
              <TableCell align="right">
                <IconButton size="small" onClick={() => setEditing(c)}>
                  <EditIcon sx={{ fontSize: 17 }} />
                </IconButton>
                <IconButton size="small" onClick={() => removeCollaborator(c.id)}>
                  <DeleteOutlineIcon sx={{ fontSize: 18, color: "#B0463D" }} />
                </IconButton>
              </TableCell>
            </TableRow>
          ))}
          {collaborators.length === 0 && (
            <TableRow><TableCell colSpan={5} sx={{ textAlign: "center", py: 4, color: "#A8A29E" }}>
              Nenhum colaborador ainda. Compartilhe o código de convite acima.
            </TableCell></TableRow>
          )}
        </TableBody>
      </Table>

      <CollaboratorDialog
        open={!!editing} onClose={() => setEditing(null)} editing={editing} supervisors={supervisors}
        onSaved={(updated) => setCollaborators((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))}
      />
    </Box>
  );
}

function ServiceDialog({ open, onClose, onSaved, companyId, editing }) {
  const [name, setName] = useState(editing?.name || "");
  const [description, setDescription] = useState(editing?.description || "");
  const [duration, setDuration] = useState(editing?.default_duration_minutes || 60);
  const [price, setPrice] = useState(editing?.price ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(editing?.name || "");
    setDescription(editing?.description || "");
    setDuration(editing?.default_duration_minutes || 60);
    setPrice(editing?.price ?? "");
    setError("");
  }, [editing, open]);

  const handleSave = async () => {
    if (!name.trim()) { setError("Informe o nome do serviço."); return; }
    setSaving(true);
    const payload = {
      company_id: companyId,
      name: name.trim(),
      description: description.trim() || null,
      default_duration_minutes: Number(duration) || 60,
      price: price === "" ? null : Number(price),
    };
    const { data, error: saveError } = editing
      ? await supabase.from("services").update(payload).eq("id", editing.id).select("*").single()
      : await supabase.from("services").insert(payload).select("*").single();
    setSaving(false);
    if (saveError) { setError(saveError.message); return; }
    onSaved(data);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>{editing ? "Editar serviço" : "Novo serviço"}</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
        <TextField label="Nome" value={name} onChange={(e) => { setName(e.target.value); setError(""); }} error={!!error} helperText={error} fullWidth />
        <TextField label="Descrição (opcional)" value={description} onChange={(e) => setDescription(e.target.value)} fullWidth multiline minRows={2} />
        <TextField label="Duração padrão (minutos)" type="number" value={duration} onChange={(e) => setDuration(e.target.value)} fullWidth />
        <TextField label="Preço (opcional)" type="number" value={price} onChange={(e) => setPrice(e.target.value)} fullWidth />
      </DialogContent>
      <DialogActions sx={{ p: 2.5, pt: 0 }}>
        <Button onClick={onClose} sx={{ color: "#78716C" }}>Cancelar</Button>
        <Button onClick={handleSave} disabled={saving} variant="contained">
          {saving ? <CircularProgress size={18} sx={{ color: "#fff" }} /> : "Salvar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function ServicesTab() {
  const { companyId } = useAuth();
  const [services, setServices] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("services").select("*").eq("company_id", companyId).order("created_at", { ascending: false });
    setServices(data || []);
  }, [companyId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const toggleActive = async (s) => {
    const { data } = await supabase.from("services").update({ active: !s.active }).eq("id", s.id).select("*").single();
    if (data) setServices((prev) => prev.map((x) => (x.id === s.id ? data : x)));
  };

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
        <Button startIcon={<AddIcon />} variant="contained" onClick={() => { setEditing(null); setDialogOpen(true); }} sx={{ borderRadius: "10px" }}>
          Novo serviço
        </Button>
      </Box>

      {services === null ? (
        <Box sx={{ py: 6, textAlign: "center" }}><CircularProgress size={24} /></Box>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow><TableCell>Nome</TableCell><TableCell>Duração</TableCell><TableCell>Preço</TableCell><TableCell>Ativo</TableCell><TableCell align="right">Ações</TableCell></TableRow>
          </TableHead>
          <TableBody>
            {services.map((s) => (
              <TableRow key={s.id}>
                <TableCell sx={{ fontWeight: 600 }}>{s.name}</TableCell>
                <TableCell>{s.default_duration_minutes} min</TableCell>
                <TableCell>{s.price != null ? `R$ ${Number(s.price).toFixed(2)}` : "—"}</TableCell>
                <TableCell><Switch size="small" checked={s.active} onChange={() => toggleActive(s)} /></TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => { setEditing(s); setDialogOpen(true); }}>
                    <EditIcon sx={{ fontSize: 17 }} />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {services.length === 0 && (
              <TableRow><TableCell colSpan={5} sx={{ textAlign: "center", py: 4, color: "#A8A29E" }}>
                Nenhum serviço cadastrado ainda.
              </TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      )}

      <ServiceDialog
        open={dialogOpen} onClose={() => setDialogOpen(false)} companyId={companyId}
        editing={editing}
        onSaved={(s) => setServices((prev) => {
          const exists = prev.some((x) => x.id === s.id);
          return exists ? prev.map((x) => (x.id === s.id ? s : x)) : [s, ...prev];
        })}
      />
    </Box>
  );
}
