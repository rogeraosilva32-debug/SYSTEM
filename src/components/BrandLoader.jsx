// Tela de carregamento: um lanche levando mordidas. A mesma figura está
// escrita à mão no index.html (aparece antes do JavaScript carregar), então
// a troca para esta é invisível. Só aparece se demorar mais que um instante.
//
// O lanche é um desenho parado; as mordidas são bolinhas da cor do fundo por
// cima dele. Só se anima transform e opacity, que o navegador desenha fora
// da thread do JavaScript: a animação fica lisa mesmo enquanto o app carrega.
// Ciclo de 3 s: três mordidas em sequência, o lanche some e volta inteiro.
export const LOADER_CSS = `
.bl-wrap{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#FAFAF9;z-index:2000;opacity:0;animation:bl-in .2s ease-out .15s forwards}
.bl-wrap.bl-inline{position:static;min-height:240px;background:transparent;z-index:auto}
.bl-burger{position:relative;width:92px;height:92px}
.bl-food{position:absolute;inset:0;will-change:transform,opacity;animation:bl-food 3s ease-in-out infinite}
.bl-food svg{display:block;width:92px;height:92px}
.bl-bite{position:absolute;width:21px;height:21px;border-radius:50%;background:#FAFAF9;transform:scale(0);will-change:transform}
.bl-b1{left:70.4px;top:20.8px;animation:bl-b1 3s infinite}
.bl-b2{left:74px;top:37.3px;animation:bl-b2 3s infinite}
.bl-b3{left:70.4px;top:53.8px;animation:bl-b3 3s infinite}
.bl-crumb{position:absolute;border-radius:50%;opacity:0;will-change:transform,opacity}
.bl-c1{left:74px;top:36px;width:3.4px;height:3.4px;background:#E9A23B;animation:bl-c1 3s ease-in infinite}
.bl-c2{left:76px;top:53px;width:3px;height:3px;background:#F6C343;animation:bl-c2 3s ease-in infinite}
.bl-c3{left:73px;top:70px;width:3.2px;height:3.2px;background:#D98E2F;animation:bl-c3 3s ease-in infinite}
.bl-text{font:600 13px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#A8A29E;letter-spacing:.02em}
@keyframes bl-in{to{opacity:1}}
@keyframes bl-food{0%,80%{opacity:1;transform:scale(1)}87%,90%{opacity:0;transform:scale(.9)}100%{opacity:1;transform:scale(1)}}
@keyframes bl-b1{0%,6%{transform:scale(0);animation-timing-function:cubic-bezier(.2,.9,.3,1.2)}15%,88%{transform:scale(1)}89%,100%{transform:scale(0)}}
@keyframes bl-b2{0%,26%{transform:scale(0);animation-timing-function:cubic-bezier(.2,.9,.3,1.2)}35%,88%{transform:scale(1)}89%,100%{transform:scale(0)}}
@keyframes bl-b3{0%,46%{transform:scale(0);animation-timing-function:cubic-bezier(.2,.9,.3,1.2)}55%,88%{transform:scale(1)}89%,100%{transform:scale(0)}}
@keyframes bl-c1{0%,10%{opacity:0;transform:translate(0,0)}13%{opacity:1}32%,100%{opacity:0;transform:translate(9px,26px)}}
@keyframes bl-c2{0%,30%{opacity:0;transform:translate(0,0)}33%{opacity:1}52%,100%{opacity:0;transform:translate(10px,22px)}}
@keyframes bl-c3{0%,50%{opacity:0;transform:translate(0,0)}53%{opacity:1}72%,100%{opacity:0;transform:translate(8px,16px)}}
@media (prefers-reduced-motion:reduce){.bl-food,.bl-bite,.bl-crumb{animation:none}.bl-bite{transform:scale(1)}}
`;

export const BURGER_SVG = `<div class="bl-burger" aria-hidden="true"><div class="bl-food"><svg viewBox="0 0 100 100">
  <path d="M16 44c0-17 15-27 34-27s34 10 34 27z" fill="#E9A23B"/>
  <ellipse cx="38" cy="29" rx="2.2" ry="1.3" fill="#FFF3D6"/><ellipse cx="52" cy="25" rx="2.2" ry="1.3" fill="#FFF3D6"/>
  <ellipse cx="64" cy="31" rx="2.2" ry="1.3" fill="#FFF3D6"/><ellipse cx="46" cy="35" rx="2.2" ry="1.3" fill="#FFF3D6"/>
  <path d="M13 47c6-3 10 3 16 0s10 3 16 0 10 3 16 0 10 3 16 0 9 3 12 1v4H13z" fill="#6DB33F"/>
  <rect x="14" y="51" width="72" height="5" rx="2" fill="#F6C343"/>
  <rect x="15" y="56" width="70" height="11" rx="5.5" fill="#6B3A22"/>
  <path d="M16 70h68v4c0 6-5 10-11 10H27c-6 0-11-4-11-10z" fill="#D98E2F"/>
</svg><i class="bl-bite bl-b1"></i><i class="bl-bite bl-b2"></i><i class="bl-bite bl-b3"></i></div><i class="bl-crumb bl-c1"></i><i class="bl-crumb bl-c2"></i><i class="bl-crumb bl-c3"></i></div>`;

// `instant`: aparece já no primeiro quadro (continua a tela do index.html,
// sem piscar); sem ele, só aparece se a espera passar de 0,15 s.
export default function BrandLoader({ inline = false, instant = false, text = "Carregando…" }) {
  return (
    <div className={`bl-wrap${inline ? " bl-inline" : ""}`} style={instant ? { animation: "none", opacity: 1 } : undefined} role="status" aria-live="polite">
      <style>{LOADER_CSS}</style>
      <div dangerouslySetInnerHTML={{ __html: BURGER_SVG }} />
      <div className="bl-text">{text}</div>
    </div>
  );
}
