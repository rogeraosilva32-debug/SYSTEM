// Utilidades dos relatórios e do financeiro: períodos prontos, exportação
// CSV (abre no Excel em português) e rótulos.

function iso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function today() {
  return iso(new Date());
}

export const PERIODS = [
  { key: "today", label: "Hoje" },
  { key: "yesterday", label: "Ontem" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "month", label: "Este mês" },
  { key: "last_month", label: "Mês passado" },
  { key: "custom", label: "Escolher datas" },
];

export function periodRange(key) {
  const now = new Date();
  const d = (offset) => { const x = new Date(now); x.setDate(x.getDate() + offset); return iso(x); };
  switch (key) {
    case "today": return [d(0), d(0)];
    case "yesterday": return [d(-1), d(-1)];
    case "7d": return [d(-6), d(0)];
    case "30d": return [d(-29), d(0)];
    case "month": return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), d(0)];
    case "last_month": return [
      iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      iso(new Date(now.getFullYear(), now.getMonth(), 0)),
    ];
    default: return null;
  }
}

export function formatDate(isoDate) {
  if (!isoDate) return "—";
  const [y, m, d] = String(isoDate).slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function minutes(v) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (n >= 60) return `${Math.floor(n / 60)} h ${Math.round(n % 60)} min`;
  return `${Math.round(n)} min`;
}

export function km(v) {
  return `${Number(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`;
}

// CSV com ";" e vírgula decimal: o Excel em português abre direto nas colunas.
export function downloadCsv(filename, columns, rows) {
  const cell = (v) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? String(v).replace(".", ",") : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => cell(c.label)).join(";")];
  for (const r of rows) lines.push(columns.map((c) => cell(c.value(r))).join(";"));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const CASH_KIND = {
  opening: { label: "Abertura (troco inicial)", sign: 1 },
  deposit: { label: "Reforço", sign: 1 },
  withdrawal: { label: "Sangria", sign: -1 },
  expense: { label: "Despesa", sign: -1 },
};

// Erro de coluna/função inexistente = script do banco desatualizado.
export const loadError = (e) => (/schema cache|does not exist|Could not find/i.test(e?.message || "")
  ? "O banco ainda não tem a parte financeira. Rode de novo o script supabase-b2b-schema.sql no SQL Editor do Supabase."
  : e?.message || "Erro ao carregar.");
