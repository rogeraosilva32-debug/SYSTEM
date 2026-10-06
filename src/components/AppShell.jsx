import {
  Box, Typography, IconButton, Avatar, Menu, MenuItem, Chip, Drawer, Badge, Tooltip, useMediaQuery,
} from "@mui/material";
import LogoutIcon from "@mui/icons-material/Logout";
import NotificationsActiveOutlinedIcon from "@mui/icons-material/NotificationsActiveOutlined";
import MenuIcon from "@mui/icons-material/Menu";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import TwoWheelerIcon from "@mui/icons-material/TwoWheeler";
import AssignmentOutlinedIcon from "@mui/icons-material/AssignmentOutlined";
import PaymentsOutlinedIcon from "@mui/icons-material/PaymentsOutlined";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutlineOutlined";
import { useEffect, useMemo, useState } from "react";
import { ThemeProvider, createTheme, useTheme } from "@mui/material/styles";
import { useCompanySettings } from "../hooks/useCompanySettings";
import useUnreadMessages from "../hooks/useUnreadMessages";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import NotificationBell from "./NotificationBell";
import { SupportBanner, PlatformNotices } from "./PlatformBanners";
import { markFirstPageShown } from "./PageLoading";
import { pushSupported, subscribeToPush } from "../utils/pushNotifications";

const ROLE_LABEL = {
  platform: "Administrador da plataforma",
  company_admin: "Administrador",
  collaborator: "Colaborador",
  supervisor: "Supervisor",
};

const WIDE = 236;
const NARROW = 72;
const COLLAPSE_KEY = "menu-lateral-recolhido";
const HIDDEN_KEY = "menu-lateral-escondido";

// Menu do colaborador (motoboy): cada item é uma página.
const COLLABORATOR_ITEMS = [
  { key: "/entregas", path: "/entregas", label: "Entregas", icon: <TwoWheelerIcon /> },
  { key: "/tarefas", path: "/tarefas", label: "Tarefas", icon: <AssignmentOutlinedIcon /> },
  { key: "/ganhos", path: "/ganhos", label: "Ganhos", icon: <PaymentsOutlinedIcon /> },
  { key: "/mensagens", path: "/mensagens", label: "Mensagens", icon: <ChatBubbleOutlineIcon />, unread: true },
];

function NavList({ items, current, onSelect, narrow, unread }) {
  return (
    <Box component="nav" aria-label="Menu" sx={{ display: "flex", flexDirection: "column", gap: 0.3, px: narrow ? 1 : 1.5, py: 1 }}>
      {items.map((item, i) => {
        const header = item.group && item.group !== items[i - 1]?.group && !narrow ? item.group : null;
        const active = item.key === current;
        const badge = item.unread ? unread : item.badge || 0;
        const icon = (
          <Badge badgeContent={badge} color="error" max={99} invisible={!badge}
            sx={{ "& .MuiBadge-badge": { fontSize: 10, height: 16, minWidth: 16 } }}>
            <Box sx={{ display: "flex", "& svg": { fontSize: 21 } }}>{item.icon}</Box>
          </Badge>
        );
        const row = (
          <Box
            component="button" type="button" onClick={() => onSelect(item)}
            aria-current={active ? "page" : undefined}
            sx={{
              display: "flex", alignItems: "center", gap: 1.5, width: "100%", border: 0, cursor: "pointer",
              font: "inherit", textAlign: "left", borderRadius: "10px",
              px: narrow ? 0 : 1.4, py: 1.05, justifyContent: narrow ? "center" : "flex-start",
              background: active ? "#1C1917" : "transparent",
              color: active ? "#fff" : "#57534E",
              "&:hover": { background: active ? "#1C1917" : "#F0EFEE" },
              "&:focus-visible": { outline: "2px solid #A8A29E" },
            }}
          >
            {icon}
            {!narrow && (
              <Typography component="span" sx={{ fontSize: 13.5, fontWeight: active ? 800 : 600, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {item.label}
              </Typography>
            )}
          </Box>
        );
        return (
          <Box key={item.key}>
            {header && (
              <Typography sx={{ fontSize: 10.5, fontWeight: 800, color: "#A8A29E", letterSpacing: "0.08em", textTransform: "uppercase", px: 1.4, pt: 1.6, pb: 0.5 }}>
                {header}
              </Typography>
            )}
            {narrow ? <Tooltip title={item.label} placement="right">{row}</Tooltip> : row}
          </Box>
        );
      })}
    </Box>
  );
}

// Moldura das telas logadas: menu lateral (no celular, abre pelo botão ☰),
// cabeçalho com título, notificações e conta. `nav` = { items, current,
// onSelect }; cada item tem key, label, icon e, opcionalmente, group, badge,
// path (navega para a página) e unread (mostra as mensagens não lidas).
export default function AppShell({ title, actions, children, nav }) {
  const { profile, isPlatformAdmin, isCompanyAdmin, isCollaborator, isSupervisor, logout } = useAuth();
  const [anchorEl, setAnchorEl] = useState(null);
  const [pushMsg, setPushMsg] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [narrow, setNarrow] = useState(() => { try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; } });
  // No computador o menu também pode sumir de vez (botão ☰ do topo).
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(HIDDEN_KEY) === "1"; } catch { return false; } });
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const unread = useUnreadMessages();

  // Marca própria da empresa (quando liberada pela plataforma): logo no
  // cabeçalho, cor principal nos botões e ícone na aba do navegador.
  const brand = useCompanySettings(Boolean(profile?.company_id));
  const baseTheme = useTheme();
  const desktop = useMediaQuery(baseTheme.breakpoints.up("md"), { noSsr: true });
  const brandColor = brand?.brand_color;
  const theme = useMemo(() => (brandColor
    ? createTheme(baseTheme, { palette: { primary: { main: brandColor, dark: brandColor, contrastText: "#FFFFFF" } } })
    : baseTheme), [baseTheme, brandColor]);
  useEffect(() => {
    if (!brand?.brand_icon_url) return;
    const link = document.querySelector("link[rel~='icon']");
    if (!link) return;
    const previous = link.href;
    link.href = brand.brand_icon_url;
    return () => { link.href = previous; };
  }, [brand?.brand_icon_url]);

  const roleKey = isPlatformAdmin ? "platform" : isCompanyAdmin ? "company_admin" : isSupervisor ? "supervisor" : isCollaborator ? "collaborator" : null;

  // Colaborador sem menu próprio na tela usa o menu das páginas dele.
  const menu = nav || (isCollaborator ? { items: COLLABORATOR_ITEMS, current: pathname } : null);
  const select = (item) => {
    setMobileOpen(false);
    if (item.path) { if (item.path !== pathname) navigate(item.path); return; }
    menu?.onSelect?.(item.key);
  };
  // Página sem carregamento próprio: a abertura do app terminou aqui.
  useEffect(() => { markFirstPageShown(); }, []);

  const toggleHidden = () => setHidden((h) => {
    try { localStorage.setItem(HIDDEN_KEY, h ? "0" : "1"); } catch { /* sem armazenamento */ }
    return !h;
  });
  const toggleNarrow = () => setNarrow((n) => {
    try { localStorage.setItem(COLLAPSE_KEY, n ? "0" : "1"); } catch { /* sem armazenamento */ }
    return !n;
  });

  const handleEnablePush = async () => {
    setPushMsg("Ativando...");
    try {
      await subscribeToPush(profile.id);
      setPushMsg("Notificações ativadas!");
    } catch (err) {
      setPushMsg(err.message);
    }
    setTimeout(() => setPushMsg(""), 3000);
  };

  const sideWidth = hidden ? 0 : narrow ? NARROW : WIDE;
  const brandBlock = (isNarrow) => (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.2, px: isNarrow ? 1 : 2.2, py: 2, minHeight: 64, justifyContent: isNarrow ? "center" : "flex-start" }}>
      {brand?.brand_logo_url ? (
        <Box component="img" src={brand.brand_logo_url} alt={brand.name}
          sx={{ height: 30, maxWidth: isNarrow ? 48 : 150, objectFit: "contain" }} />
      ) : (
        <Box sx={{ width: 30, height: 30, borderRadius: "9px", background: "#1C1917", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 14, flexShrink: 0 }}>
          {(brand?.name || (isPlatformAdmin ? "Plataforma" : title) || "S").charAt(0)}
        </Box>
      )}
      {!isNarrow && !brand?.brand_logo_url && (
        <Typography sx={{ fontWeight: 800, fontSize: 14, color: "#1C1917", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {brand?.name || (isPlatformAdmin ? "Plataforma" : "Painel")}
        </Typography>
      )}
    </Box>
  );

  return (
    <Box sx={{ minHeight: "100vh", background: "#FAFAF9", display: "flex" }}>
      {menu && desktop && (
        <Box className="no-print" component="aside" sx={{
          width: sideWidth, flexShrink: 0, position: "sticky", top: 0, height: "100vh", overflow: "hidden",
          borderRight: hidden ? 0 : "1px solid #E7E5E4", background: "#fff", display: "flex", flexDirection: "column",
          transition: "width .2s", visibility: hidden ? "hidden" : "visible",
        }} aria-hidden={hidden || undefined}>
          {brandBlock(narrow)}
          <Box sx={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
            <NavList items={menu.items} current={menu.current} onSelect={select} narrow={narrow} unread={unread} />
          </Box>
          <Box sx={{ p: 1, borderTop: "1px solid #F5F5F4", display: "flex", justifyContent: narrow ? "center" : "flex-end" }}>
            <Tooltip title={narrow ? "Abrir menu" : "Recolher menu"} placement="right">
              <IconButton size="small" onClick={toggleNarrow} aria-label={narrow ? "Abrir menu" : "Recolher menu"}>
                {narrow ? <ChevronRightIcon /> : <ChevronLeftIcon />}
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      )}

      {menu && !desktop && (
        <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} PaperProps={{ sx: { width: 270 } }}>
          {brandBlock(false)}
          <NavList items={menu.items} current={menu.current} onSelect={select} narrow={false} unread={unread} />
        </Drawer>
      )}

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <SupportBanner />
        <Box className="no-print" sx={{
          position: "sticky", top: 0, zIndex: 10,
          background: "rgba(250,250,249,0.9)", backdropFilter: "blur(10px)",
          borderBottom: "1px solid #E7E5E4",
          px: { xs: 2, sm: 4 }, py: 2,
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2,
        }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, minWidth: 0 }}>
            {menu && !desktop && (
              <IconButton edge="start" onClick={() => setMobileOpen(true)} aria-label="Abrir menu">
                <Badge color="error" variant="dot" invisible={!unread}><MenuIcon /></Badge>
              </IconButton>
            )}
            {menu && desktop && (
              <Tooltip title={hidden ? "Mostrar menu" : "Esconder menu"}>
                <IconButton edge="start" onClick={toggleHidden} aria-label={hidden ? "Mostrar menu" : "Esconder menu"} aria-expanded={!hidden}>
                  <Badge color="error" variant="dot" invisible={!unread || !hidden}><MenuIcon /></Badge>
                </IconButton>
              </Tooltip>
            )}
            {!(menu && desktop && !hidden) && brand?.brand_logo_url && (
              <Box component="img" src={brand.brand_logo_url} alt={brand.name}
                sx={{ height: { xs: 24, sm: 34 }, maxWidth: { xs: 72, sm: 140 }, objectFit: "contain", flexShrink: 0 }} />
            )}
            <Typography sx={{ fontWeight: 800, fontSize: { xs: 16, sm: 18 }, color: "#1C1917", letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
              {title}
            </Typography>
            {roleKey && (
              <Chip
                label={ROLE_LABEL[roleKey]}
                size="small"
                sx={{
                  display: { xs: "none", sm: "inline-flex" },
                  height: 22, fontSize: 11, fontWeight: 700,
                  background: "#F5F5F4", color: "#57534E", border: "1px solid #E7E5E4",
                }}
              />
            )}
          </Box>

          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexShrink: 0 }}>
            {actions}
            <NotificationBell />
            <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} size="small" aria-label="Conta">
              <Avatar src={profile?.avatar_url} sx={{ width: 32, height: 32, fontSize: 13, background: "#292524" }}>
                {profile?.name?.charAt(0)}
              </Avatar>
            </IconButton>
            <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)}>
              <MenuItem disabled sx={{ opacity: "1 !important", fontSize: 13 }}>
                {profile?.name} · {profile?.email}
              </MenuItem>
              {pushSupported() && (
                <MenuItem onClick={handleEnablePush} sx={{ fontSize: 13, gap: 1 }}>
                  <NotificationsActiveOutlinedIcon sx={{ fontSize: 16 }} />
                  {pushMsg || "Ativar notificações push"}
                </MenuItem>
              )}
              <MenuItem onClick={logout} sx={{ fontSize: 13, gap: 1 }}>
                <LogoutIcon sx={{ fontSize: 16 }} /> Sair
              </MenuItem>
            </Menu>
          </Box>
        </Box>

        <Box sx={{ px: { xs: 2, sm: 4 }, py: { xs: 3, sm: 4 }, maxWidth: 1100, mx: "auto" }}>
          <PlatformNotices />
          <ThemeProvider theme={theme}>{children}</ThemeProvider>
        </Box>
      </Box>
    </Box>
  );
}
