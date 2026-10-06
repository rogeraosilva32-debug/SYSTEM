import ErrorBoundary from "./components/ErrorBoundary";
import { lazy, Suspense, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import RoleRoute, { homeForCurrentUser } from "./components/RoleRoute";
import { passwordRecovery } from "./services/supabase";
import PageTransition from "./components/PageTransition";
import BrandLoader from "./components/BrandLoader";

import Welcome from "./pages/Welcome";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import Activate from "./pages/Activate";
// Telas de cada papel carregam sob demanda: o motoboy não precisa baixar o
// painel da plataforma (o app inteiro num arquivo só tinha 1,1 MB).
const PAGES = {
  platform: () => import("./pages/PlatformAdmin"),
  company: () => import("./pages/CompanyAdmin"),
  tasks: () => import("./pages/CollaboratorTasks"),
  deliveries: () => import("./pages/CourierDeliveries"),
  earnings: () => import("./pages/CourierEarnings"),
  chat: () => import("./pages/CollaboratorChat"),
  supervisor: () => import("./pages/SupervisorDashboard"),
};
const PlatformAdmin = lazy(PAGES.platform);
const CompanyAdmin = lazy(PAGES.company);
const CollaboratorTasks = lazy(PAGES.tasks);
const CourierDeliveries = lazy(PAGES.deliveries);
const CourierEarnings = lazy(PAGES.earnings);
const CollaboratorChat = lazy(PAGES.chat);
const SupervisorDashboard = lazy(PAGES.supervisor);

// Depois do login, baixa em segundo plano as telas do papel da pessoa: trocar
// de tela não espera download nem mostra tela vazia.
function usePrefetchPages() {
  const { profile, isPlatformAdmin, isCompanyAdmin, isSupervisor, isCollaborator } = useAuth();
  useEffect(() => {
    if (!profile) return undefined;
    const keys = isPlatformAdmin ? ["platform"] : isCompanyAdmin ? ["company"] : isSupervisor ? ["supervisor"]
      : isCollaborator ? ["deliveries", "tasks", "earnings", "chat"] : [];
    const run = () => keys.forEach((k) => PAGES[k]().catch(() => {}));
    const id = window.requestIdleCallback ? window.requestIdleCallback(run, { timeout: 3000 }) : setTimeout(run, 1500);
    return () => (window.cancelIdleCallback && window.requestIdleCallback ? window.cancelIdleCallback(id) : clearTimeout(id));
  }, [profile, isPlatformAdmin, isCompanyAdmin, isSupervisor, isCollaborator]);
}
const RatingPage = lazy(() => import("./pages/RatingPage"));
const KitchenDisplay = lazy(() => import("./pages/KitchenDisplay"));

function RootRoute() {
  const auth = useAuth();
  const { user, loading } = auth;
  if (loading) return <BrandLoader instant />;
  // Link de convite/recuperação que caiu na página inicial: primeiro cria a senha.
  if (user && (passwordRecovery.fromUrl || passwordRecovery.event)) return <Navigate to="/reset-password" replace />;
  if (!user) return <Navigate to="/welcome" replace />;
  return <Navigate to={homeForCurrentUser(auth)} replace />;
}

function AnimatedApp() {
  const location = useLocation();
  usePrefetchPages();

  // Sem esperar a tela anterior sumir: a nova entra por cima, rápido, como
  // num app (antes a tela "sumia e voltava" a cada troca).
  return (
    <AnimatePresence initial={false}>
      <PageTransition routeKey={location.pathname}>
        <Suspense fallback={<BrandLoader />}>
          <ErrorBoundary key={location.pathname}>
          <Routes location={location}>
            <Route path="/" element={<RootRoute />} />
            <Route path="/welcome" element={<Welcome />} />
            <Route path="/login" element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/avaliar/:token" element={<RatingPage />} />
            <Route path="/cozinha" element={<RoleRoute allow={["company_admin", "supervisor"]}><KitchenDisplay /></RoleRoute>} />
            <Route path="/cozinha/:token" element={<KitchenDisplay />} />

            <Route path="/ativar" element={<ProtectedRoute><Activate /></ProtectedRoute>} />

            <Route path="/plataforma" element={<RoleRoute allow={["platform"]}><PlatformAdmin /></RoleRoute>} />
            <Route path="/painel" element={<RoleRoute allow={["company_admin"]}><CompanyAdmin /></RoleRoute>} />
            <Route path="/supervisao" element={<RoleRoute allow={["supervisor"]}><SupervisorDashboard /></RoleRoute>} />
            <Route path="/entregas" element={<RoleRoute allow={["collaborator"]}><CourierDeliveries /></RoleRoute>} />
          <Route path="/tarefas" element={<RoleRoute allow={["collaborator"]}><CollaboratorTasks /></RoleRoute>} />
            <Route path="/ganhos" element={<RoleRoute allow={["collaborator"]}><CourierEarnings /></RoleRoute>} />
            <Route path="/mensagens" element={<RoleRoute allow={["collaborator"]}><CollaboratorChat /></RoleRoute>} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </ErrorBoundary>
        </Suspense>
      </PageTransition>
    </AnimatePresence>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AnimatedApp />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
