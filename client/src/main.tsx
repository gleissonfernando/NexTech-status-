import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import { App } from "./App";

class StatusErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="app-shell">
          <header className="topbar">
            <a className="brand" href="/" aria-label="NextTech Status">
              <span className="brand-mark">NT</span>
              <span>
                <strong>Status de Serviço - NextTech</strong>
              </span>
            </a>
          </header>
          <section className="status-hero critical">
            <span className="status-badge critical">ERRO</span>
            <strong>Falha ao carregar o painel em tempo real.</strong>
          </section>
          <p className="status-copy">Atualize a página para reconectar ao monitoramento.</p>
        </main>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <StatusErrorBoundary>
      <App />
    </StatusErrorBoundary>
  </React.StrictMode>
);
