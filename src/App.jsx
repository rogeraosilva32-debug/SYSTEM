import { useLocation } from "react-router-dom";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import RoleRoute, { homeForCurrentUser } from "./components/RoleRoute";
import PageTransition from "./components/PageTransition";

import Welcome from "./pages/Welcome";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import Activate from "./pages/Activate";
import PlatformAdmin from "./pages/PlatformAdmin";
import CompanyAdmin from "./pages/CompanyAdmin";
import CollaboratorTasks from "./pages/CollaboratorTasks";
import CollaboratorChat from "./pages/CollaboratorChat";
import SupervisorDashboard from "./pages/SupervisorDashboard";
import RatingPage from "./pages/RatingPage";

function RootRoute() {
  const auth = useAuth();
  const { user, loading } = auth;
  if (loading) return null;
  if (!user) return <Navigate to="/welcome" replace />;
  return <Navigate to={homeForCurrentUser(auth)} replace />;
}

function AnimatedApp() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <PageTransition routeKey={location.pathname}>
        <Routes location={location}>
          <Route path="/" element={<RootRoute />} />
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/avaliar/:token" element={<RatingPage />} />

          <Route path="/ativar" element={<ProtectedRoute><Activate /></ProtectedRoute>} />

          <Route path="/plataforma" element={<RoleRoute allow={["platform"]}><PlatformAdmin /></RoleRoute>} />
          <Route path="/painel" element={<RoleRoute allow={["company_admin"]}><CompanyAdmin /></RoleRoute>} />
          <Route path="/supervisao" element={<RoleRoute allow={["supervisor"]}><SupervisorDashboard /></RoleRoute>} />
          <Route path="/tarefas" element={<RoleRoute allow={["collaborator"]}><CollaboratorTasks /></RoleRoute>} />
          <Route path="/mensagens" element={<RoleRoute allow={["collaborator"]}><CollaboratorChat /></RoleRoute>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
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
