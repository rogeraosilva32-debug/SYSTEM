import { Component } from "react";
import { logError } from "../services/eventLog";

// Sem isso, QUALQUER erro não tratado durante a renderização de qualquer tela
// (um campo inesperado vindo do banco, uma resposta de rede em formato
// diferente do esperado, etc.) derruba a árvore inteira do React e deixa a
// página em branco, sem nenhuma indicação do que aconteceu nem jeito de se
// recuperar sem fechar e abrir o app de novo. Este componente é a rede de
// segurança: captura o erro, mostra uma tela explicando o que houve e um
// botão pra recarregar, em vez de simplesmente sumir.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Fica só no console por enquanto — se um serviço de monitoramento de
    // erros (Sentry ou similar) for adicionado no futuro, é aqui que entra.
    console.error("Erro não tratado capturado pelo ErrorBoundary:", error, info?.componentStack);
    logError(error, { action: "screen_crash", details: { componente: String(info?.componentStack || "").slice(0, 800) } });
    // Depois de uma nova versão no ar, a tela aberta pode pedir um arquivo
    // que não existe mais: recarrega uma vez sozinho para pegar a versão nova.
    if (/Loading chunk|dynamically imported module|Importing a module script failed/i.test(error?.message || "")) {
      try {
        if (!sessionStorage.getItem("chunk-reload")) {
          sessionStorage.setItem("chunk-reload", "1");
          window.location.reload();
        }
      } catch { /* sem sessionStorage: mostra a tela de erro */ }
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    // `inline`: erro numa aba mostra o aviso só ali; o resto do painel continua.
    if (this.state.error && this.props.inline) {
      return (
        <div style={{ padding: 24, border: "1px solid #E7E5E4", borderRadius: 14, background: "#fff", textAlign: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6 }}>Esta parte encontrou um erro</div>
          <div style={{ fontSize: 13, color: "#78716C", marginBottom: 14 }}>As outras abas continuam funcionando.</div>
          <button onClick={() => this.setState({ error: null })}
            style={{ background: "#1C1917", color: "#fff", border: "none", borderRadius: 10, padding: "8px 18px", fontWeight: 700, cursor: "pointer", marginRight: 8 }}>
            Tentar de novo
          </button>
          <button onClick={this.handleReload}
            style={{ background: "#fff", color: "#1C1917", border: "1px solid #D6D3D1", borderRadius: 10, padding: "8px 18px", fontWeight: 700, cursor: "pointer" }}>
            Recarregar
          </button>
        </div>
      );
    }
    if (this.state.error) {
      return (
        <div style={{
          minHeight: "100vh", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", textAlign: "center",
          padding: "24px", fontFamily: "system-ui, sans-serif", background: "#f0f2f8",
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>😕</div>
          <div style={{ fontWeight: 800, fontSize: 18, color: "#0f172a", marginBottom: 6 }}>
            Algo deu errado
          </div>
          <div style={{ fontSize: 14, color: "#64748b", marginBottom: 20, maxWidth: 320 }}>
            A página encontrou um erro inesperado. Recarregar costuma resolver.
          </div>
          <button
            onClick={this.handleReload}
            style={{
              background: "linear-gradient(135deg,#0f3460,#1a56db)", color: "#fff",
              border: "none", borderRadius: 12, padding: "12px 24px",
              fontWeight: 700, fontSize: 14, cursor: "pointer",
            }}
          >
            Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
