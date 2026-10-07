import { useState, useEffect } from "react";
import { Badge, IconButton, Menu, Box, Typography, Button, Divider } from "@mui/material";
import NotificationsIcon from "@mui/icons-material/Notifications";
import RouteIcon from "@mui/icons-material/AltRoute";
import AssignmentIcon from "@mui/icons-material/Assignment";
import PlayCircleIcon from "@mui/icons-material/PlayCircleOutlineOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutlineOutlined";
import supabase from "../services/supabase";
import { useAuth } from "../context/AuthContext";
import { showStatusBarNotification } from "../utils/pushNotifications";

const ICON_BY_TYPE = {
  new_assignment: <AssignmentIcon sx={{ fontSize: 18, color: "#4A6C8C" }} />,
  assignment_started: <PlayCircleIcon sx={{ fontSize: 18, color: "#B0793D" }} />,
  assignment_completed: <CheckCircleIcon sx={{ fontSize: 18, color: "#4B7A5E" }} />,
  off_route: <RouteIcon sx={{ fontSize: 18, color: "#B0463D" }} />,
  new_message: <ChatBubbleOutlineIcon sx={{ fontSize: 18, color: "#4A6C8C" }} />,
};

function timeAgo(iso) {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "agora";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86400)} d`;
}

// Sino no topo com a lista de avisos, em tempo real. Com a permissão dada,
// cada aviso novo também aparece na barra de status do celular.
export default function NotificationBell() {
  const { profile } = useAuth();
  const [items, setItems] = useState([]);
  const [anchorEl, setAnchorEl] = useState(null);

  useEffect(() => {
    if (!profile?.id) return;
    supabase
      .from("notifications")
      .select("*")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(30)
      .then(({ data }) => setItems(data || []));
  }, [profile]);

  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel(`notifications-${profile.id}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${profile.id}`,
      }, (payload) => {
        setItems((prev) => [payload.new, ...prev]);
        showStatusBarNotification(payload.new);
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [profile?.id]);

  const unreadCount = items.filter((n) => !n.read).length;

  const markRead = async (id) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    await supabase.from("notifications").update({ read: true }).eq("id", id);
  };

  const markAllRead = async () => {
    const unreadIds = items.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    await supabase.from("notifications").update({ read: true }).in("id", unreadIds);
  };

  return (
    <>
      <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} size="small">
        <Badge badgeContent={unreadCount} color="error" max={9}>
          <NotificationsIcon sx={{ fontSize: 21, color: "#57534E" }} />
        </Badge>
      </IconButton>

      <Menu
        anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { width: 340, maxHeight: 420 } } }}
      >
        <Box sx={{ px: 2, py: 1.2, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography sx={{ fontWeight: 800, fontSize: 14 }}>Notificações</Typography>
          {unreadCount > 0 && (
            <Button size="small" onClick={markAllRead} sx={{ textTransform: "none", fontSize: 12, fontWeight: 700 }}>
              Marcar tudo como lido
            </Button>
          )}
        </Box>
        <Divider />

        {items.length === 0 ? (
          <Typography sx={{ p: 3, textAlign: "center", color: "#A8A29E", fontSize: 13 }}>
            Nenhuma notificação ainda.
          </Typography>
        ) : (
          items.map((n) => (
            <Box
              key={n.id}
              onClick={() => !n.read && markRead(n.id)}
              sx={{
                display: "flex", gap: 1.2, px: 2, py: 1.4, cursor: n.read ? "default" : "pointer",
                background: n.read ? "transparent" : "#F5F5F4",
                borderBottom: "1px solid #F5F5F4",
                "&:hover": { background: "#F5F5F4" },
              }}
            >
              <Box sx={{ mt: 0.2 }}>{ICON_BY_TYPE[n.type] || <NotificationsIcon sx={{ fontSize: 18 }} />}</Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ fontSize: 13, fontWeight: n.read ? 600 : 800, color: "#1C1917" }}>{n.title}</Typography>
                <Typography sx={{ fontSize: 12, color: "#78716C", mt: 0.1 }}>{n.message}</Typography>
                <Typography sx={{ fontSize: 10.5, color: "#A8A29E", mt: 0.3 }}>{timeAgo(n.created_at)}</Typography>
              </Box>
            </Box>
          ))
        )}
      </Menu>
    </>
  );
}
