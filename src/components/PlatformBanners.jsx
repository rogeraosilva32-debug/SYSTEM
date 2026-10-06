import { useEffect, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
import { useNavigate } from "react-router-dom";
import supabase from "../services/supabase";
import { useAuth } from "../context/AuthContext";

// Faixa do modo suporte: deixa claro que é a plataforma olhando a empresa,
// só leitura, com o botão para voltar. Confere no banco se o modo está
// mesmo ativo (sem o script atualizado, o banco ignora o pedido).
export function SupportBanner() {
  const { support, stopSupport } = useAuth();
  const navigate = useNavigate();
  const [check, setCheck] = useState({ id: null, ok: true });

  useEffect(() => {
    if (!support?.id) return;
    let cancelled = false;
    supabase.rpc("support_status").then(({ data, error }) => {
      if (!cancelled) setCheck({ id: support.id, ok: !error && data === support.id });
    });
    return () => { cancelled = true; };
  }, [support?.id]);

  if (!support) return null;
  const ok = check.id !== support.id || check.ok;
  const exit = async () => { await stopSupport(); navigate("/plataforma", { replace: true }); };

  return (
    <Box role="status" sx={{
      display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", px: { xs: 2, sm: 4 }, py: 1,
      background: ok ? "#1C1917" : "#B0463D", color: "#fff",
    }}>
      <VisibilityOutlinedIcon sx={{ fontSize: 18 }} />
      <Typography sx={{ fontSize: 13, fontWeight: 700, flex: 1, minWidth: 200 }}>
        {ok
          ? <>Modo suporte: vendo como <b>{support.name}</b>. Só leitura, nada pode ser alterado.</>
          : "O banco não ativou o modo suporte. Rode de novo o supabase-b2b-schema.sql no Supabase."}
      </Typography>
      <Button size="small" onClick={exit} sx={{ color: "#1C1917", background: "#fff", fontWeight: 800, "&:hover": { background: "#F5F5F4" } }}>
        Voltar para a plataforma
      </Button>
    </Box>
  );
}

const NOTICE_COLORS = {
  info: { bg: "#EEF4FB", border: "#C9DBF0", fg: "#1F4E80" },
  warning: { bg: "#FDF6E7", border: "#F1DDAA", fg: "#7A5512" },
  critical: { bg: "#F6EBEA", border: "#E7C3BF", fg: "#8C2F27" },
};

// Avisos que a plataforma publicou para esta empresa.
export function PlatformNotices() {
  const { companyId, isPlatformAdmin, support } = useAuth();
  const [notices, setNotices] = useState([]);
  const [usage, setUsage] = useState(null);
  const enabled = Boolean(companyId && !isPlatformAdmin && !support);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = () => {
      supabase.rpc("my_platform_notices").then(({ data, error }) => {
        if (!cancelled && !error) setNotices(data || []);
      });
      supabase.rpc("my_plan_usage").then(({ data, error }) => {
        if (!cancelled && !error) setUsage(data || null);
      });
    };
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(t); };
  }, [enabled]);

  // Perto do limite de pedidos do plano (80% ou mais).
  const nearLimit = usage?.max_orders_month && usage.orders_month >= usage.max_orders_month * 0.8;
  if (!enabled || (!notices.length && !nearLimit)) return null;
  const dismiss = async (id) => {
    setNotices((list) => list.filter((n) => n.id !== id));
    await supabase.rpc("dismiss_platform_notice", { p_id: id });
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 2.5 }}>
      {nearLimit && (() => {
        const full = usage.orders_month >= usage.max_orders_month;
        const c = full ? NOTICE_COLORS.critical : NOTICE_COLORS.warning;
        return (
          <Box data-testid="limite-plano" sx={{ p: 1.8, borderRadius: "14px", background: c.bg, border: `1px solid ${c.border}`, color: c.fg }}>
            <Typography sx={{ fontWeight: 800, fontSize: 14 }}>
              Plano {usage.plan}: {usage.orders_month} de {usage.max_orders_month} pedidos este mês
            </Typography>
            <Typography sx={{ fontSize: 13, mt: 0.3 }}>
              {full ? "O limite foi atingido e novos pedidos não entram até o mês virar. Fale com a plataforma para aumentar."
                : "Está perto do limite. Fale com a plataforma se precisar de mais."}
            </Typography>
          </Box>
        );
      })()}
      {notices.map((n) => {
        const c = NOTICE_COLORS[n.level] || NOTICE_COLORS.info;
        return (
          <Box key={n.id} data-testid="aviso-plataforma" sx={{
            display: "flex", gap: 1.5, alignItems: "flex-start", p: 1.8, borderRadius: "14px",
            background: c.bg, border: `1px solid ${c.border}`, color: c.fg,
          }}>
            <CampaignOutlinedIcon sx={{ mt: 0.2 }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontWeight: 800, fontSize: 14 }}>{n.title}</Typography>
              {n.body && <Typography sx={{ fontSize: 13, mt: 0.3, whiteSpace: "pre-wrap" }}>{n.body}</Typography>}
            </Box>
            <Button size="small" onClick={() => dismiss(n.id)} sx={{ color: c.fg, fontWeight: 800, flexShrink: 0 }}>Entendi</Button>
          </Box>
        );
      })}
    </Box>
  );
}
