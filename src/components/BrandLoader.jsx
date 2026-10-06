// Tela de carregamento: um lanche levando mordidas. A mesma figura está
// escrita à mão no index.html (aparece antes do JavaScript carregar), então
// a troca para esta é invisível. Só aparece se demorar mais que um instante.
export const LOADER_CSS = `
.bl-wrap{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#FAFAF9;z-index:2000;opacity:0;animation:bl-in .2s ease-out .15s forwards}
.bl-wrap.bl-inline{position:static;min-height:240px;background:transparent;z-index:auto}
.bl-burger{width:92px;height:92px}
.bl-bite{transform-box:fill-box;transform-origin:center;transform:scale(0);animation:bl-bite 2.4s cubic-bezier(.3,1.6,.5,1) infinite}
.bl-b2{animation-delay:.5s}.bl-b3{animation-delay:1s}
.bl-crumb{opacity:0;animation:bl-crumb 2.4s ease-out infinite}
.bl-c2{animation-delay:.5s}.bl-c3{animation-delay:1s}
.bl-text{font:600 13px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#A8A29E;letter-spacing:.02em}
@keyframes bl-in{to{opacity:1}}
@keyframes bl-bite{0%,8%{transform:scale(0)}18%,85%{transform:scale(1)}100%{transform:scale(0)}}
@keyframes bl-crumb{0%,10%{opacity:0;transform:translate(0,0)}20%{opacity:1}45%{opacity:0;transform:translate(10px,16px)}100%{opacity:0}}
@media (prefers-reduced-motion:reduce){.bl-bite,.bl-crumb{animation:none}.bl-bite{transform:scale(1)}}
`;

export const BURGER_SVG = `
<svg class="bl-burger" viewBox="0 0 100 100" aria-hidden="true">
  <defs>
    <mask id="bl-mask">
      <rect width="100" height="100" fill="#fff"/>
      <circle class="bl-bite" cx="88" cy="34" r="11" fill="#000"/>
      <circle class="bl-bite bl-b2" cx="92" cy="52" r="11" fill="#000"/>
      <circle class="bl-bite bl-b3" cx="88" cy="70" r="11" fill="#000"/>
    </mask>
  </defs>
  <g mask="url(#bl-mask)">
    <path d="M16 44c0-17 15-27 34-27s34 10 34 27z" fill="#E9A23B"/>
    <ellipse cx="38" cy="29" rx="2.2" ry="1.3" fill="#FFF3D6"/><ellipse cx="52" cy="25" rx="2.2" ry="1.3" fill="#FFF3D6"/>
    <ellipse cx="64" cy="31" rx="2.2" ry="1.3" fill="#FFF3D6"/><ellipse cx="46" cy="35" rx="2.2" ry="1.3" fill="#FFF3D6"/>
    <path d="M13 47c6-3 10 3 16 0s10 3 16 0 10 3 16 0 10 3 16 0 9 3 12 1v4H13z" fill="#6DB33F"/>
    <rect x="14" y="51" width="72" height="5" rx="2" fill="#F6C343"/>
    <rect x="15" y="56" width="70" height="11" rx="5.5" fill="#6B3A22"/>
    <path d="M16 70h68v4c0 6-5 10-11 10H27c-6 0-11-4-11-10z" fill="#D98E2F"/>
  </g>
  <circle class="bl-crumb" cx="86" cy="76" r="1.8" fill="#D98E2F"/>
  <circle class="bl-crumb bl-c2" cx="90" cy="80" r="1.4" fill="#E9A23B"/>
  <circle class="bl-crumb bl-c3" cx="84" cy="82" r="1.6" fill="#6B3A22"/>
</svg>`;

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
