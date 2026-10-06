// Gera códigos no formato XXXX-XXXX-XXXX, fáceis de digitar/ler em voz alta —
// evita caracteres ambíguos (0/O, 1/I/L).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

// Usa crypto.getRandomValues (seguro); descarta bytes acima do maior
// múltiplo do alfabeto pra não enviesar a distribuição.
const LIMIT = 256 - (256 % ALPHABET.length);

function randomChars(length) {
  const out = [];
  const buf = new Uint8Array(length * 2);
  while (out.length < length) {
    crypto.getRandomValues(buf);
    for (const byte of buf) {
      if (byte < LIMIT) out.push(ALPHABET[byte % ALPHABET.length]);
      if (out.length === length) break;
    }
  }
  return out.join("");
}

export function generateCode(groups = 3, groupSize = 4) {
  return Array.from({ length: groups }, () => randomChars(groupSize)).join("-");
}
