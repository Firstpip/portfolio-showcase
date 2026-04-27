import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

function App() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface text-text">
      <div className="text-center px-6">
        <h1 className="text-2xl font-bold mb-2">Demo runtime ready</h1>
        <p className="text-sm opacity-70">
          이 화면은 빈 runtime 입니다. 데모 생성 시 src/ 가 LLM 으로 교체됩니다.
        </p>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
