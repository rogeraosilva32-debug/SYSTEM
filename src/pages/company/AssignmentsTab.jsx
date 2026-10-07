import { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, Button, TextField, MenuItem, CircularProgress, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions, IconButton, Checkbox,
  FormControlLabel, ToggleButtonGroup, ToggleButton, Tooltip, Rating,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import ViewListIcon from "@mui/icons-material/ViewList";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import PhotoCameraOutlinedIcon from "@mui/icons-material/PhotoCameraOutlined";
import AddressPicker from "../../components/AddressPicker";
import InfoField from "../../components/InfoField";
import RouteMap from "../../components/RouteMap";
import AssignmentCalendar from "../../components/AssignmentCalendar";
import supabase from "../../services/supabase";
import { useAuth } from "../../context/AuthContext";
import { forwardGeocode } from "../../utils/geocoding";
import { downloadCsv } from "../../utils/csvExport";
import PageLoading from "../../components/PageLoading";

const STATUS_LABEL = {
  scheduled: "Agendada", en_route: "A caminho", in_progress: "Em andamento",
  completed: "Concluída", cancelled: "Cancelada",
};
const STATUS_COLOR = {
  scheduled: { bg: "#F5F5F4", fg: "#57534E" },
  en_route: { bg: "#EEF2F6", fg: "#4A6C8C" },
  in_progress: { bg: "#FBF3EA", fg: "#B0793D" },
  completed: { bg: "#EEF3EF", fg: "#4B7A5E" },
  cancelled: { bg: "#F6EBEA", fg: "#B0463D" },
};
const PAGE_SIZE = 30;

function copyToClipboard(text) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

function whatsappShareUrl(phone, message) {
  const digits = (phone || "").replace(/\D/g, "");
  // Sem DDI (Brasil = 55) o WhatsApp Web não abre a conversa certa — se o
  // número não parece já ter o código do país (11 dígitos = DDD+número),
  // assume Brasil, já que é o público deste app.
  const withCountry = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(message)}`;
}

function NewAssignmentDialog({ open, onClose, onCreated, companyId, services, collaborators }) {
  const [serviceId, setServiceId] = useState("");
  const [collaboratorId, setCollaboratorId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [address, setAddress] = useState({ street: "", neighborhood: "", city: "", lat: null, lng: null });
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(60);
  const [notes, setNotes] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [frequency, setFrequency] = useState("weekly"); // "daily" | "weekly"
  const [occurrences, setOccurrences] = useState(4);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setServiceId(""); setCollaboratorId(""); setCustomerName(""); setCustomerPhone("");
    setAddress({ street: "", neighborhood: "", city: "", lat: null, lng: null });
    setDate(""); setTime(""); setNotes(""); setError("");
    setRepeat(false); setFrequency("weekly"); setOccurrences(4);
    const now = new Date();
    setDate(now.toISOString().slice(0, 10));
  }, [open]);

  const handleServiceChange = (id) => {
    setServiceId(id);
    const s = services.find((x) => x.id === id);
    if (s) setDuration(s.default_duration_minutes);
  };

  const handleCreate = async () => {
    if (!serviceId || !collaboratorId || !date || !time) {
      setError("Preencha serviço, colaborador, data e horário.");
      return;
    }
    if (repeat && (!occurrences || occurrences < 2 || occurrences > 52)) {
      setError("Número de repetições precisa ser entre 2 e 52.");
      return;
    }
    setSaving(true);
    setError("");

    // Se o endereço foi digitado à mão (sem usar o botão de GPS), ele ainda
    // não tem lat/lng — sem isso, nenhum mapa consegue aparecer depois pra
    // essa designação. Geocodifica o endereço digitado antes de salvar.
    let finalAddress = address;
    if (!finalAddress.lat || !finalAddress.lng) {
      const geocoded = await forwardGeocode(finalAddress);
      if (geocoded) finalAddress = { ...finalAddress, ...geocoded };
    }

    const baseStart = new Date(`${date}T${time}`);
    const count = repeat ? Number(occurrences) : 1;
    const recurrenceGroupId = repeat ? crypto.randomUUID() : null;
    const stepDays = frequency === "daily" ? 1 : 7;

    const rows = Array.from({ length: count }, (_, i) => {
      const start = new Date(baseStart);
      start.setDate(start.getDate() + i * stepDays);
      return {
        company_id: companyId,
        service_id: serviceId,
        collaborator_id: collaboratorId,
        customer_name: customerName.trim() || null,
        customer_phone: customerPhone.trim() || null,
        address_street: finalAddress.street || null,
        address_neighborhood: finalAddress.neighborhood || null,
        address_city: finalAddress.city || null,
        lat: finalAddress.lat, lng: finalAddress.lng,
        scheduled_start: start.toISOString(),
        duration_minutes: Number(duration) || 60,
        notes: notes.trim() || null,
        recurrence_group_id: recurrenceGroupId,
      };
    });

    const { data, error: insertError } = await supabase
      .from("assignments")
      .insert(rows)
      .select("*, service:service_id(name), collaborator:collaborator_id(name)");

    setSaving(false);
    if (insertError) { setError(insertError.message); return; }
    if (!finalAddress.lat || !finalAddress.lng) {
      alert("Designação criada, mas não conseguimos localizar esse endereço no mapa. Você pode editar o endereço depois usando o GPS no local, se precisar do mapa de rota.");
    }
    onCreated(data);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        Nova designação
        <IconButton onClick={onClose} size="small"><CloseIcon fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
        <TextField select label="Serviço" value={serviceId} onChange={(e) => handleServiceChange(e.target.value)} fullWidth>
          {services.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
        </TextField>
        <TextField select label="Colaborador" value={collaboratorId} onChange={(e) => setCollaboratorId(e.target.value)} fullWidth>
          {collaborators.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
        </TextField>

        <Box sx={{ display: "flex", gap: 1.5 }}>
          <TextField label="Cliente (nome)" value={customerName} onChange={(e) => setCustomerName(e.target.value)} fullWidth />
          <TextField label="Telefone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} fullWidth />
        </Box>

        <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: "#78716C", mt: 0.5 }}>ENDEREÇO DO SERVIÇO</Typography>
        <AddressPicker value={address} onChange={setAddress} showNumber gpsLabel="Usar minha localização atual" />

        <Box sx={{ display: "flex", gap: 1.5 }}>
          <TextField label="Data" type="date" value={date} onChange={(e) => setDate(e.target.value)} fullWidth slotProps={{ inputLabel: { shrink: true } }} />
          <TextField label="Horário" type="time" value={time} onChange={(e) => setTime(e.target.value)} fullWidth slotProps={{ inputLabel: { shrink: true } }} />
          <TextField label="Duração (min)" type="number" value={duration} onChange={(e) => setDuration(e.target.value)} fullWidth />
        </Box>

        <TextField label="Observações (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} fullWidth multiline minRows={2} />

        <FormControlLabel
          control={<Checkbox checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />}
          label={<Typography sx={{ fontSize: 13, fontWeight: 600 }}>Repetir esta designação</Typography>}
        />
        {repeat && (
          <Box sx={{ display: "flex", gap: 1.5, pl: 1 }}>
            <TextField select label="Frequência" value={frequency} onChange={(e) => setFrequency(e.target.value)} fullWidth>
              <MenuItem value="daily">Todos os dias</MenuItem>
              <MenuItem value="weekly">Toda semana</MenuItem>
            </TextField>
            <TextField label="Quantas vezes" type="number" value={occurrences} onChange={(e) => setOccurrences(e.target.value)} fullWidth />
          </Box>
        )}

        {error && <Typography sx={{ color: "#B0463D", fontSize: 13 }}>{error}</Typography>}
      </DialogContent>
      <DialogActions sx={{ p: 2.5, pt: 0 }}>
        <Button onClick={onClose} sx={{ color: "#78716C" }}>Cancelar</Button>
        <Button onClick={handleCreate} disabled={saving} variant="contained">
          {saving ? <CircularProgress size={18} sx={{ color: "#fff" }} /> : "Designar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function AssignmentRow({ a, onOpen }) {
  const color = STATUS_COLOR[a.status] || STATUS_COLOR.scheduled;
  return (
    <Box
      onClick={() => onOpen(a)}
      sx={{
        display: "flex", alignItems: "center", gap: 2, p: 2, mb: 1,
        border: "1px solid #E7E5E4", borderRadius: "14px", background: "#fff", cursor: "pointer",
        "&:hover": { borderColor: "#D6D3D1" },
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontWeight: 700, fontSize: 14 }}>{a.service?.name || "Serviço"}</Typography>
        <Typography sx={{ fontSize: 12.5, color: "#78716C" }}>
          {a.collaborator?.name || "—"} · {a.customer_name || "Cliente não informado"}
        </Typography>
      </Box>
      <Box sx={{ textAlign: "right", flexShrink: 0 }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>
          {new Date(a.scheduled_start).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
        </Typography>
        <Chip label={STATUS_LABEL[a.status]} size="small" sx={{ mt: 0.4, height: 20, fontSize: 10.5, fontWeight: 700, background: color.bg, color: color.fg }} />
      </Box>
    </Box>
  );
}

function AssignmentPhotos({ assignmentId, companyId }) {
  const [photos, setPhotos] = useState(null);
  const [uploading, setUploading] = useState(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("assignment_photos").select("*").eq("assignment_id", assignmentId).order("created_at");
    setPhotos(data || []);
  }, [assignmentId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const handleUpload = async (kind, file) => {
    if (!file) return;
    setUploading(kind);
    try {
      // eslint-disable-next-line react-hooks/purity -- roda dentro de um manipulador de evento (input de arquivo), nunca durante o render.
      const path = `${assignmentId}/${kind}-${Date.now()}.${file.name.split(".").pop()}`;
      const { error: uploadError } = await supabase.storage.from("assignment-photos").upload(path, file);
      if (uploadError) { alert("Erro ao enviar foto: " + uploadError.message); return; }

      const { data: signed } = await supabase.storage.from("assignment-photos").createSignedUrl(path, 60 * 60 * 24 * 365);
      const { error: insertError } = await supabase.from("assignment_photos").insert({
        assignment_id: assignmentId, company_id: companyId, kind, url: signed?.signedUrl || path,
      });
      if (insertError) { alert("Erro ao salvar foto: " + insertError.message); return; }
      load();
    } catch (err) {
      alert("Erro ao enviar foto: " + (err?.message || err));
    } finally {
      setUploading(null);
    }
  };

  if (photos === null) return null;

  const byKind = (k) => photos.filter((p) => p.kind === k);
  const signatures = byKind("signature");

  return (
    <Box>
      <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: "#8A8580", letterSpacing: "0.06em", textTransform: "uppercase", mb: 1.2 }}>
        Fotos do atendimento
      </Typography>
      <Box sx={{ display: "flex", gap: 2 }}>
        {["before", "after"].map((kind) => (
          <Box key={kind} sx={{ flex: 1 }}>
            <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: "#57534E", mb: 0.6 }}>{kind === "before" ? "Antes" : "Depois"}</Typography>
            <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
              {byKind(kind).map((p) => (
                <Box key={p.id} component="img" src={p.url} sx={{ width: 56, height: 56, borderRadius: "8px", objectFit: "cover", border: "1px solid #E7E5E4" }} />
              ))}
              <Button
                component="label" size="small"
                sx={{ width: 56, height: 56, minWidth: 0, border: "1px dashed #D6D3D1", borderRadius: "8px", color: "#A8A29E" }}
                disabled={uploading === kind}
              >
                {uploading === kind ? <CircularProgress size={16} /> : <PhotoCameraOutlinedIcon sx={{ fontSize: 18 }} />}
                <input hidden type="file" accept="image/*" capture="environment" onChange={(e) => handleUpload(kind, e.target.files?.[0])} />
              </Button>
            </Box>
          </Box>
        ))}
      </Box>

      {/* A assinatura ficava sendo salva certinho no banco mas nunca aparecia
          em nenhuma tela — o único jeito de ver que o cliente assinou. */}
      {signatures.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: "#57534E", mb: 0.6 }}>Assinatura do cliente</Typography>
          <Box
            component="img" src={signatures[signatures.length - 1].url}
            sx={{ width: "100%", maxWidth: 220, height: 90, objectFit: "contain", borderRadius: "8px", border: "1px solid #E7E5E4", background: "#fff" }}
          />
        </Box>
      )}
    </Box>
  );
}

// Link de avaliação: o token fica em assignment_rating_tokens (só admin/
// supervisor leem). Se não achar (ou a tabela ainda não existir), usa o
// rating_token antigo da designação; sem nenhum, esconde o link.
function RatingLink({ assignment }) {
  const [token, setToken] = useState(undefined);

  useEffect(() => {
    let cancelled = false;
    supabase.from("assignment_rating_tokens").select("token").eq("assignment_id", assignment.id).maybeSingle()
      .then(({ data, error }) => {
        if (!cancelled) setToken((!error && data?.token) || assignment.rating_token || null);
      }, () => { if (!cancelled) setToken(assignment.rating_token || null); });
    return () => { cancelled = true; };
  }, [assignment.id, assignment.rating_token]);

  if (token === undefined) return <CircularProgress size={16} />;
  if (!token) return null;

  const link = `${window.location.origin}/avaliar/${token}`;
  return (
    <>
      <Typography sx={{ fontSize: 11.5, color: "#78716C", mb: 1 }}>
        Envie este link pro cliente avaliar o atendimento (1 a 5 estrelas, sem precisar criar conta).
      </Typography>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: assignment.customer_phone ? 1 : 0 }}>
        <Typography sx={{ fontSize: 11.5, color: "#57534E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {link}
        </Typography>
        <IconButton size="small" onClick={() => copyToClipboard(link)}>
          <ContentCopyIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Box>
      {assignment.customer_phone && (
        <Button
          size="small" variant="outlined" fullWidth
          onClick={() => window.open(
            whatsappShareUrl(assignment.customer_phone, `Olá! Poderia avaliar o atendimento de hoje? ${link}`),
            "_blank", "noopener,noreferrer"
          )}
          sx={{ textTransform: "none", fontWeight: 700 }}
        >
          Enviar por WhatsApp
        </Button>
      )}
    </>
  );
}

export function AssignmentsTab() {
  const { companyId } = useAuth();
  const [assignments, setAssignments] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [services, setServices] = useState([]);
  const [collaborators, setCollaborators] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [view, setView] = useState("list"); // "list" | "calendar"
  const [reassignTo, setReassignTo] = useState("");
  const [reassigning, setReassigning] = useState(false);

  const load = useCallback(async () => {
    const [{ data: a }, { data: s }, { data: c }] = await Promise.all([
      supabase.from("assignments").select("*, service:service_id(name), collaborator:collaborator_id(name)").eq("company_id", companyId).order("scheduled_start", { ascending: false }).range(0, PAGE_SIZE - 1),
      supabase.from("services").select("*").eq("company_id", companyId).eq("active", true),
      supabase.from("profiles").select("*").eq("company_id", companyId).eq("company_role", "collaborator"),
    ]);
    setAssignments(a || []);
    setHasMore((a || []).length === PAGE_SIZE);
    setServices(s || []);
    setCollaborators(c || []);
  }, [companyId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const loadMore = async () => {
    setLoadingMore(true);
    const { data } = await supabase
      .from("assignments").select("*, service:service_id(name), collaborator:collaborator_id(name)")
      .eq("company_id", companyId).order("scheduled_start", { ascending: false })
      .range(assignments.length, assignments.length + PAGE_SIZE - 1);
    setLoadingMore(false);
    setAssignments((prev) => [...prev, ...(data || [])]);
    setHasMore((data || []).length === PAGE_SIZE);
  };

  const cancelAssignment = async () => {
    if (!window.confirm("Cancelar esta designação? O colaborador vai deixar de vê-la como pendente.")) return;
    setCancelling(true);
    const { data, error } = await supabase.from("assignments").update({ status: "cancelled" }).eq("id", detail.id)
      .select("*, service:service_id(name), collaborator:collaborator_id(name)").single();
    setCancelling(false);
    if (error) { alert("Erro ao cancelar: " + error.message); return; }
    setDetail(data);
    setAssignments((prev) => prev.map((a) => (a.id === data.id ? data : a)));
  };

  const reassignAssignment = async () => {
    if (!reassignTo) return;
    setReassigning(true);
    const { data, error } = await supabase.from("assignments").update({ collaborator_id: reassignTo }).eq("id", detail.id)
      .select("*, service:service_id(name), collaborator:collaborator_id(name)").single();
    setReassigning(false);
    if (error) { alert("Erro ao reatribuir: " + error.message); return; }
    setDetail(data);
    setReassignTo("");
    setAssignments((prev) => prev.map((a) => (a.id === data.id ? data : a)));
  };

  const exportCsv = () => {
    downloadCsv("designacoes.csv", assignments, [
      { key: "service", label: "Serviço", get: (a) => a.service?.name || "" },
      { key: "collaborator", label: "Colaborador", get: (a) => a.collaborator?.name || "" },
      { key: "customer_name", label: "Cliente" },
      { key: "customer_phone", label: "Telefone" },
      { key: "address_street", label: "Endereço" },
      { key: "scheduled_start", label: "Início", get: (a) => new Date(a.scheduled_start).toLocaleString("pt-BR") },
      { key: "duration_minutes", label: "Duração (min)" },
      { key: "status", label: "Status", get: (a) => STATUS_LABEL[a.status] || a.status },
      { key: "customer_rating", label: "Nota do cliente" },
    ]);
  };

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2, flexWrap: "wrap", gap: 1.5 }}>
        <ToggleButtonGroup value={view} exclusive size="small" onChange={(_, v) => v && setView(v)}>
          <ToggleButton value="list"><ViewListIcon sx={{ fontSize: 18 }} /></ToggleButton>
          <ToggleButton value="calendar"><CalendarMonthIcon sx={{ fontSize: 18 }} /></ToggleButton>
        </ToggleButtonGroup>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Tooltip title="Exportar CSV">
            <span>
              <IconButton onClick={exportCsv} disabled={!assignments?.length} sx={{ border: "1px solid #E7E5E4", borderRadius: "10px" }}>
                <FileDownloadOutlinedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </Tooltip>
          <Button
            startIcon={<AddIcon />} variant="contained" onClick={() => setDialogOpen(true)}
            disabled={services.length === 0 || collaborators.length === 0}
            sx={{ borderRadius: "10px" }}
          >
            Nova designação
          </Button>
        </Box>
      </Box>

      {(services.length === 0 || collaborators.length === 0) && (
        <Typography sx={{ fontSize: 12.5, color: "#B0793D", mb: 2 }}>
          Cadastre pelo menos um serviço e um colaborador antes de criar designações.
        </Typography>
      )}

      {assignments === null ? (
        <PageLoading />
      ) : assignments.length === 0 ? (
        <Box sx={{ py: 6, textAlign: "center", color: "#A8A29E", fontSize: 14 }}>Nenhuma designação ainda.</Box>
      ) : view === "calendar" ? (
        <AssignmentCalendar companyId={companyId} onOpen={setDetail} />
      ) : (
        <>
          {assignments.map((a) => <AssignmentRow key={a.id} a={a} onOpen={setDetail} />)}
          {hasMore && (
            <Box sx={{ textAlign: "center", mt: 1 }}>
              <Button onClick={loadMore} disabled={loadingMore} sx={{ fontWeight: 700, textTransform: "none" }}>
                {loadingMore ? <CircularProgress size={16} /> : "Carregar mais"}
              </Button>
            </Box>
          )}
        </>
      )}

      <NewAssignmentDialog
        open={dialogOpen} onClose={() => setDialogOpen(false)} companyId={companyId}
        services={services} collaborators={collaborators}
        onCreated={(rows) => setAssignments((prev) => [...rows, ...prev])}
      />

      <Dialog open={!!detail} onClose={() => { setDetail(null); setReassignTo(""); }} maxWidth="sm" fullWidth>
        {detail && (
          <>
            <DialogTitle sx={{ fontWeight: 800, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              {detail.service?.name}
              <IconButton onClick={() => setDetail(null)} size="small"><CloseIcon fontSize="small" /></IconButton>
            </DialogTitle>
            <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
                <InfoField label="Colaborador" value={detail.collaborator?.name || "—"} />
                <InfoField label="Cliente" value={detail.customer_name || "Não informado"} />
                <InfoField label="Início" value={new Date(detail.scheduled_start).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })} />
                <InfoField label="Duração" value={`${detail.duration_minutes} min`} />
              </Box>
              <RouteMap
                lat={detail.lat} lng={detail.lng}
                address={[detail.address_street, detail.address_neighborhood, detail.address_city].filter(Boolean).join(", ")}
                trackCollaboratorId={detail.status === "in_progress" ? detail.collaborator_id : null}
              />
              {detail.notes && <Typography sx={{ fontSize: 12.5, color: "#78716C", fontStyle: "italic" }}>{detail.notes}</Typography>}

              <AssignmentPhotos assignmentId={detail.id} companyId={companyId} />

              {detail.status === "completed" && (
                <Box sx={{ p: 1.5, background: "#F5F5F4", borderRadius: "10px" }}>
                  {detail.customer_rating ? (
                    <>
                      <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: "#8A8580", letterSpacing: "0.06em", textTransform: "uppercase", mb: 0.6 }}>Avaliação do cliente</Typography>
                      <Rating value={detail.customer_rating} readOnly size="small" />
                      {detail.customer_feedback && <Typography sx={{ fontSize: 12.5, color: "#57534E", mt: 0.5 }}>"{detail.customer_feedback}"</Typography>}
                    </>
                  ) : (
                    <>
                      <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: "#8A8580", letterSpacing: "0.06em", textTransform: "uppercase", mb: 0.6 }}>Avaliação do cliente</Typography>
                      <RatingLink assignment={detail} />
                    </>
                  )}
                </Box>
              )}

              {["scheduled", "in_progress"].includes(detail.status) && (
                <Box sx={{ display: "flex", gap: 1, alignItems: "center", mt: 0.5 }}>
                  <TextField
                    select size="small" label="Reatribuir a" value={reassignTo} onChange={(e) => setReassignTo(e.target.value)} fullWidth
                  >
                    {collaborators.filter((c) => c.id !== detail.collaborator_id).map((c) => (
                      <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                    ))}
                  </TextField>
                  <Button onClick={reassignAssignment} disabled={!reassignTo || reassigning} sx={{ flexShrink: 0 }}>
                    {reassigning ? <CircularProgress size={16} /> : "Trocar"}
                  </Button>
                </Box>
              )}

              {["scheduled", "in_progress"].includes(detail.status) && (
                <Button
                  variant="outlined" color="error" onClick={cancelAssignment} disabled={cancelling}
                  sx={{ mt: 1, textTransform: "none", fontWeight: 700 }}
                >
                  {cancelling ? "Cancelando..." : "Cancelar designação"}
                </Button>
              )}
            </DialogContent>
          </>
        )}
      </Dialog>
    </Box>
  );
}
