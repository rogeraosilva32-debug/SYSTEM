import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import ProfileLoadFallback from "./ProfileLoadFallback";
import BrandLoader from "./BrandLoader";

// Guarda base: só exige estar logado. Não exige `activated` — quem ainda não
// resgatou uma chave de licença/convite passa por aqui normalmente e é
// redirecionado pra /ativar por este mesmo componente, exceto na própria
// página de ativação (senão vira um loop de redirecionamento).
export default function ProtectedRoute({ children }) {
  const { user, profile, loading, activated } = useAuth();
  const location = useLocation();

  if (loading) return <BrandLoader instant />;

  if (!user) return <Navigate to="/login" replace />;

  // Perfil ainda carregando (ou falhou e está tentando de novo sozinho) —
  // mostra um spinner e, se demorar demais, um jeito de tentar de novo, em
  // vez de simplesmente não renderizar nada pra sempre.
  if (!profile) return <ProfileLoadFallback />;

  if (!activated && location.pathname !== "/ativar") {
    return <Navigate to="/ativar" replace />;
  }

  return children;
}
