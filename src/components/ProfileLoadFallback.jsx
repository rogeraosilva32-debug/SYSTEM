import { useEffect, useState } from "react";
import { Box, Button, CircularProgress, Typography } from "@mui/material";
import { useAuth } from "../context/AuthContext";
import BrandLoader from "./BrandLoader";

// Usado por ProtectedRoute e AdminRoute enquanto `user` já existe mas
// `profile` ainda não carregou. Nos primeiros segundos mostra só um spinner
// (é o caso normal, comum). Se passar de um tempo razoável, mostra um botão
// de "tentar de novo" — SEM isso, a tela ficava em branco pra sempre sempre
// que o carregamento do perfil falhasse (ex: instabilidade de rede, ou o
// cache de schema do Supabase se ajustando depois de uma alteração na
// tabela), sem nenhum jeito de a pessoa se recuperar sozinha.
export default function ProfileLoadFallback() {
  const { refreshProfile, logout } = useAuth();
  const [showRetry, setShowRetry] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowRetry(true), 4000);
    return () => clearTimeout(timer);
  }, []);

  const handleRetry = async () => {
    setRetrying(true);
    await refreshProfile();
    setRetrying(false);
  };

  if (!showRetry) {
    return (
      <BrandLoader instant />
    );
  }

  return (
    <Box sx={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", textAlign: "center",
      px: 4, background: "#f0f2f8",
    }}>
      <Typography sx={{ fontSize: 32, mb: 1.5 }}>😕</Typography>
      <Typography sx={{ fontWeight: 800, fontSize: 16, color: "#0f172a", mb: 0.5 }}>
        Não conseguimos carregar seu perfil
      </Typography>
      <Typography sx={{ fontSize: 13, color: "#64748b", mb: 3, maxWidth: 320 }}>
        Pode ser uma instabilidade passageira de conexão. Tente de novo, ou saia e entre novamente.
      </Typography>
      <Box sx={{ display: "flex", gap: 1.5 }}>
        <Button
          onClick={handleRetry} disabled={retrying} variant="contained"
          sx={{
            background: "linear-gradient(135deg,#0f3460,#1a56db)", borderRadius: "12px",
            textTransform: "none", fontWeight: 700, px: 3,
          }}
        >
          {retrying ? <CircularProgress size={18} sx={{ color: "#fff" }} /> : "Tentar de novo"}
        </Button>
        <Button
          onClick={logout} variant="outlined"
          sx={{ borderRadius: "12px", textTransform: "none", fontWeight: 700, px: 3 }}
        >
          Sair
        </Button>
      </Box>
    </Box>
  );
}
