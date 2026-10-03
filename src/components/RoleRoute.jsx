import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import ProfileLoadFallback from "./ProfileLoadFallback";

const HOME_BY_ROLE = { platform: "/plataforma", company_admin: "/painel", collaborator: "/entregas", supervisor: "/supervisao" };

function homeForCurrentUser({ isPlatformAdmin, isCompanyAdmin, isCollaborator, isSupervisor }) {
  if (isPlatformAdmin) return HOME_BY_ROLE.platform;
  if (isCompanyAdmin) return HOME_BY_ROLE.company_admin;
  if (isSupervisor) return HOME_BY_ROLE.supervisor;
  if (isCollaborator) return HOME_BY_ROLE.collaborator;
  return "/ativar";
}

// `allow` é um array com os papéis que podem ver esta rota:
// "platform" | "company_admin" | "collaborator" | "supervisor"
export default function RoleRoute({ allow, children }) {
  const auth = useAuth();
  const { user, profile, loading, activated } = auth;

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile) return <ProfileLoadFallback />;
  if (!activated) return <Navigate to="/ativar" replace />;

  const roleChecks = {
    platform: auth.isPlatformAdmin,
    company_admin: auth.isCompanyAdmin,
    collaborator: auth.isCollaborator,
    supervisor: auth.isSupervisor,
  };

  const permitted = allow.some((role) => roleChecks[role]);
  if (!permitted) return <Navigate to={homeForCurrentUser(auth)} replace />;

  return children;
}

// Exportar uma função junto do componente só afeta o hot reload em dev.
// eslint-disable-next-line react-refresh/only-export-components
export { homeForCurrentUser };
