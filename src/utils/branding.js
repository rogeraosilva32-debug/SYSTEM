// Cada imagem da marca, com a medida recomendada mostrada ao lado do campo.
export const BRAND_SLOTS = [
  {
    key: "brand_logo_url", file: "logo", title: "Logo horizontal",
    where: "Topo do painel e do app do motoboy",
    size: "600 × 200 px (proporção 3:1), fundo transparente",
    width: 600, height: 200, types: ["image/png", "image/webp"], typesLabel: "PNG ou WebP", maxKb: 500,
  },
  {
    key: "brand_icon_url", file: "icone", title: "Ícone (quadrado)",
    where: "Ícone na aba do navegador e nas notificações",
    size: "512 × 512 px, com margem de 10% em volta",
    width: 512, height: 512, types: ["image/png"], typesLabel: "PNG", maxKb: 500,
  },
  {
    key: "brand_login_bg_url", file: "fundo-login", title: "Imagem da tela de login",
    where: "Tela de entrada, quando a empresa tiver endereço próprio (ex.: suaempresa.seusistema.com.br)",
    size: "1920 × 1080 px (paisagem)",
    width: 1920, height: 1080, types: ["image/jpeg", "image/webp"], typesLabel: "JPG ou WebP", maxKb: 1024,
  },
  {
    key: "brand_share_url", file: "compartilhar", title: "Imagem das páginas do cliente final",
    where: "Páginas que o cliente final abre por link (ex.: avaliação do atendimento)",
    size: "1200 × 630 px",
    width: 1200, height: 630, types: ["image/jpeg", "image/png"], typesLabel: "JPG ou PNG", maxKb: 1024,
  },
];

// Só PNG/JPEG/WebP (SVG pode carregar script). Confere MIME E extensão.
export const BRAND_EXTENSIONS = { "image/png": ["png"], "image/jpeg": ["jpg", "jpeg"], "image/webp": ["webp"] };

// Valor do atributo accept do input: MIME + extensões permitidas no slot.
export function brandAccept(slot) {
  return slot.types.flatMap((t) => [t, ...(BRAND_EXTENSIONS[t] || []).map((e) => `.${e}`)]).join(",");
}

function readDimensions(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

// Confere formato, peso e medida. Formato e peso bloqueiam; medida
// diferente só avisa (a imagem é ajustada na tela, mas pode distorcer ou
// ficar borrada).
export async function checkBrandImage(slot, file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (!slot.types.includes(file.type) || !(BRAND_EXTENSIONS[file.type] || []).includes(ext)) {
    return { error: `Formato inválido. Use ${slot.typesLabel}.` };
  }
  if (file.size > slot.maxKb * 1024) return { error: `Arquivo grande demais (${Math.round(file.size / 1024)} KB). Máximo: ${slot.maxKb >= 1024 ? `${slot.maxKb / 1024} MB` : `${slot.maxKb} KB`}.` };
  const dim = await readDimensions(file);
  if (!dim) return { error: "Não foi possível ler a imagem." };
  const ratio = dim.width / dim.height;
  const expected = slot.width / slot.height;
  const warnings = [];
  if (Math.abs(ratio - expected) / expected > 0.1) warnings.push(`a proporção é ${dim.width}×${dim.height}; o recomendado é ${slot.width}×${slot.height}`);
  if (dim.width < slot.width * 0.75) warnings.push(`a imagem é pequena (${dim.width} px de largura) e pode ficar borrada`);
  return { dim, warning: warnings.length ? `Atenção: ${warnings.join("; ")}.` : "" };
}
