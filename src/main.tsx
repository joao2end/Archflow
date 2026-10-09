import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter-tight/400.css";
import "@fontsource/inter-tight/500.css";
import "@fontsource/inter-tight/600.css";
import "@fontsource/inter-tight/700.css";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "./styles.css";
import "./landing/landing.css";
import App from "./App";
import Landing from "./landing/Landing";
import { applyTheme } from "./ui/store";

applyTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {location.pathname.startsWith("/app") ? <App /> : <Landing />}
  </StrictMode>,
);
