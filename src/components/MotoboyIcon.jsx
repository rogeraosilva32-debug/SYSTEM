import sprite from "../assets/motoboy-sprite.png";

// Motoboy animado no lugar do emoji 🛵, um pouco maior que o texto ao lado
// (no tamanho do texto o desenho ficava pequeno demais para ver).
// É a animação Lottie escolhida pelo usuário, guardada como uma tira de 34
// quadros recortados no desenho (proporção 96x50); o CSS só troca o
// quadro, sem carregar player de Lottie.
// `light`: para fundo escuro (traço branco).
const FRAMES = 34;
const CSS = `
.mb-icon{--mb-h:1.6em;--mb-w:calc(var(--mb-h) * 1.92);display:inline-block;width:var(--mb-w);height:var(--mb-h);
  vertical-align:calc(var(--mb-h) * -0.3);
  margin-right:0.15em;background-repeat:no-repeat;
  background-size:${FRAMES * 100}% 100%;animation:mb-ride ${(FRAMES / 24).toFixed(3)}s steps(${FRAMES}) infinite}
.mb-icon.mb-light{filter:invert(1)}
@keyframes mb-ride{from{background-position-x:0}to{background-position-x:calc(var(--mb-w) * -${FRAMES})}}
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
