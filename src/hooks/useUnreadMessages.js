import { useEffect, useState } from "react";
import supabase from "../services/supabase";
import { useAuth } from "../context/AuthContext";

const POLL_MS = 30000;

// Mensagens não lidas para o número no menu: gestor/supervisor contam as que
// os motoboys mandaram (o banco já limita à equipe do supervisor); o
// motoboy conta as da empresa para ele.
export default function useUnreadMessages() {
  const { profile, isCompanyAdmin, isSupervisor, isCollaborator } = useAuth();
  const [count, setCount] = useState(0);
  const staff = isCompanyAdmin || isSupervisor;
  const enabled = Boolean(profile?.company_id) && (staff || isCollaborator);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const load = async () => {
      if (document.hidden) return;
      try {
        let q = supabase.from("chat_messages").select("id", { count: "exact", head: true }).eq("company_id", profile.company_id);
        q = staff ? q.eq("read_by_admin", false) : q.eq("read_by_collaborator", false).eq("collaborator_id", profile.id);
        const { count: n, error } = await q;
        if (!cancelled && !error) setCount(n || 0);
      } catch { /* sem conexão: tenta na próxima */ }
    };
    load();
    const timer = setInterval(load, POLL_MS);
    // Abrir uma conversa marca como lidas: o ChatPanel avisa para recontar.
    window.addEventListener("chat-read", load);
    document.addEventListener("visibilitychange", load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("chat-read", load);
      document.removeEventListener("visibilitychange", load);
    };
  }, [enabled, staff, profile?.company_id, profile?.id]);

  return enabled ? count : 0;
}
