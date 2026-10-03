import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, Container, TextField, Typography, CircularProgress } from "@mui/material";
import LockResetIcon from "@mui/icons-material/LockReset";
import supabase from "../services/supabase";

// Página que recebe o link de "esqueci minha senha" enviado por e-mail.
// O Supabase, ao abrir esse link, detecta o token na URL e dispara o evento
// PASSWORD_RECOVERY sozinho (sem precisarmos ler a URL manualmente) — daí só
// pedimos a nova senha e chamamos updateUser.
export default function ResetPassword() {
  const navigate = useNavigate();

  const [ready, setReady] = useState(false);
  const [linkInvalid, setLinkInvalid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Ref simples (não é estado React) só pra checar dentro do setTimeout se
    // já ficamos prontos por outro caminho — evita capturar um valor antigo
    // de `ready` no closure, que sempre veria o valor da primeira renderização.
    const becameReady = { current: false };

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" && !cancelled) {
        becameReady.current = true;
        setReady(true);
      }
    });

    // Caso o evento já tenha disparado antes deste componente montar (ou a
    // pessoa já tenha uma sessão de recuperação válida de um reload), também
    // aceitamos se já existir uma sessão ativa.
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data?.session) { becameReady.current = true; setReady(true); }
    });

    // Dá um tempo curto pro evento PASSWORD_RECOVERY chegar antes de
    // considerar o link inválido/expirado.
    const timer = setTimeout(() => {
      if (!cancelled && !becameReady.current) setLinkInvalid(true);
    }, 4000);

    return () => { cancelled = true; clearTimeout(timer); listener?.subscription?.unsubscribe(); };
  }, []);

  const handleSave = async () => {
    setError("");
    if (password.length < 6) { setError("A senha precisa ter pelo menos 6 caracteres."); return; }
    if (password !== confirmPassword) { setError("As senhas não conferem."); return; }

    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);

    if (updateError) { setError(updateError.message); return; }
    setDone(true);
    setTimeout(() => navigate("/", { replace: true }), 1800);
  };

  return (
    <Box sx={{ minHeight: "100vh", background: "#FAFAF9", display: "flex", alignItems: "center" }}>
      <Container maxWidth="xs">
        <Box sx={{
          background: "#fff", borderRadius: "22px", p: 3.5,
          border: "1px solid #E7E5E4",
        }}>
          <Box sx={{
            width: 60, height: 60, borderRadius: "50%", mx: "auto", mb: 2,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "#F5F5F4", border: "1.5px solid #E7E5E4",
          }}>
            <LockResetIcon sx={{ fontSize: 30, color: "#292524" }} />
          </Box>

          <Typography sx={{ fontWeight: 800, fontSize: 19, color: "#1C1917", textAlign: "center", mb: 0.5 }}>
            Nova senha
          </Typography>

          {linkInvalid && !ready ? (
            <>
              <Typography sx={{ fontSize: 13, color: "#78716C", textAlign: "center", mb: 3 }}>
                Este link de recuperação é inválido ou já expirou. Solicite um novo na tela de login.
              </Typography>
              <Button
                fullWidth onClick={() => navigate("/login")}
                variant="contained"
                sx={{ borderRadius: "12px", py: 1.3, fontWeight: 700, textTransform: "none" }}
              >
                Voltar para o login
              </Button>
            </>
          ) : !ready ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
              <CircularProgress size={26} sx={{ color: "#292524" }} />
            </Box>
          ) : done ? (
            <Typography sx={{ fontSize: 13, color: "#4B7A5E", textAlign: "center", fontWeight: 700, mb: 1 }}>
              ✓ Senha atualizada! Redirecionando...
            </Typography>
          ) : (
            <>
              <Typography sx={{ fontSize: 13, color: "#78716C", textAlign: "center", mb: 3 }}>
                Escolha uma nova senha para sua conta.
              </Typography>

              <TextField
                fullWidth label="Nova senha" type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                sx={{ mb: 2 }}
              />
              <TextField
                fullWidth label="Confirmar nova senha" type="password"
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setError(""); }}
                error={!!error} helperText={error || "Mínimo 6 caracteres"}
                sx={{ mb: 3 }}
              />

              <Button
                fullWidth onClick={handleSave} disabled={saving}
                variant="contained"
                sx={{ borderRadius: "12px", py: 1.3, fontWeight: 700, textTransform: "none" }}
              >
                {saving ? <CircularProgress size={20} sx={{ color: "#fff" }} /> : "Salvar nova senha"}
              </Button>
            </>
          )}
        </Box>
      </Container>
    </Box>
  );
}
