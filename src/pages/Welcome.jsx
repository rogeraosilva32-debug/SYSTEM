import { useNavigate } from "react-router-dom";
import { Box, Button, Typography, Container } from "@mui/material";
import GorapLogo from "../components/GorapLogo";

export default function Welcome() {
  const navigate = useNavigate();

  return (
    <Box sx={{ minHeight: "100vh", background: "#FAFAF9", display: "flex", flexDirection: "column" }}>
      <Container maxWidth="sm" sx={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", py: 8 }}>
        <GorapLogo height={44} style={{ marginBottom: 28, maxWidth: "100%" }} />
        <Typography sx={{ fontSize: { xs: 32, sm: 40 }, fontWeight: 800, color: "#1F2933", letterSpacing: "-0.03em", lineHeight: 1.15, mb: 2 }}>
          Sua equipe, seus serviços,<br />organizados num só lugar.
        </Typography>
        <Typography sx={{ fontSize: 15, color: "#57534E", mb: 5, maxWidth: 440, lineHeight: 1.6 }}>
          Cadastre colaboradores, defina os serviços que sua empresa oferece e designe cada
          atendimento com endereço, horário e duração — tudo acompanhado em tempo real.
        </Typography>

        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
          <Button
            variant="contained" size="large"
            onClick={() => navigate("/login", { state: { mode: "login" } })}
            sx={{ px: 4, py: 1.4, borderRadius: "12px", fontWeight: 700 }}
          >
            Entrar
          </Button>
          <Button
            variant="outlined" size="large"
            onClick={() => navigate("/login", { state: { mode: "signup" } })}
            sx={{ px: 4, py: 1.4, borderRadius: "12px", fontWeight: 700 }}
          >
            Criar conta
          </Button>
        </Box>
      </Container>

      <Box sx={{ py: 3, textAlign: "center" }}>
        <Typography sx={{ fontSize: 11, color: "#A8A29E", letterSpacing: "0.12em" }}>GESTÃO · ORGANIZAÇÃO · ROTAS · ANÁLISE · PRECISÃO</Typography>
      </Box>
    </Box>
  );
}
