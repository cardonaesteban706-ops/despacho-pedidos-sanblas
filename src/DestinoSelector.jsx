import { useState } from "react";
import { DESTINOS } from "./constants.js";

// Selector de destino: Corozal / Morroa / Otro (con campo manual). Guarda el
// nombre del lugar en "value" (un string): para los presets es su nombre; para
// "Otro" es lo que se escriba a mano.
function DestinoSelector({ value, onChange }) {
  const esPreset = DESTINOS.includes(value);
  const [otroManual, setOtroManual] = useState(!!value && !esPreset);
  const mostrarOtro = otroManual || (!!value && !esPreset);
  const opcion = (activo) => ({
    flex: 1,
    fontSize: 12.5,
    padding: "8px 4px",
    minHeight: 40,
    borderRadius: "var(--border-radius-md)",
    border: activo ? "2px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
    background: activo ? "var(--color-background-info)" : "var(--color-background-primary)",
    color: activo ? "var(--color-text-info)" : "var(--color-text-primary)",
    fontWeight: activo ? 500 : 400,
  });
  return (
    <div>
      <span style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>
        ¿Para dónde va? <span style={{ color: "var(--color-text-tertiary)" }}>(opcional)</span>
      </span>
      <div style={{ display: "flex", gap: 6 }}>
        {DESTINOS.map((d) => (
          <button
            key={d}
            aria-pressed={value === d}
            onClick={() => {
              setOtroManual(false);
              onChange(d);
            }}
            style={opcion(value === d)}
          >
            {d}
          </button>
        ))}
        <button
          aria-pressed={mostrarOtro}
          onClick={() => {
            setOtroManual(true);
            if (esPreset) onChange("");
          }}
          style={opcion(mostrarOtro)}
        >
          Otro
        </button>
      </div>
      {mostrarOtro && (
        <input
          type="text"
          autoComplete="off"
          placeholder="Escribe el lugar"
          value={esPreset ? "" : value || ""}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: "100%", marginTop: 8 }}
        />
      )}
    </div>
  );
}

export default DestinoSelector;
