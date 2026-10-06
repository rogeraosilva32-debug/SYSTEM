import { useEffect, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import supabase from "../services/supabase";
import { useAuth } from "../context/AuthContext";
import { RouteLoading } from "./PageLoading";

// Situação da licença da empresa, consultada uma vez por usuário/empresa na
// sessão. Erro na RPC (ex: função ainda não criada no banco) conta como
// "active" pra não travar ninguém.
const statusCache = new Map();

function fetchCompanyStatus(cacheKey) {
  if (!statusCache.has(cacheKey)) {
    const promise = supabase.rpc("my_company_status")
      .then(({ data, error }) => (error ? "active" : data || "active"))
      .catch(() => "active");
    statusCache.set(cacheKey, promise);
  }
  return statusCache.get(cacheKey);
}

// Bloqueia as telas da empresa enquanto a licença estiver suspensa.
export default function CompanySuspendedGate({ children }) {
  const { user, profile, isPlatformAdmin, logout } = useAuth();
  const needsCheck = Boolean(user && profile?.company_id && !isPlatformAdmin);
  const cacheKey = needsCheck ? `${user.id}:${profile.company_id}` : null;
  const [result, setResult] = useState({ key: null, status: null });

  useEffect(() => {
    if (!cacheKey) return;
    let cancelled = false;
    fetchCompanyStatus(cacheKey).then((status) => {
      if (!cancelled) setResult({ key: cacheKey, status });
    });
    return () => { cancelled = true; };
  }, [cacheKey]);

  if (!needsCheck) return children;
  if (result.key !== cacheKey) return <RouteLoading />;
  if (result.status !== "suspended") return children;

  return (
    <Box sx={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", textAlign: "center",
      px: 4, background: "#f0f2f8",
    }}>
      <Typography sx={{ fontWeight: 800, fontSize: 18, color: "#0f172a", mb: 0.5 }}>
        Acesso suspenso
      </Typography>
      <Typography sx={{ fontSize: 13, color: "#64748b", mb: 3, maxWidth: 340 }}>
        A licença da sua empresa está suspensa. Fale com o administrador da plataforma.
      </Typography>
      <Button
        onClick={logout} variant="outlined"
        sx={{ borderRadius: "12px", textTransform: "none", fontWeight: 700, px: 3 }}
      >
        Sair
      </Button>
    </Box>
  );
}
