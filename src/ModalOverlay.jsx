import { useEffect } from "react";

// Base compartida de TODOS los modales de la app: el fondo oscuro, el centrado,
// el cierre con Escape y el clic afuera. Vivía en DespachoPedidos.jsx, donde la
// usaban trece modales distintos; sacarla acá es lo que permite que cada modal
// se mude a su propio archivo sin arrastrar el monolito detrás.
//
// El stopPropagation del hijo no es decorativo: sin él, un clic en cualquier
// parte del contenido del modal lo cerraría.
function ModalOverlay({ onClose, children, maxWidth = 480 }) {
  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--color-background-primary)",
          borderRadius: "var(--border-radius-lg)",
          padding: 12,
          width: "100%",
          maxWidth,
          maxHeight: "90vh",
          overflowY: "auto",
          overscrollBehavior: "contain",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default ModalOverlay;
