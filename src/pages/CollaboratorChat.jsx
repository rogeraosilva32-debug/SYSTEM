import AppShell from "../components/AppShell";
import ChatPanel from "../components/ChatPanel";
import { useAuth } from "../context/AuthContext";

export default function CollaboratorChat() {
  const { profile } = useAuth();

  return (
    <AppShell title="Mensagens">
      <ChatPanel
        collaboratorId={profile.id}
        companyId={profile.company_id}
        roomLabel="Conversa com a empresa"
      />
    </AppShell>
  );
}
