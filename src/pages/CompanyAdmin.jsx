import { useState } from "react";
import { Box } from "@mui/material";
import AppShell from "../components/AppShell";
import { CollaboratorsTab, ServicesTab } from "./company/CollaboratorsAndServices";
import { AssignmentsTab } from "./company/AssignmentsTab";
import { IntegrationsTab } from "./company/IntegrationsTab";
import { MessagesTab } from "./company/MessagesTab";
import AuditLogViewer from "../components/AuditLogViewer";
import { useAuth } from "../context/AuthContext";

const TABS = [
  { key: "collaborators", label: "Colaboradores" },
  { key: "services", label: "Serviços" },
  { key: "assignments", label: "Designações" },
  { key: "messages", label: "Mensagens" },
  { key: "integrations", label: "Integrações & API" },
  { key: "audit", label: "Auditoria" },
];

export default function CompanyAdmin() {
  const { companyId } = useAuth();
  const [tab, setTab] = useState("collaborators");

  return (
    <AppShell title="Painel da empresa">
      <Box sx={{ display: "flex", gap: 0.5, mb: 3, borderBottom: "1px solid #E7E5E4", overflowX: "auto" }}>
        {TABS.map((t) => (
          <Box
            key={t.key}
            onClick={() => setTab(t.key)}
            sx={{
              px: 2, py: 1.2, cursor: "pointer", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap",
              color: tab === t.key ? "#1C1917" : "#A8A29E",
              borderBottom: tab === t.key ? "2px solid #1C1917" : "2px solid transparent",
            }}
          >
            {t.label}
          </Box>
        ))}
      </Box>

      {tab === "collaborators" && <CollaboratorsTab />}
      {tab === "services" && <ServicesTab />}
      {tab === "assignments" && <AssignmentsTab />}
      {tab === "messages" && <MessagesTab />}
      {tab === "integrations" && <IntegrationsTab />}
      {tab === "audit" && <AuditLogViewer companyId={companyId} />}
    </AppShell>
  );
}
