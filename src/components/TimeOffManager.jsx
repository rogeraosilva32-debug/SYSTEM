import { useState, useEffect, useCallback } from "react";
import { Box, Typography, TextField, Button, IconButton, CircularProgress } from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import supabase from "../services/supabase";

// Usado tanto pelo colaborador (gerencia a própria disponibilidade) quanto
// pelo admin/supervisor (só visualiza, pra saber se pode designar alguém
// num período em que ele avisou que não vai estar disponível).
export default function TimeOffManager({ collaboratorId, companyId, editable = true }) {
  const [entries, setEntries] = useState(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("collaborator_time_off").select("*").eq("collaborator_id", collaboratorId)
      .gte("end_date", new Date().toISOString().slice(0, 10)).order("start_date");
    setEntries(data || []);
  }, [collaboratorId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!start || !end) { setError("Informe as duas datas."); return; }
    if (end < start) { setError("A data final precisa ser depois da inicial."); return; }
    setSaving(true);
    setError("");
    const { error: insertError } = await supabase.from("collaborator_time_off").insert({
      collaborator_id: collaboratorId, company_id: companyId, start_date: start, end_date: end, reason: reason.trim() || null,
    });
    setSaving(false);
    if (insertError) { setError(insertError.message); return; }
    setStart(""); setEnd(""); setReason("");
    load();
  };

  const handleRemove = async (id) => {
    await supabase.from("collaborator_time_off").delete().eq("id", id);
    load();
  };

  if (entries === null) return <Box sx={{ py: 2, textAlign: "center" }}><CircularProgress size={20} /></Box>;

  return (
    <Box>
      {editable && (
        <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap", alignItems: "flex-end" }}>
          <TextField size="small" label="De" type="date" value={start} onChange={(e) => setStart(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField size="small" label="Até" type="date" value={end} onChange={(e) => setEnd(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField size="small" label="Motivo (opcional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button onClick={handleAdd} disabled={saving} variant="outlined" sx={{ height: 40 }}>
            {saving ? <CircularProgress size={16} /> : "Adicionar"}
          </Button>
        </Box>
      )}
      {error && <Typography sx={{ color: "#B0463D", fontSize: 12.5, mb: 1.5 }}>{error}</Typography>}

      {entries.length === 0 ? (
        <Typography sx={{ fontSize: 12.5, color: "#A8A29E" }}>Nenhuma folga cadastrada.</Typography>
      ) : (
        entries.map((e) => (
          <Box key={e.id} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", py: 0.8, borderBottom: "1px solid #F5F5F4" }}>
            <Typography sx={{ fontSize: 12.5 }}>
              {new Date(e.start_date + "T00:00").toLocaleDateString("pt-BR")} – {new Date(e.end_date + "T00:00").toLocaleDateString("pt-BR")}
              {e.reason && <Typography component="span" sx={{ color: "#A8A29E" }}> · {e.reason}</Typography>}
            </Typography>
            {editable && (
              <IconButton size="small" onClick={() => handleRemove(e.id)}>
                <DeleteOutlineIcon sx={{ fontSize: 16, color: "#B0463D" }} />
              </IconButton>
            )}
          </Box>
        ))
      )}
    </Box>
  );
}
