import { useState } from "react";
import { MARCA } from "./constants.js";
import ConteoCemento from "./ConteoCemento.jsx";
import Llegadas from "./Llegadas.jsx";
import Agotados from "./Agotados.jsx";

// Bodega: los tres módulos bajo un solo botón de la barra superior, como en el
// diseño "San Blas Bodega". Cada celular recuerda la última pestaña abierta: el
// de la empleada que reporta agotados abre directo en Agotados, el del que
// recibe mercancía en Llegadas.

const CLAVE_PESTANA = "sanblas.bodegaPestana";

const PESTANAS = [
  { id: "cemento", label: "Cemento", icon: "ti-bucket-droplet" },
  { id: "llegadas", label: "Llegadas", icon: "ti-truck" },
  { id: "agotados", label: "Agotados", icon: "ti-package-off" },
];

function leerPestana() {
  try {
    const p = window.localStorage.getItem(CLAVE_PESTANA);
    return PESTANAS.some((x) => x.id === p) ? p : "cemento";
  } catch {
    return "cemento";
  }
}

function guardarPestana(p) {
  try {
    window.localStorage.setItem(CLAVE_PESTANA, p);
  } catch {
    // Almacenamiento bloqueado: la próxima vez abre en Cemento, nada más.
  }
}

export default function Bodega({ conteoAgotados, onConteoAgotados }) {
  const [pestana, setPestana] = useState(leerPestana);

  function elegir(p) {
    setPestana(p);
    guardarPestana(p);
  }

  return (
    <div>
      <div role="tablist" aria-label="Bodega" style={{ display: "flex", borderBottom: "0.5px solid var(--color-border-secondary)", marginBottom: 14, maxWidth: 1180, marginLeft: "auto", marginRight: "auto" }}>
        {PESTANAS.map((p) => {
          const activa = p.id === pestana;
          return (
            <button
              key={p.id}
              role="tab"
              aria-selected={activa}
              onClick={() => elegir(p.id)}
              style={{
                flex: 1,
                minHeight: 46,
                border: 0,
                borderRadius: 0,
                background: "none",
                borderBottom: activa ? `2px solid ${MARCA.azulOscuro}` : "2px solid transparent",
                marginBottom: -0.5,
                color: activa ? MARCA.azulOscuro : "var(--color-text-secondary)",
                fontWeight: activa ? 600 : 400,
                fontSize: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <i className={`ti ${p.icon}`} style={{ fontSize: 16 }} aria-hidden="true"></i>
              {p.label}
              {p.id === "agotados" && conteoAgotados > 0 && (
                <span
                  aria-label={`${conteoAgotados} agotados`}
                  style={{ minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, background: "#CC3333", color: "white", fontSize: 11, fontWeight: 600, lineHeight: "18px", textAlign: "center" }}
                >
                  {conteoAgotados}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {pestana === "cemento" && <ConteoCemento />}
      {pestana === "llegadas" && <Llegadas onConteoAgotados={onConteoAgotados} />}
      {pestana === "agotados" && <Agotados onConteo={onConteoAgotados} />}
    </div>
  );
}
