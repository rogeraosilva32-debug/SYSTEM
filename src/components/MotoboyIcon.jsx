import sprite from "../assets/motoboy-sprite.png";

// Motoboy animado no lugar do emoji 🛵, do mesmo tamanho do texto ao lado.
// É a animação Lottie escolhida pelo usuário, guardada como uma tira de 34
// quadros (12 KB); o CSS só troca o quadro, sem carregar player de Lottie.
// `light`: para fundo escuro (traço branco).
const FRAMES = 34;
const CSS = `
.mb-icon{display:inline-block;width:1.25em;height:1.25em;vertical-align:-0.25em;background-repeat:no-repeat;
  background-size:${FRAMES * 100}% 100%;animation:mb-ride ${(FRAMES / 24).toFixed(3)}s steps(${FRAMES}) infinite}
.mb-icon.mb-light{filter:invert(1)}
@keyframes mb-ride{from{background-position-x:0}to{background-position-x:-${FRAMES * 1.25}em}}
@media (prefers-reduced-motion:reduce){.mb-icon{animation:none}}
`;

export default function MotoboyIcon({ light = false, sx }) {
  return (
    <>
      <style>{CSS}</style>
      <span className={`mb-icon${light ? " mb-light" : ""}`} aria-hidden="true"
        style={{ backgroundImage: `url(${sprite})`, ...sx }} />
    </>
  );
}
