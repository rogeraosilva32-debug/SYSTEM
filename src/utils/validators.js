// Validação de CPF pelo algoritmo oficial (módulo 11 dos dígitos verificadores).
// Só checar o tamanho (11 dígitos) não é suficiente: números como
// "111.111.111-11" ou "123.456.789-00" têm 11 dígitos mas não são CPFs reais.
export function isValidCpf(raw) {
  const cpf = String(raw || "").replace(/\D/g, "");

  if (cpf.length !== 11) return false;

  // CPFs com todos os dígitos iguais (00000000000, 11111111111, ...) têm
  // dígito verificador "válido" pela matemática, mas nunca foram emitidos.
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const calcDigit = (base) => {
    let sum = 0;
    let weight = base.length + 1;
    for (const digit of base) {
      sum += Number(digit) * weight;
      weight--;
    }
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  const firstNine = cpf.slice(0, 9);
  const digit1 = calcDigit(firstNine);
  const digit2 = calcDigit(firstNine + String(digit1));

  return cpf === firstNine + String(digit1) + String(digit2);
}

export function formatCpf(raw) {
  const v = String(raw || "").replace(/\D/g, "").slice(0, 11);
  if (v.length > 9) return v.slice(0, 3) + "." + v.slice(3, 6) + "." + v.slice(6, 9) + "-" + v.slice(9);
  if (v.length > 6) return v.slice(0, 3) + "." + v.slice(3, 6) + "." + v.slice(6);
  if (v.length > 3) return v.slice(0, 3) + "." + v.slice(3);
  return v;
}
