// Logo GORAP desenhado em vetor (gerado a partir da identidade visual
// aprovada). O letreiro já está em curvas: não depende de fonte instalada.
// variant: "full" (símbolo + GORAP), "symbol" (só o G com o pin) ou "icon"
// (quadrado laranja do app). `dark` usa o letreiro branco, para fundo grafite.
export const GORAP_ORANGE = "#FF6B1A";
export const GORAP_GRAPHITE = "#1F2933";

const WORD = "M391 12Q225 12 138 -55Q51 -122 51 -257Q51 -328 67 -387Q83 -447 112 -493Q149 -562 209 -608Q269 -654 349 -677Q428 -700 522 -700Q600 -700 666 -686Q733 -673 783 -645Q833 -618 860 -577Q888 -536 888 -481Q888 -471 887 -461Q886 -450 884 -439H659Q660 -442 660 -445Q660 -449 660 -452Q660 -471 650 -486Q639 -501 620 -511Q601 -521 576 -527Q551 -532 523 -532Q475 -532 437 -521Q400 -510 372 -488Q345 -467 327 -436Q310 -406 303 -366Q298 -344 296 -329Q293 -315 292 -305Q291 -296 291 -290Q290 -284 290 -279Q290 -238 308 -211Q326 -184 361 -170Q396 -156 449 -156Q492 -156 530 -166Q568 -176 594 -195Q620 -215 624 -241L625 -244H443L468 -384H876L808 0H681L672 -72Q634 -44 590 -25Q547 -6 498 3Q449 12 391 12Z M1369 12Q1251 12 1167 -21Q1083 -54 1039 -117Q995 -181 995 -273Q995 -322 1009 -366Q1023 -410 1047 -447Q1079 -530 1136 -587Q1193 -643 1275 -671Q1357 -700 1464 -700Q1582 -700 1666 -667Q1750 -634 1794 -570Q1838 -506 1838 -412Q1838 -364 1824 -319Q1810 -275 1785 -238Q1753 -156 1695 -100Q1638 -44 1556 -16Q1474 12 1369 12ZM1383 -156Q1424 -156 1459 -168Q1494 -180 1520 -202Q1547 -224 1564 -255Q1581 -286 1587 -322Q1591 -343 1593 -357Q1595 -371 1596 -380Q1597 -388 1598 -394Q1598 -399 1598 -404Q1598 -442 1581 -471Q1564 -500 1531 -516Q1497 -532 1449 -532Q1408 -532 1373 -520Q1339 -508 1313 -486Q1287 -464 1270 -434Q1252 -403 1246 -367Q1243 -345 1241 -331Q1238 -317 1237 -308Q1236 -299 1236 -294Q1235 -289 1235 -285Q1235 -247 1252 -217Q1269 -188 1302 -172Q1335 -156 1383 -156Z M1914 0 2035 -688H2530Q2602 -688 2649 -663Q2696 -639 2719 -597Q2742 -556 2742 -506Q2742 -446 2723 -398Q2704 -350 2669 -315Q2635 -280 2586 -258L2674 0H2418L2353 -223H2187L2147 0ZM2215 -385H2417Q2437 -385 2456 -396Q2475 -406 2487 -425Q2499 -444 2499 -469Q2499 -495 2485 -510Q2470 -524 2446 -524H2240Z M2731 0 3142 -688H3407L3575 0H3332L3314 -94H3026L2975 0ZM3115 -256H3282L3262 -369Q3260 -382 3258 -397Q3256 -412 3253 -429Q3251 -446 3248 -463Q3246 -480 3244 -496H3238Q3229 -476 3217 -454Q3206 -431 3195 -410Q3184 -388 3174 -369Z M3682 0 3804 -688H4267Q4329 -688 4374 -664Q4418 -639 4443 -595Q4468 -551 4468 -493Q4468 -432 4449 -381Q4429 -330 4393 -293Q4358 -255 4311 -234Q4264 -213 4209 -213H3954L3916 0ZM3983 -379H4157Q4184 -379 4203 -390Q4221 -402 4231 -422Q4241 -442 4241 -469Q4241 -495 4225 -508Q4209 -521 4178 -521H4008Z";

function Symbol({ color, hole }) {
  return (
    <>
      <path d="M8 47 H21 M2 58 H20 M10 69 H20" stroke={color} strokeWidth="6.5" strokeLinecap="round" />
      <path transform="translate(24 0) skewX(-12)" d="M80 35 H50 Q28 35 28 57 Q28 79 50 79 H66 Q82 79 82 65 V59 H61" fill="none" stroke={color} strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M102 31 C96.6 23.8 90 19.0 90 12.4 A12 12 0 1 1 114 12.4 C114 19.0 107.4 23.8 102 31Z" fill={color} />
      <circle cx="102" cy="12.4" r="5.0" fill={hole} />
    </>
  );
}

export default function GorapLogo({ variant = "full", height = 32, dark = false, title = "GORAP", ...rest }) {
  const hole = dark ? GORAP_GRAPHITE : "#FAFAF9";
  if (variant === "icon") {
    return (
      <svg viewBox="0 0 120 120" height={height} width={height} role="img" aria-label={title} {...rest}>
        <rect width="120" height="120" rx="28" fill={GORAP_ORANGE} />
        <g transform="translate(11.53 24.90) scale(0.8357)"><Symbol color="#FFFFFF" hole={GORAP_ORANGE} /></g>
      </svg>
    );
  }
  if (variant === "symbol") {
    return (
      <svg viewBox="0 0 112 88" height={height} width={height * 112 / 88} role="img" aria-label={title} {...rest}>
        <Symbol color={GORAP_ORANGE} hole={hole} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 416 88" height={height} width={height * 416 / 88} role="img" aria-label={title} {...rest}>
      <Symbol color={GORAP_ORANGE} hole={hole} />
      <path transform="translate(126 79) scale(0.0645)" d={WORD} fill={dark ? "#FFFFFF" : GORAP_GRAPHITE} />
    </svg>
  );
}
