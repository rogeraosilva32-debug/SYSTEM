// Gera códigos no formato XXXX-XXXX-XXXX, fáceis de digitar/ler em voz alta —
// evita caracteres ambíguos (0/O, 1/I/L).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateCode(groups = 3, groupSize = 4) {
  const randomGroup = () =>
    Array.from({ length: groupSize }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
  return Array.from({ length: groups }, randomGroup).join("-");
}
