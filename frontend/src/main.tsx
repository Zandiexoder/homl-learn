import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { api, setUnauthorizedHandler } from "./lib/api";
import { Home } from "./pages/Home";
import { Login } from "./pages/Login";
import { NotebookPage } from "./pages/Notebook";
import { SettingsPage } from "./pages/Settings";
import { SharedPage } from "./pages/Shared";
import { VideoStudio } from "./pages/VideoStudio";
import "./styles.css";

type AuthStatus = { password_set: boolean; signed_in: boolean };

function App() {
  // Share links are public: render them before (and without) the sign-in gate.
  const location = useLocation();
  if (location.pathname.startsWith("/share/")) {
    return <Routes><Route path="/share/:token" element={<SharedPage />} /></Routes>;
  }
  return <PrivateApp />;
}

function PrivateApp() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const check = useCallback(() => api<AuthStatus>("/auth/status").then(setAuth), []);
  useEffect(() => {
    check();
    setUnauthorizedHandler(() => setAuth((a) => (a ? { ...a, signed_in: false } : a)));
  }, [check]);

  if (!auth) return null;
  if (!auth.signed_in) return <Login firstRun={!auth.password_set} onDone={check} />;
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/notebooks/:id" element={<NotebookPage />} />
      <Route path="/notebooks/:id/video/:artifactId" element={<VideoStudio />} />
    </Routes>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
