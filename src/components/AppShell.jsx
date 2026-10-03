import { Box, Typography, IconButton, Avatar, Menu, MenuItem, Chip } from "@mui/material";
import LogoutIcon from "@mui/icons-material/Logout";
import NotificationsActiveOutlinedIcon from "@mui/icons-material/NotificationsActiveOutlined";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutlineOutlined";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import NotificationBell from "./NotificationBell";
import { pushSupported, subscribeToPush } from "../utils/pushNotifications";

const ROLE_LABEL = {
  platform: "Administrador da plataforma",
  company_admin: "Administrador",
  collaborator: "Colaborador",
  supervisor: "Supervisor",
};

// Cabeçalho fino e neutro, reaproveitado em toda tela autenticada — mantém a
// aparência consistente sem repetir o mesmo markup em cada página. `title`
// aparece à esquerda; ações específicas da tela (botões, filtros) entram via
// `actions`.
export default function AppShell({ title, actions, children }) {
  const { profile, isPlatformAdmin, isCompanyAdmin, isCollaborator, isSupervisor, logout } = useAuth();
  const [anchorEl, setAnchorEl] = useState(null);
  const [pushMsg, setPushMsg] = useState("");
  const navigate = useNavigate();

  const roleKey = isPlatformAdmin ? "platform" : isCompanyAdmin ? "company_admin" : isSupervisor ? "supervisor" : isCollaborator ? "collaborator" : null;

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

  return (
    <Box sx={{ minHeight: "100vh", background: "#FAFAF9" }}>
      <Box sx={{
        position: "sticky", top: 0, zIndex: 10,
        background: "rgba(250,250,249,0.9)", backdropFilter: "blur(10px)",
        borderBottom: "1px solid #E7E5E4",
        px: { xs: 2, sm: 4 }, py: 2,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2,
      }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 800, fontSize: { xs: 16, sm: 18 }, color: "#1C1917", letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>
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
          {isCollaborator && (
            <IconButton size="small" onClick={() => navigate("/mensagens")}>
              <ChatBubbleOutlineIcon sx={{ fontSize: 20, color: "#57534E" }} />
            </IconButton>
          )}
          <NotificationBell />
          <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} size="small">
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
        {children}
      </Box>
    </Box>
  );
}
