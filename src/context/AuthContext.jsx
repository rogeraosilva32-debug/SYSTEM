import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import supabase from "../services/supabase";
import { clearCompanySettings } from "../hooks/useCompanySettings";
import { logEvent } from "../services/eventLog";

// Uma linha no log do sistema por pessoa por aba aberta (login ou app aberto).
function logSessionStart(authUser) {
  if (!authUser) return;
  const key = `session-logged:${authUser.id}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch { /* sem sessionStorage: registra mesmo assim */ }
  logEvent("conta", "session_start", "Entrou no sistema (login ou app aberto)");
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const lastUserId = useRef(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (authUser) => {
    if (!authUser) { setProfile(null); return true; }

    try {
      const { data: existing, error: selectError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", authUser.id)
        .maybeSingle();

      if (selectError) {
        // Erro transitório (token renovando, cache de schema se ajustando
        // após uma alteração na tabela, etc.) — NÃO tratamos como "perfil não
        // existe". Quem chamou esta função decide se tenta de novo.
        console.warn("Falha temporária ao carregar perfil, mantendo estado atual:", selectError.message);
        return false;
      }

      if (existing) {
        setProfile(existing);
        return true;
      }

      // Sem linha ainda (select funcionou, veio vazio) — acontece no primeiro
      // login (via Google, por exemplo, sem trigger criando o perfil).
      // Criamos um registro mínimo; o vínculo com empresa acontece depois,
      // na tela de ativação (chave de licença ou código de convite).
      const meta = authUser.user_metadata || {};
      await supabase
        .from("profiles")
        .upsert(
          {
            id: authUser.id,
            email: authUser.email,
            name: meta.full_name || meta.name || authUser.email?.split("@")[0] || "Usuário",
            avatar_url: meta.avatar_url || meta.picture || null,
          },
          { onConflict: "id", ignoreDuplicates: true }
        );

      const { data: created } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", authUser.id)
        .maybeSingle();

      setProfile(created || null);
      return Boolean(created);
    } catch (err) {
      // Falha de rede (fetch em si falhando, não uma resposta de erro da API)
      // nunca pode escapar sem tratamento — quem chama depende desta função
      // nunca rejeitar, pra sempre conseguir terminar o carregamento.
      console.warn("Falha ao carregar/criar perfil:", err?.message || err);
      return false;
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getUser();
      if (data?.user) await loadProfile(data.user);
    } catch (err) {
      console.warn("Falha ao atualizar perfil:", err?.message || err);
    }
  }, [loadProfile]);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const authUser = data?.session?.user || null;
        if (cancelled) return;
        setUser(authUser);
        lastUserId.current = authUser?.id || null;
        const ok = await loadProfile(authUser);
        if (ok) logSessionStart(authUser);
        // Se a primeira tentativa falhou (ex: cache de schema do PostgREST
        // ainda se ajustando logo após uma alteração de tabela), tenta de
        // novo sozinho depois de um instante, em vez de deixar a pessoa
        // presa numa tela em branco até recarregar manualmente.
        if (!ok && authUser && !cancelled) {
          setTimeout(() => { if (!cancelled) loadProfile(authUser); }, 2500);
        }
      } catch (err) {
        // Sem este catch, qualquer falha de rede aqui deixava `loading`
        // preso em `true` pra sempre — e como as rotas protegidas renderizam
        // `null`/fallback enquanto `loading` é `true`, a tela inteira ficava
        // em branco pra sempre, sem nenhum jeito de se recuperar sozinha.
        console.warn("Falha ao inicializar sessão:", err?.message || err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    init();

    const { data: listener } =
      supabase.auth.onAuthStateChange((_event, session) => {
        const authUser = session?.user || null;
        setUser(authUser);
        // Saiu (ou outra pessoa entrou nesta aba): esquece os ajustes da empresa anterior.
        if (!authUser || authUser.id !== lastUserId.current) clearCompanySettings();
        lastUserId.current = authUser?.id || null;
        // Consultas ao supabase DENTRO deste callback podem travar o login
        // (trava interna do supabase-js); por isso rodam logo depois.
        setTimeout(async () => {
          if (cancelled) return;
          try {
            const ok = await loadProfile(authUser);
            if (ok) logSessionStart(authUser);
            if (!ok && authUser && !cancelled) {
              setTimeout(() => { if (!cancelled) loadProfile(authUser); }, 2500);
            }
          } catch (err) {
            console.warn("Falha ao carregar perfil após mudança de sessão:", err?.message || err);
          }
        }, 0);
      });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const logout = useCallback(async () => {
    // Registra antes de sair (depois não há mais quem identificar); no máximo 2 s.
    await Promise.race([logEvent("conta", "logout", "Saiu do sistema"), new Promise((r) => setTimeout(r, 2000))]);
    try { if (lastUserId.current) sessionStorage.removeItem(`session-logged:${lastUserId.current}`); } catch { /* ok */ }
    await supabase.auth.signOut();
    clearCompanySettings();
    setUser(null);
    setProfile(null);
  }, []);

  // Papéis derivados do perfil — usados pelas rotas protegidas e pelas telas
  // pra decidir o que mostrar. `activated` indica se a pessoa já resgatou uma
  // chave de licença ou código de colaborador (tem company_id + company_role).
  const isPlatformAdmin = Boolean(profile?.is_platform_admin);
  const isCompanyAdmin = profile?.company_role === "company_admin";
  const isCollaborator = profile?.company_role === "collaborator";
  const isSupervisor = profile?.company_role === "supervisor";
  const activated = Boolean(profile?.company_id && profile?.company_role) || isPlatformAdmin;

  const value = {
    user, profile, loading,
    isPlatformAdmin, isCompanyAdmin, isCollaborator, isSupervisor, activated,
    companyId: profile?.company_id || null,
    refreshProfile, logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Exportar uma função junto do componente só afeta o hot reload em dev.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}
