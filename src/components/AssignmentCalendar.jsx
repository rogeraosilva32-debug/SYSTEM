import { useState, useMemo, useEffect, useCallback } from "react";
import { Box, Typography, IconButton, Chip } from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import supabase from "../services/supabase";
import PageLoading from "./PageLoading";

const STATUS_COLOR = {
  scheduled: { bg: "#F5F5F4", fg: "#57534E" },
  en_route: { bg: "#EEF2F6", fg: "#4A6C8C" },
  in_progress: { bg: "#FBF3EA", fg: "#B0793D" },
  completed: { bg: "#EEF3EF", fg: "#4B7A5E" },
  cancelled: { bg: "#F6EBEA", fg: "#B0463D" },
};

const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

// Visão semanal, em colunas por dia (agenda dentro de cada dia, ordenada por
// horário) — mais robusta de acertar do que uma grade de horários pixel a
// pixel, e já resolve o problema real de "lista fica difícil de enxergar a
// semana".
//
// Busca os dados da SEMANA VISÍVEL direto do banco (não reaproveita a lista
// paginada da visão em lista) — senão, numa empresa com mais de uma página
// de designações, trocar de semana no calendário mostraria dados
// incompletos sem nenhum aviso disso.
export default function AssignmentCalendar({ companyId, onOpen }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [assignments, setAssignments] = useState(null);

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);

  const load = useCallback(async () => {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const { data } = await supabase
      .from("assignments").select("*, service:service_id(name), collaborator:collaborator_id(name)")
      .eq("company_id", companyId)
      .gte("scheduled_start", weekStart.toISOString())
      .lt("scheduled_start", weekEnd.toISOString())
      .order("scheduled_start");
    setAssignments(data || []);
  }, [companyId, weekStart]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAssignments(null);
    load();
  }, [load]);

  const byDay = useMemo(() => {
    const map = {};
    days.forEach((d) => { map[d.toDateString()] = []; });
    for (const a of assignments || []) {
      const key = new Date(a.scheduled_start).toDateString();
      if (map[key]) map[key].push(a);
    }
    Object.values(map).forEach((list) => list.sort((x, y) => new Date(x.scheduled_start) - new Date(y.scheduled_start)));
    return map;
  }, [assignments, days]);

  const today = new Date().toDateString();

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
        <IconButton size="small" onClick={() => setWeekStart((d) => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; })}>
          <ChevronLeftIcon />
        </IconButton>
        <Typography sx={{ fontWeight: 700, fontSize: 13.5 }}>
          {weekStart.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – {days[6].toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
        </Typography>
        <IconButton size="small" onClick={() => setWeekStart((d) => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; })}>
          <ChevronRightIcon />
        </IconButton>
      </Box>

      {assignments === null ? (
        <PageLoading />
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(7, 1fr)" }, gap: 1 }}>
          {days.map((d) => {
            const isToday = d.toDateString() === today;
            const list = byDay[d.toDateString()] || [];
            return (
              <Box key={d.toISOString()} sx={{
                border: "1px solid #E7E5E4", borderRadius: "12px", p: 1, minHeight: 90,
                background: isToday ? "#FAFAF9" : "#fff",
                borderColor: isToday ? "#D6D3D1" : "#E7E5E4",
              }}>
                <Typography sx={{ fontSize: 11, fontWeight: 700, color: isToday ? "#1F2933" : "#A8A29E", mb: 0.6 }}>
                  {DAY_LABELS[d.getDay()]} {d.getDate()}
                </Typography>
                {list.length === 0 ? (
                  <Typography sx={{ fontSize: 10.5, color: "#D6D3D1" }}>—</Typography>
                ) : (
                  list.map((a) => {
                    const color = STATUS_COLOR[a.status] || STATUS_COLOR.scheduled;
                    return (
                      <Box
                        key={a.id} onClick={() => onOpen(a)}
                        sx={{
                          mb: 0.5, p: 0.7, borderRadius: "8px", cursor: "pointer",
                          background: color.bg, "&:hover": { opacity: 0.85 },
                        }}
                      >
                        <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: color.fg }}>
                          {new Date(a.scheduled_start).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        </Typography>
                        <Typography sx={{ fontSize: 10.5, color: "#57534E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {a.service?.name}
                        </Typography>
                        <Typography sx={{ fontSize: 9.5, color: "#A8A29E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {a.collaborator?.name}
                        </Typography>
                      </Box>
                    );
                  })
                )}
              </Box>
            );
          })}
        </Box>
      )}

      <Box sx={{ display: "flex", gap: 1.5, mt: 2, flexWrap: "wrap" }}>
        {Object.entries(STATUS_COLOR).map(([key, color]) => (
          <Chip key={key} label={key} size="small" sx={{ height: 18, fontSize: 9.5, fontWeight: 700, background: color.bg, color: color.fg }} />
        ))}
      </Box>
    </Box>
  );
}
