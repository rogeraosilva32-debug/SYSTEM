import { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, Chip, CircularProgress, Button, Dialog, DialogTitle,
  DialogContent, IconButton, Alert,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import CheckIcon from "@mui/icons-material/Check";
import DirectionsIcon from "@mui/icons-material/Directions";
import NearMeIcon from "@mui/icons-material/NearMe";
import AppShell from "../components/AppShell";
import RouteMap from "../components/RouteMap";
import InfoField from "../components/InfoField";
import SignaturePad from "../components/SignaturePad";
import supabase from "../services/supabase";
import { useAuth } from "../context/AuthContext";
import PageLoading from "../components/PageLoading";

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

function TaskCard({ a, onOpen }) {
  const color = STATUS_COLOR[a.status] || STATUS_COLOR.scheduled;
  return (
    <Box
      onClick={() => onOpen(a)}
      sx={{
        p: 2.5, mb: 1.5, border: "1px solid #E7E5E4", borderRadius: "16px", background: "#fff",
        cursor: "pointer", "&:hover": { borderColor: "#D6D3D1" },
      }}
    >
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 1.5 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700, fontSize: 15 }}>{a.service?.name || "Serviço"}</Typography>
          <Typography sx={{ fontSize: 12.5, color: "#78716C", mt: 0.2 }}>
            {a.customer_name || "Cliente não informado"}
          </Typography>
          <Typography sx={{ fontSize: 12.5, color: "#A8A29E", mt: 0.2 }}>
            {[a.address_street, a.address_neighborhood, a.address_city].filter(Boolean).join(", ") || "Sem endereço"}
          </Typography>
        </Box>
        <Chip label={STATUS_LABEL[a.status]} size="small" sx={{ height: 22, fontSize: 11, fontWeight: 700, background: color.bg, color: color.fg, flexShrink: 0 }} />
      </Box>
      <Box sx={{ display: "flex", gap: 2, mt: 1.5, pt: 1.5, borderTop: "1px solid #F5F5F4" }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: "#292524" }}>
          {new Date(a.scheduled_start).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
        </Typography>
        <Typography sx={{ fontSize: 12.5, color: "#78716C" }}>{a.duration_minutes} min</Typography>
      </Box>
    </Box>
  );
}

export default function CollaboratorTasks() {
  const { profile } = useAuth();
  const [tasks, setTasks] = useState(null);
  const [detail, setDetail] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [showSignature, setShowSignature] = useState(false);
  const [actionError, setActionError] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("assignments")
      .select("*, service:service_id(name, description)")
      .eq("collaborator_id", profile.id)
      .order("scheduled_start", { ascending: true });
    setTasks(data || []);
  }, [profile.id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  // Salva a assinatura ANTES de concluir: se ela falhar, a tarefa não é
  // marcada como concluída e o colaborador vê o erro pra tentar de novo.
  const saveSignature = async (signatureDataUrl) => {
    // Converte a assinatura (data URL) num arquivo e sobe pro storage, do
    // mesmo jeito que as fotos de antes/depois.
    const blob = await (await fetch(signatureDataUrl)).blob();
    const path = `${detail.id}/signature-${Date.now()}.png`;
    const { error: uploadError } = await supabase.storage.from("assignment-photos").upload(path, blob, { contentType: "image/png" });
    if (uploadError) throw new Error("Não foi possível salvar a assinatura: " + uploadError.message);
    const { data: signed } = await supabase.storage.from("assignment-photos").createSignedUrl(path, 60 * 60 * 24 * 365);
    const { error: insertError } = await supabase.from("assignment_photos").insert({
      assignment_id: detail.id, company_id: profile.company_id, kind: "signature", url: signed?.signedUrl || path, uploaded_by: profile.id,
    });
    if (insertError) throw new Error("Não foi possível salvar a assinatura: " + insertError.message);
  };

  const updateStatus = async (newStatus, signatureDataUrl) => {
    if (updating) return;
    setUpdating(true);
    setActionError("");
    try {
      if (signatureDataUrl) await saveSignature(signatureDataUrl);

      const patch = { status: newStatus };
      if (newStatus === "in_progress") patch.started_at = new Date().toISOString();
      if (newStatus === "completed") patch.completed_at = new Date().toISOString();

      const { data, error } = await supabase.from("assignments").update(patch).eq("id", detail.id).select("*, service:service_id(name, description)").single();
      if (error) throw new Error("Não foi possível atualizar a tarefa: " + error.message);

      setShowSignature(false);
      setDetail(data);
      setTasks((prev) => prev.map((t) => (t.id === data.id ? data : t)));
    } catch (err) {
      setActionError(err?.message || "Falha ao atualizar a tarefa.");
    } finally {
      setUpdating(false);
    }
  };

  const pending = (tasks || []).filter((t) => t.status !== "completed" && t.status !== "cancelled");
  const done = (tasks || []).filter((t) => t.status === "completed" || t.status === "cancelled");

  return (
    <AppShell title="Minhas tarefas">
      {tasks === null ? (
        <PageLoading />
      ) : tasks.length === 0 ? (
        <Box sx={{ py: 8, textAlign: "center", color: "#A8A29E", fontSize: 14 }}>
          Nenhuma tarefa designada pra você ainda.
        </Box>
      ) : (
        <>
          <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: "#78716C", mb: 1.5 }}>PENDENTES</Typography>
          {pending.length === 0 && <Typography sx={{ fontSize: 13, color: "#A8A29E", mb: 2 }}>Nenhuma tarefa pendente.</Typography>}
          {pending.map((a) => <TaskCard key={a.id} a={a} onOpen={setDetail} />)}

          {done.length > 0 && (
            <>
              <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: "#78716C", mt: 3, mb: 1.5 }}>CONCLUÍDAS / CANCELADAS</Typography>
              {done.map((a) => <TaskCard key={a.id} a={a} onOpen={setDetail} />)}
            </>
          )}
        </>
      )}

      <Dialog open={!!detail} onClose={() => { setDetail(null); setShowSignature(false); setActionError(""); }} maxWidth="xs" fullWidth>
        {detail && (
          <>
            <DialogTitle sx={{ fontWeight: 800, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              {detail.service?.name}
              <IconButton onClick={() => { setDetail(null); setShowSignature(false); setActionError(""); }} size="small"><CloseIcon fontSize="small" /></IconButton>
            </DialogTitle>
            <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pb: 3 }}>
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
                <InfoField label="Cliente" value={detail.customer_name || "Não informado"} />
                <InfoField label="Telefone" value={detail.customer_phone || "—"} />
                <InfoField label="Início" value={new Date(detail.scheduled_start).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })} />
                <InfoField label="Duração" value={`${detail.duration_minutes} min`} />
              </Box>

              <RouteMap
                lat={detail.lat} lng={detail.lng}
                address={[detail.address_street, detail.address_neighborhood, detail.address_city].filter(Boolean).join(", ")}
                showMyLocation
                broadcastMyLocation={detail.status === "in_progress"}
                assignmentId={detail.id}
              />

              {detail.lat && detail.lng && (
                <Box sx={{ display: "flex", gap: 1 }}>
                  <Button
                    fullWidth variant="outlined" startIcon={<DirectionsIcon />}
                    onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${detail.lat},${detail.lng}`, "_blank", "noopener,noreferrer")}
                    sx={{ py: 1, fontWeight: 700 }}
                  >
                    Google Maps
                  </Button>
                  <Button
                    fullWidth variant="outlined" startIcon={<NearMeIcon />}
                    onClick={() => window.open(`https://waze.com/ul?ll=${detail.lat},${detail.lng}&navigate=yes`, "_blank", "noopener,noreferrer")}
                    sx={{ py: 1, fontWeight: 700 }}
                  >
                    Waze
                  </Button>
                </Box>
              )}

              {detail.status === "in_progress" && (
                <Typography sx={{ fontSize: 11, color: "#A8A29E", textAlign: "center" }}>
                  Sua localização é compartilhada com a empresa enquanto o atendimento está em andamento.
                </Typography>
              )}

              {detail.notes && <Typography sx={{ fontSize: 12.5, color: "#78716C", fontStyle: "italic" }}>{detail.notes}</Typography>}

              {actionError && <Alert severity="error" onClose={() => setActionError("")}>{actionError}</Alert>}

              {detail.status === "scheduled" && (
                <Button fullWidth variant="contained" startIcon={<PlayArrowIcon />} disabled={updating} onClick={() => updateStatus("in_progress")}>
                  {updating ? <CircularProgress size={18} sx={{ color: "#fff" }} /> : "Iniciar atendimento"}
                </Button>
              )}

              {detail.status === "in_progress" && !showSignature && (
                <Button fullWidth variant="contained" color="success" startIcon={<CheckIcon />} disabled={updating} onClick={() => setShowSignature(true)}>
                  Concluir atendimento
                </Button>
              )}

              {detail.status === "in_progress" && showSignature && (
                <>
                  <SignaturePad
                    disabled={updating}
                    onConfirm={(dataUrl) => updateStatus("completed", dataUrl)}
                    onSkip={() => updateStatus("completed", null)}
                  />
                  {updating && <Box sx={{ textAlign: "center" }}><CircularProgress size={20} /></Box>}
                </>
              )}
            </DialogContent>
          </>
        )}
      </Dialog>
    </AppShell>
  );
}
