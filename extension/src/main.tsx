import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/app.css";

const embedded = new URLSearchParams(window.location.search).has("embedded");
if (embedded) document.documentElement.classList.add("embedded");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App embedded={embedded} />
  </StrictMode>,
);
