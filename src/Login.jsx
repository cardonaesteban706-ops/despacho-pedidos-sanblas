import { useState } from "react";
import { entrar } from "./supabaseClient";

// Pantalla de entrada. Se ve UNA vez por dispositivo: la sesión queda guardada
// en el navegador y se renueva sola (ver la config de auth en supabaseClient.js).
// No hay registro ni "olvidé mi clave" a propósito: el usuario se crea a mano
// en el panel de Supabase, no se autogestiona.
export default function Login() {
  const [correo, setCorreo] = useState("");
  const [clave, setClave] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  const enviar = async (e) => {
    if (e) e.preventDefault();
    if (cargando) return;
    if (!correo.trim() || !clave) {
      setError("Escribe el correo y la clave.");
      return;
    }
    setCargando(true);
    setError("");
    try {
      await entrar(correo, clave);
      // No hace falta hacer nada más: alCambiarSesion() en App.jsx recibe la
      // sesión nueva y cambia la pantalla.
    } catch (err) {
      // Los mensajes de Supabase vienen en inglés; los traducimos a algo que
      // sirva en el mostrador.
      const msg = String((err && err.message) || "");
      if (/Invalid login credentials/i.test(msg)) setError("Correo o clave incorrectos.");
      else if (/Email not confirmed/i.test(msg)) setError("El usuario está sin confirmar. Confírmalo en Supabase.");
      else if (/network|fetch/i.test(msg)) setError("Sin conexión a internet. Revisa la señal e inténtalo otra vez.");
      else setError("No se pudo entrar. " + msg);
      setCargando(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <form
        onSubmit={enviar}
        style={{
          width: "100%",
          maxWidth: 360,
          background: "var(--color-background-primary)",
          border: "0.5px solid var(--color-border-secondary)",
          borderRadius: "var(--border-radius-lg)",
          padding: "28px 24px",
          boxShadow: "0 1px 3px rgba(4,44,83,.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: "var(--border-radius-md)",
              background: "#0C447C",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <i className="ti ti-building-warehouse" style={{ fontSize: 22, color: "white" }} aria-hidden="true"></i>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 500, lineHeight: 1.2, color: "#042C53" }}>Ferromateriales San Blas</div>
            <div style={{ fontSize: 12, color: "#378ADD", fontWeight: 500, lineHeight: 1.3 }}>Despacho de pedidos</div>
          </div>
        </div>

        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 5 }}>Correo</span>
          <input
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={correo}
            onChange={(e) => {
              setCorreo(e.target.value);
              setError("");
            }}
            style={{ width: "100%", minHeight: 44, padding: "10px 12px", fontSize: 16 }}
          />
        </label>

        <label style={{ display: "block", marginBottom: 18 }}>
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 5 }}>Clave</span>
          <input
            type="password"
            autoComplete="current-password"
            value={clave}
            onChange={(e) => {
              setClave(e.target.value);
              setError("");
            }}
            style={{ width: "100%", minHeight: 44, padding: "10px 12px", fontSize: 16 }}
          />
        </label>

        {error && (
          <div
            role="alert"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              fontSize: 13,
              color: "var(--color-text-danger)",
              background: "var(--color-background-danger)",
              border: "0.5px solid var(--color-border-danger)",
              borderRadius: "var(--border-radius-md)",
              padding: "9px 11px",
              marginBottom: 14,
            }}
          >
            <i className="ti ti-alert-triangle" style={{ fontSize: 15, flexShrink: 0 }} aria-hidden="true"></i>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={cargando}
          style={{
            width: "100%",
            minHeight: 46,
            border: "none",
            background: cargando ? "#7FA8CE" : "#0C447C",
            color: "white",
            fontWeight: 500,
            fontSize: 15,
            borderRadius: "var(--border-radius-md)",
          }}
        >
          {cargando ? "Entrando..." : "Entrar"}
        </button>

        <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 14, textAlign: "center", lineHeight: 1.45 }}>
          Solo se pide una vez en este dispositivo. No hace falta volver a
          entrar al refrescar ni al día siguiente.
        </div>
      </form>
    </div>
  );
}
