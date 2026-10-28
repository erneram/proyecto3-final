const MIN = 20;
const MAX = 80;
/** Ancho de la columna del divisor (1.5rem), igual al de la plantilla de la cuadrícula. */
const WIDTH = 24;

const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v));

/**
 * Divisor arrastrable entre las dos columnas de su contenedor. `value` es el
 * porcentaje del lado izquierdo; también se ajusta con las flechas y vuelve a
 * 50 con doble clic.
 */
export function Splitter({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Ancho del editor"
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      className="group hidden cursor-col-resize touch-none items-center justify-center outline-none lg:flex"
      onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const grid = e.currentTarget.parentElement!;
        const { left, width } = grid.getBoundingClientRect();
        const pad = parseFloat(getComputedStyle(grid).paddingLeft);
        onChange(clamp(((e.clientX - left - pad - WIDTH / 2) / (width - 2 * pad - WIDTH)) * 100));
      }}
      onKeyDown={(e) => {
        const step = e.key === "ArrowLeft" ? -5 : e.key === "ArrowRight" ? 5 : 0;
        if (!step) return;
        e.preventDefault();
        onChange(clamp(value + step));
      }}
      onDoubleClick={() => onChange(50)}
    >
      <div className="h-16 w-1 rounded-full bg-primary/30 transition-colors group-hover:bg-primary group-focus-visible:bg-primary group-active:bg-primary group-active:shadow-[0_0_12px_var(--primary)]" />
    </div>
  );
}
