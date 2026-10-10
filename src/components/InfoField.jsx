import { Box, Typography } from "@mui/material";

// Padrão "rótulo pequeno em caixa alta acima do valor em destaque" — usado
// em qualquer lugar que hoje mostra informação como frase corrida
// ("Colaborador: Fulano"), que ficava com pouca hierarquia visual e lia
// como texto solto em vez de dado estruturado.
export default function InfoField({ label, value, sx }) {
  return (
    <Box sx={sx}>
      <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: "#8A8580", letterSpacing: "0.06em", textTransform: "uppercase", mb: 0.3 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 14, fontWeight: 700, color: "#1F2933", letterSpacing: "-0.01em" }}>
        {value}
      </Typography>
    </Box>
  );
}
