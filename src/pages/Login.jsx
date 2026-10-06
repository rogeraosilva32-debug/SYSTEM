import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import supabase from "../services/supabase";
import { Box, Button, TextField, Typography, CircularProgress, Container } from "@mui/material";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();

  const [mode, setMode] = useState(location.state?.mode === "signup" ? "signup" : "login");

  // login
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // cadastro
  const [name, setName] = useState("");

  // esqueci minha senha
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState("");

  const handleSubmit = async () => {
    setError("");
    if (!email.trim() || !email.includes("@")) { setError("Informe um e-mail válido."); return; }
    if (password.length < 6) { setError("A senha precisa ter pelo menos 6 caracteres."); return; }
    if (mode === "signup" && !name.trim()) { setError("Informe seu nome."); return; }

    setLoading(true);
    if (mode === "login") {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (signInError) { setError(signInError.message); return; }
      navigate("/", { replace: true });
    } else {
      // O nome vai também no user_metadata: com confirmação de e-mail ligada
      // não há sessão aqui, o upsert abaixo falha e o perfil é criado depois
      // (AuthContext) a partir desse nome.
      const { data, error: signUpError } = await supabase.auth.signUp({
        email, password, options: { data: { name: name.trim() } },
      });
      if (signUpError) { setLoading(false); setError(signUpError.message); return; }
      if (data.user && data.session) {
        await supabase.from("profiles").upsert(
          { id: data.user.id, email: data.user.email, name: name.trim() },
          { onConflict: "id" }
        );
      }
      setLoading(false);
      setMode("login");
      setError("");
      alert("Conta criada! Verifique seu e-mail para confirmar, depois entre normalmente.");
    }
  };

  const handleGoogleLogin = async () => {
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + "/" },
    });
    if (oauthError) setError(oauthError.message);
  };

  const handleForgotPassword = async () => {
    if (!forgotEmail.trim() || !forgotEmail.includes("@")) { setForgotError("Informe um e-mail válido."); return; }
    setForgotLoading(true);
    setForgotError("");
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(forgotEmail.trim(), {
      redirectTo: window.location.origin + "/reset-password",
    });
    setForgotLoading(false);
    // Por segurança, não indicamos se o e-mail existe ou não.
    if (resetError) setForgotError(resetError.message);
    else setForgotSent(true);
  };

  if (mode === "forgot") {
    return (
      <Box sx={{ minHeight: "100vh", background: "#FAFAF9", display: "flex", alignItems: "center" }}>
        <Container maxWidth="xs">
          <Box sx={{ background: "#fff", border: "1px solid #E7E5E4", borderRadius: "16px", p: 4 }}>
            <Typography sx={{ fontWeight: 800, fontSize: 20, color: "#1C1917", mb: 0.5 }}>Recuperar senha</Typography>
            <Typography sx={{ fontSize: 13, color: "#78716C", mb: 3 }}>
              Informe seu e-mail e enviaremos um link pra criar uma senha nova.
            </Typography>

            {forgotSent ? (
              <Box sx={{ background: "#EEF3EF", border: "1px solid #CFE0D5", borderRadius: "12px", p: 2 }}>
                <Typography sx={{ color: "#4B7A5E", fontWeight: 700, fontSize: 13, mb: 0.5 }}>✓ E-mail enviado</Typography>
                <Typography sx={{ color: "#57534E", fontSize: 12.5 }}>
                  Se houver uma conta com esse e-mail, você recebe o link em instantes. Confira o spam também.
                </Typography>
              </Box>
            ) : (
              <TextField
                fullWidth label="E-mail" type="email" value={forgotEmail}
                onChange={(e) => { setForgotEmail(e.target.value); setForgotError(""); }}
                error={!!forgotError} helperText={forgotError} sx={{ mb: 2 }}
              />
            )}

            <Button
              fullWidth variant="contained" sx={{ mt: 2, py: 1.3, borderRadius: "10px", fontWeight: 700 }}
              disabled={forgotLoading}
              onClick={forgotSent ? () => { setMode("login"); setForgotSent(false); } : handleForgotPassword}
            >
              {forgotLoading ? <CircularProgress size={18} sx={{ color: "#fff" }} /> : forgotSent ? "Voltar para o login" : "Enviar link"}
            </Button>
          </Box>
        </Container>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: "100vh", background: "#FAFAF9", display: "flex", alignItems: "center" }}>
      <Container maxWidth="xs">
        <Box sx={{ background: "#fff", border: "1px solid #E7E5E4", borderRadius: "16px", p: 4 }}>
          <Typography sx={{ fontWeight: 800, fontSize: 22, color: "#1C1917", letterSpacing: "-0.02em", mb: 0.5 }}>
            {mode === "login" ? "Entrar" : "Criar conta"}
          </Typography>
          <Typography sx={{ fontSize: 13.5, color: "#78716C", mb: 3 }}>
            {mode === "login" ? "Acesse sua conta pra continuar." : "Depois de criar a conta, você ativa o acesso com a chave da sua empresa."}
          </Typography>

          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.8 }}>
            {mode === "signup" && (
              <TextField fullWidth label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
            )}
            <TextField fullWidth label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <TextField fullWidth label="Senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />

            {mode === "login" && (
              <Typography
                onClick={() => { setMode("forgot"); setForgotEmail(email); }}
                sx={{ alignSelf: "flex-end", fontSize: 12.5, fontWeight: 600, color: "#78716C", cursor: "pointer", "&:hover": { color: "#1C1917" } }}
              >
                Esqueci minha senha
              </Typography>
            )}

            {error && <Typography sx={{ color: "#B0463D", fontSize: 12.5 }}>{error}</Typography>}
          </Box>

          <Button
            fullWidth variant="contained" disabled={loading} onClick={handleSubmit}
            sx={{ mt: 2.5, py: 1.3, borderRadius: "10px", fontWeight: 700 }}
          >
            {loading ? <CircularProgress size={18} sx={{ color: "#fff" }} /> : mode === "login" ? "Entrar" : "Criar conta"}
          </Button>

          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, my: 2.5 }}>
            <Box sx={{ flex: 1, height: 1, background: "#E7E5E4" }} />
            <Typography sx={{ fontSize: 11, fontWeight: 700, color: "#D6D3D1" }}>OU</Typography>
            <Box sx={{ flex: 1, height: 1, background: "#E7E5E4" }} />
          </Box>

          <Button
            fullWidth variant="outlined" onClick={handleGoogleLogin}
            startIcon={<Box component="img" src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" sx={{ width: 18, height: 18 }} />}
            sx={{ py: 1.3, borderRadius: "10px", fontWeight: 700 }}
          >
            Continuar com Google
          </Button>

          <Typography
            onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}
            sx={{ textAlign: "center", mt: 3, fontSize: 13, color: "#78716C", cursor: "pointer" }}
          >
            {mode === "login" ? "Não tem conta? " : "Já tem conta? "}
            <Box component="span" sx={{ color: "#1C1917", fontWeight: 700 }}>
              {mode === "login" ? "Criar conta" : "Entrar"}
            </Box>
          </Typography>
        </Box>
      </Container>
    </Box>
  );
}
