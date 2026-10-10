import { createTheme } from "@mui/material/styles";

// Identidade GORAP: laranja (#FF6B1A) nos botões principais e destaques,
// grafite (#1F2933) nos textos e off-white (#FAFAF9) no fundo. Fora isso a
// paleta segue neutra, com cor só pra estados semânticos (sucesso/aviso/erro). Bordas finas em vez
// de sombras pesadas; cantos levemente arredondados; tipografia como
// principal ferramenta de hierarquia (peso e espaçamento, não cor).
const neutral = {
  50:  "#FAFAF9",
  100: "#F5F5F4",
  150: "#EFEEEC",
  200: "#E7E5E4",
  300: "#D6D3D1",
  400: "#A8A29E",
  500: "#78716C",
  600: "#57534E",
  700: "#44403C",
  800: "#2B3642",
  900: "#1F2933",
};

export const BRAND = { orange: "#FF6B1A", orangeDark: "#E5560A", graphite: "#1F2933" };

const theme = createTheme({
  palette: {
    mode: "light",
    background: {
      default: neutral[50],
      paper: "#FFFFFF",
    },
    text: {
      primary: neutral[900],
      secondary: neutral[500],
    },
    divider: neutral[200],
    primary: {
      main: BRAND.orange,
      light: "#FF8A47",
      dark: BRAND.orangeDark,
      contrastText: "#FFFFFF",
    },
    secondary: {
      main: neutral[400],
      contrastText: "#FFFFFF",
    },
    success: { main: "#4B7A5E" },
    warning: { main: "#B0793D" },
    error:   { main: "#B0463D" },
    info:    { main: "#4A6C8C" },
    neutral,
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
    h1: { fontWeight: 800, letterSpacing: "-0.02em" },
    h2: { fontWeight: 800, letterSpacing: "-0.02em" },
    h3: { fontWeight: 700, letterSpacing: "-0.01em" },
    h4: { fontWeight: 700, letterSpacing: "-0.01em" },
    h5: { fontWeight: 700 },
    h6: { fontWeight: 700 },
    button: { fontWeight: 600, textTransform: "none" },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: neutral[50] },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
        },
        outlined: {
          borderColor: neutral[200],
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 10,
          fontWeight: 600,
        },
        containedPrimary: {
          "&:hover": { backgroundColor: BRAND.orangeDark },
        },
        outlined: {
          borderColor: neutral[300],
          color: neutral[800],
          "&:hover": { borderColor: neutral[500], backgroundColor: neutral[100] },
        },
      },
    },
    MuiTextField: {
      defaultProps: { size: "small" },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          backgroundColor: "#FFFFFF",
        },
        notchedOutline: {
          borderColor: neutral[200],
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 600,
          borderRadius: 8,
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontWeight: 700,
          color: neutral[500],
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          borderBottomColor: neutral[200],
        },
        root: {
          borderBottomColor: neutral[150],
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        indicator: { backgroundColor: BRAND.orange, height: 2 },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          fontWeight: 600,
          color: neutral[500],
          "&.Mui-selected": { color: neutral[900] },
        },
      },
    },
  },
});

export default theme;
