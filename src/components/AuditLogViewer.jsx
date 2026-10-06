import { useState, useEffect, useCallback } from "react";
import { Box, Typography, CircularProgress, Button } from "@mui/material";
import supabase from "../services/supabase";
import PageLoading from "./PageLoading";

const ACTION_LABEL = {
  collaborator_removed: "Colaborador removido",
  collaborator_role_changed: "Papel de colaborador alterado",
  collaborator_joined: "Colaborador entrou na empresa",
  company_admin_joined: "Administrador entrou na empresa",
  assignment_created: "Designação criada",
  assignment_cancelled: "Designação cancelada",
  assignment_reassigned: "Designação reatribuída",
  service_created: "Serviço criado",
  service_updated: "Serviço editado",
  company_status_changed: "Status da empresa alterado",
};

const PAGE_SIZE = 30;

// Log de auditoria — só leitura. As entradas são geradas pelo próprio banco
// (gatilhos e funções), nunca escritas direto pelo cliente, então dá pra
// confiar que representam o que realmente aconteceu.
export default function AuditLogViewer({ companyId }) {
  const [entries, setEntries] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    let query = supabase.from("audit_log").select("*").order("created_at", { ascending: false }).range(0, PAGE_SIZE - 1);
    if (companyId) query = query.eq("company_id", companyId);
    const { data } = await query;
    setEntries(data || []);
    setHasMore((data || []).length === PAGE_SIZE);
  }, [companyId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const loadMore = async () => {
    setLoadingMore(true);
    let query = supabase.from("audit_log").select("*").order("created_at", { ascending: false }).range(entries.length, entries.length + PAGE_SIZE - 1);
    if (companyId) query = query.eq("company_id", companyId);
    const { data } = await query;
    setLoadingMore(false);
    setEntries((prev) => [...prev, ...(data || [])]);
    setHasMore((data || []).length === PAGE_SIZE);
  };

  if (entries === null) return <PageLoading />;
  if (entries.length === 0) return <Box sx={{ py: 6, textAlign: "center", color: "#A8A29E", fontSize: 14 }}>Nenhum evento registrado ainda.</Box>;

  return (
    <Box>
      {entries.map((e) => (
        <Box key={e.id} sx={{ display: "flex", justifyContent: "space-between", py: 1.2, borderBottom: "1px solid #F5F5F4" }}>
          <Box>
            <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{ACTION_LABEL[e.action] || e.action}</Typography>
            {e.details && Object.keys(e.details).length > 0 && (
              <Typography sx={{ fontSize: 11.5, color: "#A8A29E" }}>
                {Object.entries(e.details).map(([k, v]) => `${k}: ${v}`).join(" · ")}
              </Typography>
            )}
          </Box>
          <Typography sx={{ fontSize: 11.5, color: "#A8A29E", flexShrink: 0, ml: 2 }}>
            {new Date(e.created_at).toLocaleString("pt-BR")}
          </Typography>
        </Box>
      ))}
      {hasMore && (
        <Box sx={{ textAlign: "center", mt: 1.5 }}>
          <Button onClick={loadMore} disabled={loadingMore} sx={{ fontWeight: 700, textTransform: "none" }}>
            {loadingMore ? <CircularProgress size={16} /> : "Carregar mais"}
          </Button>
        </Box>
      )}
    </Box>
  );
}
