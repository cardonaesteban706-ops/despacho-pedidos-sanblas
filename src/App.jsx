import { useEffect, useState } from "react";
import { sesionActual, alCambiarSesion } from "./supabaseClient";
import Login from "./Login.jsx";
import DespachoPedidos from "./DespachoPedidos.jsx";

// Portero de la app: decide si se ve el login o el tablero.
//
// El detalle que importa para el mostrador: mientras se resuelve la sesión
// guardada NO se muestra el login, se muestra el mismo "Cargando..." de
// siempre. Si no, cada F5 haría parpadear la pantalla de login durante un
// instante antes de entrar — se ve como si la app pidiera la clave otra vez, y
// alguien empezaría a escribirla sin necesidad.
export default function App() {
  const [sesion, setSesion] = useState(null);
  const [resolviendo, setResolviendo] = useState(true);

  useEffect(() => {
    let vivo = true;

    // 1) Sesión guardada en el navegador (la del último login en este equipo).
    sesionActual()
      .then((s) => {
        if (!vivo) return;
        setSesion(s);
        setResolviendo(false);
      })
      .catch(() => {
        if (!vivo) return;
        // Si no se puede leer la sesión (almacenamiento bloqueado, por ejemplo),
        // se pide login. Es el camino seguro.
        setSesion(null);
        setResolviendo(false);
      });

    // 2) Y quedamos escuchando: entrar, salir y las renovaciones de token.
    const desuscribir = alCambiarSesion((s) => {
      if (!vivo) return;
      setSesion(s);
      setResolviendo(false);
    });

    return () => {
      vivo = false;
      desuscribir();
    };
  }, []);

  if (resolviendo) {
    return (
      <div style={{ padding: "3rem 0", textAlign: "center", color: "var(--color-text-secondary)", fontSize: 14 }}>
        Cargando pedidos...
      </div>
    );
  }

  if (!sesion) return <Login />;

  return <DespachoPedidos />;
}
