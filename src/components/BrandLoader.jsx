import { useState } from "react";

// Tela de carregamento: um lanche levando mordidas. A mesma figura está
// escrita à mão no index.html (aparece antes do JavaScript carregar), então
// a troca para esta é invisível. Só aparece se demorar mais que um instante.
//
// São quatro desenhos parados do lanche (inteiro, 1, 2 e 3 mordidas, com
// marca de dente) empilhados; a animação só troca qual aparece (opacity) e
// dá uma apertadinha a cada mordida (transform). O navegador desenha isso
// fora da thread do JavaScript, então não trava enquanto o app carrega, e a
// mordida é um buraco de verdade: funciona em qualquer cor de fundo.
//
// Todas as cópias seguem o mesmo relógio (--bl-d = tempo desde a abertura
// da página): quando o React troca a tela do index.html por esta, ou uma
// tela de carregamento por outra, a animação continua de onde estava em vez
// de voltar ao começo.
export const LOADER_CYCLE_MS = 2400;

export const LOADER_CSS = `
.bl-wrap{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#FAFAF9;z-index:2000;opacity:0;animation:bl-in .2s ease-out .15s forwards}
.bl-wrap.bl-inline{position:static;min-height:240px;background:transparent;z-index:auto}
.bl-burger{position:relative;width:92px;height:92px}
.bl-food{position:absolute;inset:0;will-change:transform,opacity;animation:bl-food 2.4s ease-in-out var(--bl-d,0s) infinite}
.bl-f{position:absolute;inset:0;width:92px;height:92px;opacity:0;will-change:opacity;animation:2.4s linear var(--bl-d,0s) infinite}
.bl-f0{opacity:1;animation-name:bl-f0}.bl-f1{animation-name:bl-f1}.bl-f2{animation-name:bl-f2}.bl-f3{animation-name:bl-f3}
.bl-crumb{position:absolute;border-radius:50%;opacity:0;will-change:transform,opacity;animation:2.4s ease-in var(--bl-d,0s) infinite}
.bl-c1{left:71px;top:32px;width:3.4px;height:3.4px;background:#E9A23B;animation-name:bl-c1}
.bl-c2{left:74px;top:49px;width:3px;height:3px;background:#F6C343;animation-name:bl-c2}
.bl-c3{left:71px;top:65px;width:3.2px;height:3.2px;background:#D98E2F;animation-name:bl-c3}
.bl-text{font:600 13px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#A8A29E;letter-spacing:.02em}
@keyframes bl-in{to{opacity:1}}
@keyframes bl-f0{0%,17.9%{opacity:1}18%,89.9%{opacity:0}90%,100%{opacity:1}}
@keyframes bl-f1{0%,17.9%{opacity:0}18%,41.9%{opacity:1}42%,100%{opacity:0}}
@keyframes bl-f2{0%,41.9%{opacity:0}42%,65.9%{opacity:1}66%,100%{opacity:0}}
@keyframes bl-f3{0%,65.9%{opacity:0}66%,89.9%{opacity:1}90%,100%{opacity:0}}
@keyframes bl-food{0%,18%{opacity:1;transform:scale(1)}20%{transform:scale(.95,1.04)}25%,42%{transform:scale(1)}44%{transform:scale(.95,1.04)}49%,66%{transform:scale(1)}68%{transform:scale(.95,1.04)}73%,83%{opacity:1;transform:scale(1)}89%,90%{opacity:0;transform:scale(.8)}98%,100%{opacity:1;transform:scale(1)}}
@keyframes bl-c1{0%,18%{opacity:0;transform:translate(0,0)}20%{opacity:1}40%,100%{opacity:0;transform:translate(8px,30px)}}
@keyframes bl-c2{0%,42%{opacity:0;transform:translate(0,0)}44%{opacity:1}64%,100%{opacity:0;transform:translate(10px,24px)}}
@keyframes bl-c3{0%,66%{opacity:0;transform:translate(0,0)}68%{opacity:1}86%,100%{opacity:0;transform:translate(7px,18px)}}
@media (prefers-reduced-motion:reduce){.bl-food,.bl-f,.bl-crumb{animation:none}.bl-f0{opacity:1}}
`;

// Buraco da mordida: um círculo com três dentinhos para dentro do lanche.
const bite = (x, y) => `<circle cx="${x}" cy="${y}" r="10"/><circle cx="${x - 8.7}" cy="${y - 5}" r="3.2"/><circle cx="${x - 10}" cy="${y}" r="3.2"/><circle cx="${x - 8.7}" cy="${y + 5}" r="3.2"/>`;
const BITES = [bite(89, 34), bite(93, 52), bite(89, 70)];
const BURGER = `<path d="M16 44c0-17 15-27 34-27s34 10 34 27z" fill="#E9A23B"/><ellipse cx="38" cy="29" rx="2.2" ry="1.3" fill="#FFF3D6"/><ellipse cx="52" cy="25" rx="2.2" ry="1.3" fill="#FFF3D6"/><ellipse cx="64" cy="31" rx="2.2" ry="1.3" fill="#FFF3D6"/><ellipse cx="46" cy="35" rx="2.2" ry="1.3" fill="#FFF3D6"/><path d="M13 47c6-3 10 3 16 0s10 3 16 0 10 3 16 0 10 3 16 0 9 3 12 1v4H13z" fill="#6DB33F"/><rect x="14" y="51" width="72" height="5" rx="2" fill="#F6C343"/><rect x="15" y="56" width="70" height="11" rx="5.5" fill="#6B3A22"/><path d="M16 70h68v4c0 6-5 10-11 10H27c-6 0-11-4-11-10z" fill="#D98E2F"/>`;
const frame = (n) => n === 0
  ? `<svg class="bl-f bl-f0" viewBox="0 0 100 100">${BURGER}</svg>`
  : `<svg class="bl-f bl-f${n}" viewBox="0 0 100 100"><mask id="bl-m${n}"><rect width="100" height="100" fill="#fff"/><g fill="#000">${BITES.slice(0, n).join("")}</g></mask><g mask="url(#bl-m${n})">${BURGER}</g></svg>`;

export const BURGER_SVG = `<div class="bl-burger" aria-hidden="true"><div class="bl-food">${[0, 1, 2, 3].map(frame).join("")}</div><i class="bl-crumb bl-c1"></i><i class="bl-crumb bl-c2"></i><i class="bl-crumb bl-c3"></i></div>`;

// Atraso negativo que põe a animação no ponto do relógio comum.
const phase = () => `-${Math.round(performance.now() % LOADER_CYCLE_MS)}ms`;

// `instant`: aparece já no primeiro quadro (continua a tela do index.html,
// sem piscar); sem ele, só aparece se a espera passar de 0,15 s.
export default function BrandLoader({ inline = false, instant = false, text = "Carregando…" }) {
  const [delay] = useState(phase);
  const style = { "--bl-d": delay, ...(instant ? { animation: "none", opacity: 1 } : null) };
  return (
    <div className={`bl-wrap${inline ? " bl-inline" : ""}`} style={style} role="status" aria-live="polite">
      <style>{LOADER_CSS}</style>
      <div dangerouslySetInnerHTML={{ __html: BURGER_SVG }} />
      <div className="bl-text">{text}</div>
    </div>
  );
}
