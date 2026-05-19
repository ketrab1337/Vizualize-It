import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./index.css";

// Pokaż każdy uncaught błąd JS zamiast ciemnego ekranu
window.onerror = (_msg, _src, _line, _col, err) => {
  document.body.style.cssText = "background:#0f0f0f;color:#f87171;font-family:monospace;padding:24px;margin:0";
  document.body.innerHTML = `<h2 style="color:#f87171;margin:0 0 12px">Błąd JS (window.onerror)</h2><pre style="white-space:pre-wrap;font-size:12px">${err?.stack ?? String(_msg)}</pre>`;
};
window.onunhandledrejection = (e) => {
  document.body.style.cssText = "background:#0f0f0f;color:#f87171;font-family:monospace;padding:24px;margin:0";
  document.body.innerHTML = `<h2 style="color:#f87171;margin:0 0 12px">Unhandled Promise rejection</h2><pre style="white-space:pre-wrap;font-size:12px">${e.reason?.stack ?? String(e.reason)}</pre>`;
};

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, color: "#f87171", fontFamily: "monospace", background: "#0f0f0f", height: "100vh" }}>
          <h2 style={{ marginBottom: 12 }}>Błąd uruchamiania aplikacji</h2>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{this.state.error.message}</pre>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, color: "#6b7280", marginTop: 8 }}>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
