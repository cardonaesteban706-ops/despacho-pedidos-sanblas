import React from "react";
import { createRoot } from "react-dom/client";
import "@tabler/icons-webfont/dist/tabler-icons.min.css";
import DespachoPedidos from "./DespachoPedidos.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <DespachoPedidos />
  </React.StrictMode>
);
