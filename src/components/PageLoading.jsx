import { useEffect, useState } from "react";
import BrandLoader from "./BrandLoader";

// Carregando os dados de uma página.
// Na abertura do app a tela do lanche (a mesma do index.html) continua
// cobrindo tudo até a primeira página ter os dados: a pessoa não vê o menu
// aparecer com uma bolinha girando no meio. Depois disso, ao trocar de
// tela, o menu fica e só o conteúdo mostra o lanche (se demorar).
// Se a primeira carga travar, em 8 s a tela cheia sai e fica o lanche no
// conteúdo, para a pessoa não ficar presa sem menu.
const COVER_MAX_MS = 8000;
const state = { firstPageShown: false, waiting: 0 };

// Para o carregamento do código da tela (Suspense): na abertura, sem atraso.
export function RouteLoading() {
  return <BrandLoader instant={!state.firstPageShown} />;
}

// eslint-disable-next-line react-refresh/only-export-components
export function markFirstPageShown() {
  if (state.waiting === 0) state.firstPageShown = true;
}

export default function PageLoading({ text }) {
  const [cover, setCover] = useState(() => !state.firstPageShown);
  useEffect(() => {
    state.waiting += 1;
    const t = cover ? setTimeout(() => { state.firstPageShown = true; setCover(false); }, COVER_MAX_MS) : null;
    return () => {
      clearTimeout(t);
      state.waiting -= 1;
      if (state.waiting === 0) state.firstPageShown = true;
    };
  }, [cover]);
  return cover ? <BrandLoader instant text={text} /> : <BrandLoader inline text={text} />;
}
