import { useEffect, useState } from "react";
import supabase from "../services/supabase";

// Ajustes e marca da empresa de quem está logado (my_company_settings).
// Guardado em memória para não repetir a consulta a cada tela; `refresh`
// força recarregar (ex.: depois de trocar a marca).
let cache = null;
let pending = null;
const listeners = new Set();

async function fetchSettings() {
  try {
    const { data, error } = await supabase.rpc("my_company_settings").maybeSingle();
    // Falhou: libera para a próxima tela tentar de novo (senão ficava nulo a sessão toda).
    if (error) { pending = null; return null; }
    cache = data || null;
    if (!cache) pending = null;
  } catch {
    pending = null;
    return null;
  }
  listeners.forEach((fn) => fn(cache));
  return cache;
}

export function refreshCompanySettings() {
  pending = fetchSettings();
  return pending;
}

export function useCompanySettings(enabled = true) {
  const [settings, setSettings] = useState(cache);
  useEffect(() => {
    if (!enabled) return;
    listeners.add(setSettings);
    if (!cache && !pending) pending = fetchSettings();
    return () => { listeners.delete(setSettings); };
  }, [enabled]);
  return settings;
}

export function clearCompanySettings() {
  cache = null; pending = null;
  listeners.forEach((fn) => fn(null));
}
