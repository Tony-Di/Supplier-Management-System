import React from "react";
import { createRoot } from "react-dom/client";
import { AppDataProvider } from "./AppDataContext";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppDataProvider><App /></AppDataProvider>
  </React.StrictMode>,
);
