import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Box, Container, Typography, Rating, TextField, Button, CircularProgress } from "@mui/material";
import supabase from "../services/supabase";

// Página pública — o cliente final abre isso a partir do link enviado pelo
// colaborador/admin depois de um atendimento concluído. Não exige login: a
// segurança vem do token aleatório na URL (mesma ideia de um link de
// redefinição de senha), validado pela função submit_rating no banco.
export default function RatingPage() {
  const { token } = useParams();
  const [context, setContext] = useState(null);
  const [error, setError] = useState("");
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [brand, setBrand] = useState(null);

  useEffect(() => {
    supabase.rpc("get_rating_context", { p_token: token }).then(({ data, error: rpcError }) => {
      if (rpcError || !data?.length) { setError("Link inválido ou expirado."); return; }
      setContext(data[0]);
    });
    // Marca da empresa (se liberada): logo, imagem e nome no topo.
    supabase.rpc("get_rating_branding", { p_token: token }).then(({ data }) => setBrand(data?.[0] || null));
  }, [token]);

  const handleSubmit = async () => {
    if (rating < 1) { setError("Escolha uma nota de 1 a 5."); return; }
    setSubmitting(true);
    setError("");
    const { error: rpcError } = await supabase.rpc("submit_rating", {
      p_token: token, p_rating: rating, p_feedback: feedback.trim() || null,
    });
    setSubmitting(false);
    if (rpcError) { setError(rpcError.message.replace(/^.*?:\s*/, "")); return; }
    setDone(true);
  };

  return (
    <Box sx={{ minHeight: "100vh", background: "#FAFAF9", display: "flex", alignItems: "center" }}>
      <Container maxWidth="xs">
        {brand?.brand_share_url && (
          <Box component="img" src={brand.brand_share_url} alt="" sx={{ width: "100%", borderRadius: "16px", mb: 2, display: "block" }} />
        )}
        <Box sx={{ background: "#fff", border: "1px solid #E7E5E4", borderTop: brand?.brand_color ? `4px solid ${brand.brand_color}` : undefined, borderRadius: "16px", p: 4, textAlign: "center" }}>
          {brand?.brand_logo_url && (
            <Box component="img" src={brand.brand_logo_url} alt={brand.company_name} sx={{ height: 48, maxWidth: "70%", objectFit: "contain", mb: 2 }} />
          )}
          {brand?.company_name && !brand?.brand_logo_url && (
            <Typography sx={{ fontWeight: 800, fontSize: 13, color: "#78716C", mb: 1 }}>{brand.company_name}</Typography>
          )}
          {!context && !error && <CircularProgress size={26} />}

          {error && !context && (
            <Typography sx={{ color: "#B0463D", fontSize: 14 }}>{error}</Typography>
          )}

          {context && !done && (
            <>
              <Typography sx={{ fontWeight: 800, fontSize: 19, color: "#1F2933", mb: 0.5 }}>
                Como foi o atendimento?
              </Typography>
              <Typography sx={{ fontSize: 13, color: "#78716C", mb: 3 }}>
                {context.service_name} · {new Date(context.scheduled_start).toLocaleDateString("pt-BR")}
              </Typography>

              {context.already_rated ? (
                <Typography sx={{ fontSize: 13, color: "#4B7A5E", fontWeight: 700 }}>
                  ✓ Esse atendimento já foi avaliado. Obrigado!
                </Typography>
              ) : (
                <>
                  <Rating size="large" value={rating} onChange={(_, v) => setRating(v)} sx={{ mb: 2 }} />
                  <TextField
                    fullWidth multiline minRows={3} placeholder="Quer contar mais alguma coisa? (opcional)"
                    value={feedback} onChange={(e) => setFeedback(e.target.value)} sx={{ mb: 2 }}
                  />
                  {error && <Typography sx={{ color: "#B0463D", fontSize: 12.5, mb: 1.5 }}>{error}</Typography>}
                  <Button
                    fullWidth variant="contained" onClick={handleSubmit} disabled={submitting}
                    sx={{ py: 1.3, borderRadius: "10px", fontWeight: 700 }}
                  >
                    {submitting ? <CircularProgress size={18} sx={{ color: "#fff" }} /> : "Enviar avaliação"}
                  </Button>
                </>
              )}
            </>
          )}

          {done && (
            <Typography sx={{ fontSize: 14, color: "#4B7A5E", fontWeight: 700 }}>
              ✓ Obrigado pela sua avaliação!
            </Typography>
          )}
        </Box>
      </Container>
    </Box>
  );
}
