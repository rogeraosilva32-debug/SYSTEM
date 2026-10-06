import ErrorBoundary from "./components/ErrorBoundary";
import { lazy, Suspense } from "react";
import { useLocation } from "react-router-dom";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import RoleRoute, { homeForCurrentUser } from "./components/RoleRoute";
import { passwordRecovery } from "./services/supabase";
import PageTransition from "./components/PageTransition";

import Welcome from "./pages/Welcome";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import Activate from "./pages/Activate";
// Telas de cada papel carregam sob demanda: o motoboy não precisa baixar o
// painel da plataforma (o app inteiro num arquivo só tinha 1,1 MB).
const PlatformAdmin = lazy(() => import("./pages/PlatformAdmin"));
const CompanyAdmin = lazy(() => import("./pages/CompanyAdmin"));
const CollaboratorTasks = lazy(() => import("./pages/CollaboratorTasks"));
const CourierDeliveries = lazy(() => import("./pages/CourierDeliveries"));
const CourierEarnings = lazy(() => import("./pages/CourierEarnings"));
const CollaboratorChat = lazy(() => import("./pages/CollaboratorChat"));
const SupervisorDashboard = lazy(() => import("./pages/SupervisorDashboard"));
const RatingPage = lazy(() => import("./pages/RatingPage"));
const KitchenDisplay = lazy(() => import("./pages/KitchenDisplay"));

function RootRoute() {
  const auth = useAuth();
  const { user, loading } = auth;
  if (loading) return null;
  // Link de convite/recuperação que caiu na página inicial: primeiro cria a senha.
  if (user && (passwordRecovery.fromUrl || passwordRecovery.event)) return <Navigate to="/reset-password" replace />;
  if (!user) return <Navigate to="/welcome" replace />;
  return <Navigate to={homeForCurrentUser(auth)} replace />;
}

function AnimatedApp() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <PageTransition routeKey={location.pathname}>
        <Suspense fallback={null}>
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
