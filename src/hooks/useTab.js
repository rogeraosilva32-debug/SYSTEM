import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

// Aba atual guardada no endereço (?aba=pedidos): recarregar a página ou
// voltar no navegador mantém a pessoa na mesma tela.
export default function useTab(keys, fallback) {
  const [params, setParams] = useSearchParams();
  const raw = params.get("aba");
  const tab = keys.includes(raw) ? raw : fallback;
  const setTab = useCallback((key) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("aba", key);
      return next;
    });
    window.scrollTo?.({ top: 0 });
  }, [setParams]);
  return [tab, setTab];
}
