import { useState } from "react";
import { Box, Button, Container, TextField, Typography, ToggleButtonGroup, ToggleButton, CircularProgress } from "@mui/material";
import BusinessIcon from "@mui/icons-material/Business";
import BadgeIcon from "@mui/icons-material/Badge";
import supabase from "../services/supabase";
import { useAuth } from "../context/AuthContext";
import { useNavigate, Navigate } from "react-router-dom";
import { homeForCurrentUser } from "../components/RoleRoute";

export default function Activate() {
  const auth = useAuth();
  const { refreshProfile, logout, activated } = auth;
  const navigate = useNavigate();

  // Já ativado (é admin de empresa, colaborador, ou platform admin)? Não faz
  // sentido reabrir esta tela — evita trocar de empresa sem querer.
  if (activated) return <Navigate to={homeForCurrentUser(auth)} replace />;

  return <ActivateForm refreshProfile={refreshProfile} logout={logout} navigate={navigate} />;
}

function ActivateForm({ refreshProfile, logout, navigate }) {

  const [mode, setMode] = useState("company"); // "company" | "collaborator"
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleActivate = async () => {
    const value = code.trim().toUpperCase();
    if (!value) { setError("Informe o código."); return; }
    setLoading(true);
    setError("");

    // A validação da chave e a atualização do vínculo agora acontecem dentro
    // de uma função no banco (redeem_license_key / redeem_invite_code) —
    // antes isso era feito lendo a tabela "companies" direto do navegador,
    // o que exigia deixar license_key/collaborator_invite_code de TODAS as
    // empresas legíveis publicamente pra validação funcionar. Assim, nada
    // sensível trafega pro cliente: a função só devolve nome/id da empresa
    // se a chave for válida.
    const { error: rpcError } = mode === "company"
      ? await supabase.rpc("redeem_license_key", { p_key: value })
      : await supabase.rpc("redeem_invite_code", { p_code: value });

    if (rpcError) {
      // A mensagem vem como "EXCEPTION: texto" — mostra só o texto.
      setError(rpcError.message.replace(/^.*?:\s*/, ""));
      setLoading(false);
      return;
    }

    await refreshProfile();
    setLoading(false);
    navigate("/", { replace: true });
  };

  return (
    <Box sx={{ minHeight: "100vh", background: "#FAFAF9", display: "flex", alignItems: "center" }}>
      <Container maxWidth="xs">
        <Box sx={{ background: "#fff", border: "1px solid #E7E5E4", borderRadius: "16px", p: 4 }}>
          <Typography sx={{ fontWeight: 800, fontSize: 22, color: "#1F2933", mb: 0.5, letterSpacing: "-0.02em" }}>
            Ativar acesso
          </Typography>
          <Typography sx={{ fontSize: 13.5, color: "#78716C", mb: 3 }}>
            Informe a chave da sua empresa, ou o código de convite se você foi
            adicionado como colaborador.
          </Typography>

          <ToggleButtonGroup
            value={mode} exclusive fullWidth
            onChange={(_, v) => { if (v) { setMode(v); setError(""); } }}
            sx={{ mb: 3 }}
          >
            <ToggleButton value="company" sx={{ textTransform: "none", fontWeight: 700, py: 1.2, gap: 1 }}>
              <BusinessIcon sx={{ fontSize: 18 }} /> Empresa nova
            </ToggleButton>
            <ToggleButton value="collaborator" sx={{ textTransform: "none", fontWeight: 700, py: 1.2, gap: 1 }}>
              <BadgeIcon sx={{ fontSize: 18 }} /> Sou colaborador
            </ToggleButton>
          </ToggleButtonGroup>

          <TextField
            fullWidth
            label={mode === "company" ? "Chave de licença" : "Código de convite"}
            value={code}
            onChange={(e) => { setCode(e.target.value); setError(""); }}
            error={!!error}
            helperText={error}
            sx={{ mb: 3 }}
          />

          <Button
            fullWidth variant="contained" disabled={loading}
            onClick={handleActivate}
            sx={{ py: 1.3, borderRadius: "10px", fontWeight: 700, mb: 1.5 }}
          >
            {loading ? <CircularProgress size={20} sx={{ color: "#fff" }} /> : "Ativar"}
          </Button>

          <Button fullWidth onClick={logout} sx={{ color: "#78716C", fontWeight: 600, textTransform: "none" }}>
            Sair
          </Button>
        </Box>
      </Container>
    </Box>
  );
}
