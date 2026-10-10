import { useState } from "react";
import { Box, Typography, Collapse, IconButton } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

const read = (id) => {
  if (!id) return null;
  try { const v = localStorage.getItem(`secao:${id}`); return v === null ? null : v === "1"; } catch { return null; }
};
const write = (id, open) => {
  if (!id) return;
  try { localStorage.setItem(`secao:${id}`, open ? "1" : "0"); } catch { /* sem armazenamento */ }
};

// Bloco com título que abre e fecha. Fechado, mostra só o título e um resumo
// curto (ex.: "Ligado · até 4 entregas"), para a tela não virar um formulário
// gigante. Com `id`, o aparelho lembra se a pessoa deixou aberto ou fechado.
export default function CollapsibleSection({ id, title, summary, defaultOpen = false, action, children, sx }) {
  const [open, setOpen] = useState(() => read(id) ?? defaultOpen);
  const toggle = () => setOpen((o) => { write(id, !o); return !o; });

  return (
    <Box sx={{ border: "1px solid #E7E5E4", borderRadius: "16px", background: "#fff", mb: 2, breakInside: "avoid", ...sx }}>
      <Box sx={{ display: "flex", alignItems: "center" }}>
        <Box
          role="button" tabIndex={0} aria-expanded={open}
          onClick={toggle}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}
          sx={{
            flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 1.5, px: 2.5, py: 1.8, cursor: "pointer",
            borderRadius: "16px", "&:hover": { background: "#FAFAF9" }, "&:focus-visible": { outline: "2px solid #A8A29E" },
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 800 }}>{title}</Typography>
            {!open && summary && (
              <Typography sx={{ fontSize: 12.5, color: "#78716C", mt: 0.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {summary}
              </Typography>
            )}
          </Box>
        </Box>
        {open && action && <Box className="no-print">{action}</Box>}
        <IconButton size="small" tabIndex={-1} aria-hidden onClick={toggle}
          sx={{ mx: 1.5, transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }}>
          <ExpandMoreIcon />
        </IconButton>
      </Box>
      <Collapse in={open} unmountOnExit={false}>
        <Box sx={{ px: 2.5, pb: 2.5 }}>{children}</Box>
      </Collapse>
    </Box>
  );
}

// "Mostrar mais opções": esconde campos que quase ninguém muda.
export function MoreOptions({ label = "opções avançadas", children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Box sx={{ mt: 1 }}>
      <Box component="button" type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        sx={{
          border: 0, background: "none", p: 0, cursor: "pointer", font: "inherit",
          fontSize: 13, fontWeight: 700, color: "#57534E", display: "inline-flex", alignItems: "center", gap: 0.3,
          "&:hover": { color: "#1F2933" },
        }}>
        <ExpandMoreIcon sx={{ fontSize: 18, transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
        {open ? `Esconder ${label}` : `Mostrar ${label}`}
      </Box>
      <Collapse in={open}><Box sx={{ pt: 1.5 }}>{children}</Box></Collapse>
    </Box>
  );
}
