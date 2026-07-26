import React from "react";
import { createRoot } from "react-dom/client";
import "@tabler/icons-webfont/dist/tabler-icons.min.css";
import App from "./App.jsx";

// App.jsx es el portero: resuelve la sesión y decide entre login y tablero.
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
