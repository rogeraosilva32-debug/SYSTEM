import { Box } from "@mui/material";
import { useLocation, useNavigate } from "react-router-dom";

const ITEMS = [
  { path: "/entregas", label: "Entregas" },
  { path: "/tarefas", label: "Tarefas" },
];

// Abas do colaborador: entregas (motoboy) e tarefas agendadas.
export default function CollaboratorNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return (
    <Box sx={{ display: "flex", gap: 0.5, mb: 2.5, borderBottom: "1px solid #E7E5E4" }}>
      {ITEMS.map((t) => (
        <Box
          key={t.path} onClick={() => navigate(t.path)}
          sx={{
            px: 2, py: 1.2, cursor: "pointer", fontSize: 13, fontWeight: 700,
            color: pathname === t.path ? "#1C1917" : "#A8A29E",
            borderBottom: pathname === t.path ? "2px solid #1C1917" : "2px solid transparent",
          }}
        >
          {t.label}
        </Box>
      ))}
    </Box>
  );
}
