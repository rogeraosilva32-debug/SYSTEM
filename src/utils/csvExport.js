// Exportação CSV simples, sem biblioteca externa. `columns` é uma lista de
// { key, label, get? } — `get(row)` opcional pra formatar/derivar o valor;
// sem `get`, usa `row[key]` direto.
export function downloadCsv(filename, rows, columns) {
  const escape = (value) => {
    const str = value == null ? "" : String(value);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const header = columns.map((c) => escape(c.label)).join(",");
  const lines = rows.map((row) =>
    columns.map((c) => escape(c.get ? c.get(row) : row[c.key])).join(",")
  );
  // BOM no início — sem isso o Excel abre acentos errados em arquivos UTF-8.
  const csv = "\uFEFF" + [header, ...lines].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
