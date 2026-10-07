import ErrorBoundary from "../components/ErrorBoundary";
import ReceiptLongOutlinedIcon from "@mui/icons-material/ReceiptLongOutlined";
import RestaurantMenuIcon from "@mui/icons-material/RestaurantMenu";
import MapOutlinedIcon from "@mui/icons-material/MapOutlined";
import BarChartIcon from "@mui/icons-material/BarChart";
import AccountBalanceWalletOutlinedIcon from "@mui/icons-material/AccountBalanceWalletOutlined";
import GroupOutlinedIcon from "@mui/icons-material/GroupOutlined";
import HandymanOutlinedIcon from "@mui/icons-material/HandymanOutlined";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutlineOutlined";
import TuneIcon from "@mui/icons-material/Tune";
import PaletteOutlinedIcon from "@mui/icons-material/PaletteOutlined";
import useTab from "../hooks/useTab";
import AppShell from "../components/AppShell";
import { CollaboratorsTab, ServicesTab } from "./company/CollaboratorsAndServices";
import { MessagesTab } from "./company/MessagesTab";
import { OrdersTab } from "./company/OrdersTab";
import { MenuTab } from "./company/MenuTab";
import { LiveMapTab } from "./company/LiveMapTab";
import { DeliverySettingsTab } from "./company/DeliverySettingsTab";
import { BrandingTab } from "./company/BrandingTab";
import { ReportsTab } from "./company/ReportsTab";
import { FinanceTab } from "./company/FinanceTab";
import { useCompanySettings } from "../hooks/useCompanySettings";

// Menu lateral, agrupado do uso diário ao que quase nunca muda.
// Lanchonete não usa designações, integrações/API nem auditoria no menu
// (pedido do usuário, 07/10/2026); as telas continuam no código.
const TABS = [
  { key: "orders", label: "Pedidos", icon: <ReceiptLongOutlinedIcon />, group: "Operação" },
  { key: "live", label: "Mapa ao vivo", icon: <MapOutlinedIcon />, group: "Operação" },
  { key: "messages", label: "Mensagens", icon: <ChatBubbleOutlineIcon />, group: "Operação", unread: true },
  { key: "menu", label: "Cardápio", icon: <RestaurantMenuIcon />, group: "Loja" },
  { key: "delivery", label: "Ajustes de entrega", icon: <TuneIcon />, group: "Loja" },
  { key: "branding", label: "Marca", icon: <PaletteOutlinedIcon />, group: "Loja", feature: "feature_branding" },
  { key: "collaborators", label: "Colaboradores", icon: <GroupOutlinedIcon />, group: "Equipe" },
  { key: "services", label: "Serviços", icon: <HandymanOutlinedIcon />, group: "Equipe" },
  { key: "reports", label: "Relatórios", icon: <BarChartIcon />, group: "Gestão" },
  { key: "finance", label: "Financeiro", icon: <AccountBalanceWalletOutlinedIcon />, group: "Gestão" },
];

export default function CompanyAdmin() {
  const settings = useCompanySettings();
  // A aba de marca só aparece quando a plataforma liberou o recurso.
  const tabs = TABS.filter((t) => !t.feature || settings?.[t.feature]);
  const [tab, setTab] = useTab(tabs.map((t) => t.key), "orders");

  return (
    <AppShell title={tabs.find((t) => t.key === tab)?.label || "Painel da empresa"} nav={{ items: tabs, current: tab, onSelect: setTab }}>
      <ErrorBoundary inline key={tab}>
        {tab === "orders" && <OrdersTab />}
        {tab === "menu" && <MenuTab />}
        {tab === "live" && <LiveMapTab />}
        {tab === "reports" && <ReportsTab />}
        {tab === "finance" && <FinanceTab />}
        {tab === "delivery" && <DeliverySettingsTab />}
        {tab === "collaborators" && <CollaboratorsTab />}
        {tab === "services" && <ServicesTab />}
        {tab === "messages" && <MessagesTab />}
        {tab === "branding" && <BrandingTab />}
      </ErrorBoundary>
    </AppShell>
  );
}
