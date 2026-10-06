import { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, Button, TextField, Dialog, DialogTitle, DialogContent, DialogActions,
  Table, TableHead, TableRow, TableCell, TableBody, Chip, IconButton, CircularProgress,
  Tooltip, Switch, FormControlLabel, Alert,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import RefreshIcon from "@mui/icons-material/Refresh";
import CloseIcon from "@mui/icons-material/Close";
import supabase from "../services/supabase";
import AppShell from "../components/AppShell";
import RouteMap from "../components/RouteMap";
import AuditLogViewer from "../components/AuditLogViewer";
import InfoField from "../components/InfoField";
import CollapsibleSection from "../components/CollapsibleSection";
import { generateCode } from "../utils/codeGenerator";
import { LicenseUsage, InvoicesTab, CompanyBilling } from "./platform/PlatformBilling";
import { ReportsTab } from "./company/ReportsTab";
import SystemLog from "./platform/SystemLog";
import PlatformOverview from "./platform/PlatformOverview";
import useTab from "../hooks/useTab";
import SpaceDashboardOutlinedIcon from "@mui/icons-material/SpaceDashboardOutlined";
import BusinessOutlinedIcon from "@mui/icons-material/BusinessOutlined";
import PieChartOutlineIcon from "@mui/icons-material/PieChartOutlined";
import ReceiptOutlinedIcon from "@mui/icons-material/ReceiptOutlined";
import TerminalIcon from "@mui/icons-material/Terminal";
import WorkspacesOutlinedIcon from "@mui/icons-material/WorkspacesOutlined";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import PlatformPlans, { PlanPicker } from "./platform/PlatformPlans";
import PlatformNoticesAdmin from "./platform/PlatformNoticesAdmin";
import PageLoading from "../components/PageLoading";

function copyToClipboard(text) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

function NewCompanyDialog({ open, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [seats, setSeats] = useState(5);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleCreate = async () => {
    if (!name.trim()) { setError("Informe o nome da empresa."); return; }
    setSaving(true);
    setError("");
    const { data, error: insertError } = await supabase
      .from("companies")
      .insert({
        name: name.trim(),
        seats_limit: Number(seats) || 1,
        license_key: generateCode(),
        collaborator_invite_code: generateCode(),
      })
      .select("*")
      .single();
    setSaving(false);
    if (insertError) { setError(insertError.message); return; }
    setName(""); setSeats(5);
    onCreated(data);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>Nova empresa</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
        <TextField
          label="Nome da empresa" value={name} fullWidth
          onChange={(e) => { setName(e.target.value); setError(""); }}
          error={!!error} helperText={error}
        />
        <TextField
          label="Limite de colaboradores" type="number" value={seats} fullWidth
          onChange={(e) => setSeats(e.target.value)}
          inputProps={{ min: 1 }}
        />
      </DialogContent>
      <DialogActions sx={{ p: 2.5, pt: 0 }}>
        <Button onClick={onClose} sx={{ color: "#78716C" }}>Cancelar</Button>
        <Button onClick={handleCreate} disabled={saving} variant="contained">
          {saving ? <CircularProgress size={18} sx={{ color: "#fff" }} /> : "Criar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CompanyDetail({ company, onBack, onUpdated }) {
  const [tab, setTab] = useState("collaborators");
  const [collaborators, setCollaborators] = useState(null);
  const [services, setServices] = useState(null);
  const [assignments, setAssignments] = useState(null);
  const [seatsInput, setSeatsInput] = useState(company.seats_limit);
  const [savingSeats, setSavingSeats] = useState(false);
  const [detail, setDetail] = useState(null);
  // Qual ação está rodando (desabilita os botões) e erro da última ação.
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState("");
  const { startSupport } = useAuth();
  const navigate = useNavigate();

  // Abre o painel da empresa como o gestor dela vê, só para olhar.
  const viewAsCompany = async () => {
    setBusy("support");
    try {
      await startSupport(company);
      navigate("/painel");
    } catch (err) {
      setActionError(err?.message || "Não foi possível abrir o modo suporte.");
      setBusy(null);
    }
  };

  const load = useCallback(async () => {
    const [c, s, a] = await Promise.all([
      supabase.from("profiles").select("*").eq("company_id", company.id).eq("company_role", "collaborator"),
      supabase.from("services").select("*").eq("company_id", company.id),
      supabase.from("assignments").select("*, service:service_id(name), collaborator:collaborator_id(name)").eq("company_id", company.id).order("scheduled_start", { ascending: false }).limit(50),
    ]);
    setCollaborators(c.data || []);
    setServices(s.data || []);
    setAssignments(a.data || []);
  }, [company.id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  // Atualiza a empresa mostrando o erro (se houver) e bloqueando cliques repetidos.
  const updateCompany = async (action, patch) => {
    if (busy) return;
    setBusy(action);
    setActionError("");
    try {
      const { data, error } = await supabase.from("companies").update(patch).eq("id", company.id).select("*").single();
      if (error) setActionError(error.message);
      else onUpdated(data);
    } catch (err) {
      setActionError(err?.message || "Falha ao salvar.");
    } finally {
      setBusy(null);
    }
  };

  const toggleStatus = () => {
    const nextStatus = company.status === "active" ? "suspended" : "active";
    return updateCompany("status", { status: nextStatus });
  };

  const saveSeats = async () => {
    setSavingSeats(true);
    await updateCompany("seats", { seats_limit: Number(seatsInput) || 1 });
    setSavingSeats(false);
  };

  // Recursos que só a plataforma libera, por empresa.
  const toggleFeature = (column, value) => updateCompany(column, { [column]: value });

  const regenerateInvite = () => updateCompany("invite", { collaborator_invite_code: generateCode() });

  const regenerateLicenseKey = () => {
    if (!window.confirm("Trocar a chave de licença desta empresa? A chave atual deixa de funcionar.")) return;
    return updateCompany("license", { license_key: generateCode() });
  };

  return (
    <Box>
      <Button startIcon={<ArrowBackIcon />} onClick={onBack} sx={{ color: "#57534E", mb: 2, textTransform: "none", fontWeight: 700 }}>
        Todas as empresas
      </Button>

      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 2, mb: 3 }}>
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: 22, color: "#1C1917" }}>{company.name}</Typography>
          <Chip
            label={company.status === "active" ? "Ativa" : "Suspensa"} size="small"
            sx={{
              mt: 0.5, height: 22, fontSize: 11, fontWeight: 700,
              background: company.status === "active" ? "#EEF3EF" : "#F6EBEA",
              color: company.status === "active" ? "#4B7A5E" : "#B0463D",
            }}
          />
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
          <Tooltip title="Abre o painel desta empresa como o gestor vê. Só leitura: nada pode ser alterado.">
            <span>
              <Button variant="outlined" startIcon={<VisibilityOutlinedIcon />} onClick={viewAsCompany} disabled={!!busy}>
                Ver como empresa
              </Button>
            </span>
          </Tooltip>
          <FormControlLabel
            control={<Switch checked={company.status === "active"} onChange={toggleStatus} disabled={!!busy} />}
            label={<Typography sx={{ fontSize: 13, fontWeight: 600, color: "#57534E" }}>Empresa ativa</Typography>}
          />
        </Box>
      </Box>

      {actionError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError("")}>{actionError}</Alert>}

      <CollapsibleSection id="plataforma-licenca" title="Licença, convite e vagas"
        summary={`${collaborators?.length ?? "…"} de ${company.seats_limit} vagas usadas · chave ${company.license_key}`}>
      <PlanPicker key={company.plan_id || "sem"} company={company} onApplied={onUpdated} disabled={!!busy} />
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2, mb: 2 }}>
        <Box sx={{ border: "1px solid #E7E5E4", borderRadius: "14px", p: 2.5, background: "#fff" }}>
          <Typography sx={{ fontSize: 12, fontWeight: 700, color: "#78716C", mb: 1 }}>CHAVE DE LICENÇA</Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography sx={{ fontFamily: "monospace", fontSize: 15, fontWeight: 700 }}>{company.license_key}</Typography>
            <Tooltip title="Copiar">
              <IconButton size="small" onClick={() => copyToClipboard(company.license_key)}><ContentCopyIcon sx={{ fontSize: 15 }} /></IconButton>
            </Tooltip>
            <Tooltip title="Trocar chave de licença">
              <span>
                <IconButton size="small" onClick={regenerateLicenseKey} disabled={!!busy}>
                  {busy === "license" ? <CircularProgress size={14} /> : <RefreshIcon sx={{ fontSize: 15 }} />}
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </Box>
        <Box sx={{ border: "1px solid #E7E5E4", borderRadius: "14px", p: 2.5, background: "#fff" }}>
          <Typography sx={{ fontSize: 12, fontWeight: 700, color: "#78716C", mb: 1 }}>CÓDIGO DE CONVITE (COLABORADORES)</Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography sx={{ fontFamily: "monospace", fontSize: 15, fontWeight: 700 }}>{company.collaborator_invite_code}</Typography>
            <Tooltip title="Copiar">
              <IconButton size="small" onClick={() => copyToClipboard(company.collaborator_invite_code)}><ContentCopyIcon sx={{ fontSize: 15 }} /></IconButton>
            </Tooltip>
            <Tooltip title="Gerar novo código">
              <span>
                <IconButton size="small" onClick={regenerateInvite} disabled={!!busy}>
                  {busy === "invite" ? <CircularProgress size={14} /> : <RefreshIcon sx={{ fontSize: 15 }} />}
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </Box>
      </Box>

      <Box sx={{ display: "flex", alignItems: "flex-end", gap: 1.5 }}>
        <TextField
          label="Limite de colaboradores" type="number" size="small"
          value={seatsInput} onChange={(e) => setSeatsInput(e.target.value)}
          sx={{ width: 200 }}
        />
        <Button onClick={saveSeats} disabled={savingSeats || !!busy} variant="outlined" sx={{ height: 40 }}>
          {savingSeats ? <CircularProgress size={16} /> : "Salvar"}
        </Button>
        <Typography sx={{ fontSize: 12.5, color: "#78716C", ml: 1 }}>
          {collaborators?.length ?? "…"} de {company.seats_limit} vagas usadas
        </Typography>
      </Box>
      </CollapsibleSection>

      <CollapsibleSection id="plataforma-recursos" title="Recursos liberados para esta empresa"
        summary={`Código de entrega ${company.feature_delivery_code ? "liberado" : "não liberado"} · marca própria ${company.feature_branding ? "liberada" : "não liberada"}`}>
        {[
          { column: "feature_delivery_code", label: "Código de finalização de entrega", help: "A empresa envia um código ao cliente por WhatsApp; o motoboy só finaliza a entrega com ele." },
          { column: "feature_branding", label: "Marca própria", help: "A empresa envia logo, ícone, imagens e cor para o sistema aparecer com a marca dela." },
        ].map((f) => (
          <Box key={f.column} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, py: 0.8 }}>
            <Box>
              <Typography sx={{ fontWeight: 700, fontSize: 14 }}>{f.label}</Typography>
              <Typography sx={{ fontSize: 12.5, color: "#78716C" }}>{f.help}</Typography>
            </Box>
            <Switch checked={Boolean(company[f.column])} onChange={(e) => toggleFeature(f.column, e.target.checked)} disabled={!!busy} />
          </Box>
        ))}
      </CollapsibleSection>

      <CompanyBilling key={company.id} company={company} onUpdated={onUpdated} />


      <Box sx={{ display: "flex", gap: 0.5, mb: 2, borderBottom: "1px solid #E7E5E4", overflowX: "auto" }}>
        {[
          { key: "collaborators", label: `Colaboradores (${collaborators?.length ?? "…"})` },
          { key: "services", label: `Serviços (${services?.length ?? "…"})` },
          { key: "assignments", label: `Designações (${assignments?.length ?? "…"})` },
          { key: "reports", label: "Relatórios" },
          { key: "log", label: "Log" },
          { key: "audit", label: "Auditoria" },
        ].map((t) => (
          <Box key={t.key} onClick={() => setTab(t.key)} sx={{
            px: 2, py: 1.2, cursor: "pointer", fontSize: 13, fontWeight: 700,
            color: tab === t.key ? "#1C1917" : "#A8A29E",
            borderBottom: tab === t.key ? "2px solid #1C1917" : "2px solid transparent",
          }}>
            {t.label}
          </Box>
        ))}
      </Box>

      {tab === "collaborators" && (
        <Table size="small">
          <TableHead><TableRow><TableCell>Nome</TableCell><TableCell>E-mail</TableCell><TableCell>Telefone</TableCell></TableRow></TableHead>
          <TableBody>
            {(collaborators || []).map((c) => (
              <TableRow key={c.id}><TableCell>{c.name}</TableCell><TableCell>{c.email}</TableCell><TableCell>{c.phone || "—"}</TableCell></TableRow>
            ))}
            {collaborators?.length === 0 && <TableRow><TableCell colSpan={3} sx={{ color: "#A8A29E", textAlign: "center", py: 3 }}>Nenhum colaborador ainda.</TableCell></TableRow>}
          </TableBody>
        </Table>
      )}

      {tab === "services" && (
        <Table size="small">
          <TableHead><TableRow><TableCell>Nome</TableCell><TableCell>Duração padrão</TableCell><TableCell>Preço</TableCell></TableRow></TableHead>
          <TableBody>
            {(services || []).map((s) => (
              <TableRow key={s.id}><TableCell>{s.name}</TableCell><TableCell>{s.default_duration_minutes} min</TableCell><TableCell>{s.price ? `R$ ${Number(s.price).toFixed(2)}` : "—"}</TableCell></TableRow>
            ))}
            {services?.length === 0 && <TableRow><TableCell colSpan={3} sx={{ color: "#A8A29E", textAlign: "center", py: 3 }}>Nenhum serviço cadastrado ainda.</TableCell></TableRow>}
          </TableBody>
        </Table>
      )}

      {tab === "assignments" && (
        <Table size="small">
          <TableHead><TableRow><TableCell>Serviço</TableCell><TableCell>Início</TableCell><TableCell>Status</TableCell></TableRow></TableHead>
          <TableBody>
            {(assignments || []).map((a) => (
              <TableRow key={a.id} hover onClick={() => setDetail(a)} sx={{ cursor: "pointer" }}>
                <TableCell>{a.service?.name || "—"}</TableCell>
                <TableCell>{new Date(a.scheduled_start).toLocaleString("pt-BR")}</TableCell>
                <TableCell>{a.status}</TableCell>
              </TableRow>
            ))}
            {assignments?.length === 0 && <TableRow><TableCell colSpan={3} sx={{ color: "#A8A29E", textAlign: "center", py: 3 }}>Nenhuma designação ainda.</TableCell></TableRow>}
          </TableBody>
        </Table>
      )}

      {tab === "reports" && <ReportsTab companyId={company.id} />}
      {tab === "log" && <SystemLog companyId={company.id} />}
      {tab === "audit" && <AuditLogViewer companyId={company.id} />}

      <Dialog open={!!detail} onClose={() => setDetail(null)} maxWidth="sm" fullWidth>
        {detail && (
          <>
            <DialogTitle sx={{ fontWeight: 800, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              {detail.service?.name}
              <IconButton onClick={() => setDetail(null)} size="small"><CloseIcon fontSize="small" /></IconButton>
            </DialogTitle>
            <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
                <InfoField label="Colaborador" value={detail.collaborator?.name || "—"} />
                <InfoField label="Cliente" value={detail.customer_name || "Não informado"} />
                <InfoField label="Início" value={new Date(detail.scheduled_start).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })} />
                <InfoField label="Duração" value={`${detail.duration_minutes} min`} />
              </Box>
              <RouteMap
                lat={detail.lat} lng={detail.lng}
                address={[detail.address_street, detail.address_neighborhood, detail.address_city].filter(Boolean).join(", ")}
                trackCollaboratorId={detail.status === "in_progress" ? detail.collaborator_id : null}
              />
              {detail.notes && <Typography sx={{ fontSize: 12.5, color: "#78716C", fontStyle: "italic" }}>{detail.notes}</Typography>}
            </DialogContent>
          </>
        )}
      </Dialog>
    </Box>
  );
}

const VIEWS = [
  { key: "overview", label: "Visão geral", icon: <SpaceDashboardOutlinedIcon /> },
  { key: "companies", label: "Empresas", icon: <BusinessOutlinedIcon /> },
  { key: "plans", label: "Planos", icon: <WorkspacesOutlinedIcon /> },
  { key: "notices", label: "Avisos", icon: <CampaignOutlinedIcon /> },
  { key: "usage", label: "Uso de licenças", icon: <PieChartOutlineIcon /> },
  { key: "invoices", label: "Faturas", icon: <ReceiptOutlinedIcon /> },
  { key: "log", label: "Log do sistema", icon: <TerminalIcon /> },
];

export default function PlatformAdmin() {
  const [companies, setCompanies] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [view, setViewRaw] = useTab(VIEWS.map((v) => v.key), "overview");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [alertCount, setAlertCount] = useState(0);
  const navItems = VIEWS.map((v) => (v.key === "overview" ? { ...v, badge: alertCount } : v));

  // Número no menu: alertas abertos que ninguém marcou como vistos.
  useEffect(() => {
    let cancelled = false;
    const count = () => supabase.rpc("platform_alerts_list").then(({ data, error }) => {
      if (!cancelled && !error) setAlertCount((data || []).filter((a) => !a.seen_at).length);
    });
    count();
    const t = setInterval(() => { if (!document.hidden) count(); }, 60000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const load = useCallback(async () => {
    // Com o nome do plano; sem o script novo no banco, carrega sem ele.
    let { data, error } = await supabase.from("companies").select("*, plan:plan_id(name)").order("created_at", { ascending: false });
    if (error) ({ data } = await supabase.from("companies").select("*").order("created_at", { ascending: false }));
    setCompanies(data || []);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const handleUpdated = (updated) => {
    setSelected((prev) => ({ ...prev, ...updated }));
    setCompanies((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
  };
  const setView = (key) => { setSelected(null); setViewRaw(key); };
  const openCompany = (id) => { const c = companies?.find((x) => x.id === id); if (c) { setViewRaw("companies"); setSelected(c); } };

  const q = search.trim().toLowerCase();
  const shown = (companies || []).filter((c) => (statusFilter === "all" || c.status === statusFilter)
    && (!q || c.name.toLowerCase().includes(q) || (c.license_key || "").toLowerCase().includes(q)));

  return (
    <AppShell
      title={selected ? selected.name : VIEWS.find((v) => v.key === view)?.label}
      nav={{ items: navItems, current: view, onSelect: setView }}
      actions={!selected && view === "companies" && (
        <Button startIcon={<AddIcon />} variant="contained" onClick={() => setDialogOpen(true)} sx={{ borderRadius: "10px" }}>
          Nova empresa
        </Button>
      )}
    >
      {!selected && view === "overview" ? (
        <PlatformOverview onOpenCompany={openCompany} onOpenLog={() => setView("log")} onAlertCount={setAlertCount} />
      ) : !selected && view === "plans" ? (
        <PlatformPlans />
      ) : !selected && view === "notices" ? (
        <PlatformNoticesAdmin companies={companies || []} />
      ) : !selected && view === "usage" ? (
        <LicenseUsage onOpenCompany={openCompany} />
      ) : !selected && view === "invoices" ? (
        <InvoicesTab />
      ) : !selected && view === "log" ? (
        <SystemLog />
      ) : selected ? (
        <CompanyDetail company={selected} onBack={() => setSelected(null)} onUpdated={handleUpdated} />
      ) : companies === null ? (
        <PageLoading />
      ) : companies.length === 0 ? (
        <Box sx={{ py: 8, textAlign: "center", color: "#A8A29E", fontSize: 14 }}>
          Nenhuma empresa cadastrada ainda. Clique em "Nova empresa" pra começar.
        </Box>
      ) : (
        <>
          <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap", alignItems: "center" }}>
            <TextField size="small" placeholder="Buscar empresa ou chave" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ minWidth: 240, flex: { xs: 1, sm: "none" } }} />
            {[["all", "Todas"], ["active", "Ativas"], ["suspended", "Suspensas"]].map(([k, label]) => (
              <Chip key={k} label={label} onClick={() => setStatusFilter(k)} color={statusFilter === k ? "primary" : "default"} variant={statusFilter === k ? "filled" : "outlined"} />
            ))}
          </Box>
          {shown.length === 0 && <Typography sx={{ fontSize: 13, color: "#A8A29E", py: 3 }}>Nenhuma empresa com esse filtro.</Typography>}
          <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Empresa</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Plano</TableCell>
              <TableCell>Vagas</TableCell>
              <TableCell>Criada em</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.map((c) => (
              <TableRow key={c.id} hover onClick={() => setSelected(c)} sx={{ cursor: "pointer" }}>
                <TableCell sx={{ fontWeight: 600 }}>{c.name}</TableCell>
                <TableCell>
                  <Chip
                    label={c.status === "active" ? "Ativa" : "Suspensa"} size="small"
                    sx={{
                      height: 22, fontSize: 11, fontWeight: 700,
                      background: c.status === "active" ? "#EEF3EF" : "#F6EBEA",
                      color: c.status === "active" ? "#4B7A5E" : "#B0463D",
                    }}
                  />
                </TableCell>
                <TableCell>{c.plan?.name || "—"}</TableCell>
                <TableCell>{c.seats_limit}</TableCell>
                <TableCell>{new Date(c.created_at).toLocaleDateString("pt-BR")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </>
      )}

      <NewCompanyDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onCreated={(c) => setCompanies((prev) => [c, ...prev])} />
    </AppShell>
  );
}
