import { useState } from "react";
import { Box, Typography, Button, TextField, Chip } from "@mui/material";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import { PERIODS, periodRange } from "../utils/reports";
import CollapsibleSection from "./CollapsibleSection";

// Peças visuais compartilhadas pelos relatórios e pelo financeiro.

export function PeriodPicker({ value, onChange }) {
  const [key, setKey] = useState("7d");
  const [from, setFrom] = useState(value[0]);
  const [to, setTo] = useState(value[1]);

  const pick = (k) => {
    setKey(k);
    const r = periodRange(k);
    if (r) { setFrom(r[0]); setTo(r[1]); onChange(r); }
  };

  return (
    <Box className="no-print" sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center", mb: 2 }}>
      {PERIODS.map((p) => (
        <Chip key={p.key} label={p.label} onClick={() => pick(p.key)}
          color={key === p.key ? "primary" : "default"} variant={key === p.key ? "filled" : "outlined"} />
      ))}
      {key === "custom" && (
        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          <TextField size="small" type="date" label="De" value={from} onChange={(e) => setFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField size="small" type="date" label="Até" value={to} onChange={(e) => setTo(e.target.value)} InputLabelProps={{ shrink: true }} />
          <Button variant="outlined" disabled={!from || !to || to < from} onClick={() => onChange([from, to])}>Ver</Button>
        </Box>
      )}
    </Box>
  );
}

export function Stat({ label, value, hint, tone }) {
  const color = { good: "#4B7A5E", bad: "#B0463D", warn: "#B0793D" }[tone] || "#1C1917";
  return (
    <Box sx={{ p: 2, border: "1px solid #E7E5E4", borderRadius: "14px", background: "#fff", breakInside: "avoid" }}>
      <Typography sx={{ fontSize: 12, fontWeight: 700, color: "#78716C" }}>{label}</Typography>
      <Typography sx={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1.3 }}>{value}</Typography>
      {hint && <Typography sx={{ fontSize: 11.5, color: "#A8A29E" }}>{hint}</Typography>}
    </Box>
  );
}

export function StatGrid({ children }) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" }, gap: 1.5, mb: 2.5 }}>
      {children}
    </Box>
  );
}

// Com `collapsible`, vira um bloco que abre e fecha (veja CollapsibleSection).
export function Section({ title, onExport, children, actions, collapsible, id, summary, defaultOpen }) {
  if (collapsible) {
    return (
      <CollapsibleSection id={id} title={title} summary={summary} defaultOpen={defaultOpen}
        action={(actions || onExport) && (
          <Box sx={{ display: "flex", gap: 1 }}>
            {actions}
            {onExport && <Button size="small" startIcon={<FileDownloadOutlinedIcon />} onClick={onExport} sx={{ color: "#57534E" }}>CSV</Button>}
          </Box>
        )}>
        {children}
      </CollapsibleSection>
    );
  }
  return (
    <Box sx={{ p: 2.5, border: "1px solid #E7E5E4", borderRadius: "16px", background: "#fff", mb: 2.5, breakInside: "avoid" }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, mb: 1.5, flexWrap: "wrap" }}>
        <Typography sx={{ fontWeight: 800 }}>{title}</Typography>
        <Box className="no-print" sx={{ display: "flex", gap: 1 }}>
          {actions}
          {onExport && (
            <Button size="small" startIcon={<FileDownloadOutlinedIcon />} onClick={onExport} sx={{ color: "#57534E" }}>CSV</Button>
          )}
        </Box>
      </Box>
      {children}
    </Box>
  );
}

// Barras horizontais: rótulo, barra proporcional e valor.
export function BarList({ rows, format = (v) => v, empty = "Sem dados no período." }) {
  if (!rows.length) return <Typography sx={{ fontSize: 13, color: "#A8A29E" }}>{empty}</Typography>;
  const max = Math.max(...rows.map((r) => Number(r.value) || 0), 1);
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {rows.map((r) => (
        <Box key={r.label} sx={{ display: "grid", gridTemplateColumns: { xs: "110px 1fr 90px", sm: "160px 1fr 120px" }, gap: 1, alignItems: "center" }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</Typography>
          <Box sx={{ height: 10, borderRadius: 5, background: "#F5F5F4", overflow: "hidden" }}>
            <Box sx={{ height: "100%", width: `${(100 * (Number(r.value) || 0)) / max}%`, background: "#4F5BA6", borderRadius: 5 }} />
          </Box>
          <Typography sx={{ fontSize: 12.5, textAlign: "right" }}>
            {format(r.value)}{r.extra ? <span style={{ color: "#A8A29E" }}> · {r.extra}</span> : null}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

// Colunas verticais por dia.
export function DayBars({ rows, format }) {
  if (!rows.length) return <Typography sx={{ fontSize: 13, color: "#A8A29E" }}>Sem dados no período.</Typography>;
  const max = Math.max(...rows.map((r) => Number(r.value) || 0), 1);
  return (
    <Box sx={{ display: "flex", alignItems: "flex-end", gap: 0.5, height: 160, overflowX: "auto", pb: 3, position: "relative" }}>
      {rows.map((r) => (
        <Box key={r.label} title={`${r.label}: ${format(r.value)}`}
          sx={{ flex: "1 0 18px", maxWidth: 48, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end" }}>
          <Box sx={{ width: "100%", height: `${(100 * (Number(r.value) || 0)) / max}%`, minHeight: 2, background: "#4F5BA6", borderRadius: "4px 4px 0 0" }} />
          <Typography sx={{ fontSize: 9.5, color: "#78716C", mt: 0.5, whiteSpace: "nowrap" }}>{r.label.slice(0, 5)}</Typography>
        </Box>
      ))}
    </Box>
  );
}
