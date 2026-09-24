import { motion } from 'motion/react';
import { useEffect, useId, useRef, useState } from 'react';

function smoothPath(pts: [number, number][]): string {
  // Catmull-Rom → cubic Bézier for a smooth line.
  let d = `M ${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/**
 * Smooth area chart with a gradient fill that draws itself in. Pass `format` (and optionally
 * `labels`) to get grid lines and a hover crosshair with a tooltip.
 */
export function AreaChart({
  values,
  labels,
  format,
  height = 120,
  color = 'var(--accent)',
  label = 'Price history',
}: {
  values: number[];
  labels?: string[];
  format?: (value: number) => string;
  height?: number;
  color?: string;
  label?: string;
}) {
  const id = useId().replace(/:/g, '');
  const [ref, measured] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const interactive = Boolean(format);
  if (values.length < 2) {
    return (
      <div className="muted small" style={{ height, display: 'flex', alignItems: 'center' }}>
        Not enough history yet — the chart appears after the next price change.
      </div>
    );
  }
  const width = measured || 600;
  const pad = { top: interactive ? 14 : 8, bottom: interactive ? 14 : 8 };
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  // Leave headroom so the line never touches the edges.
  const margin = (rawMax - rawMin || rawMax || 1) * 0.08;
  const min = rawMin - margin;
  const max = rawMax + margin;
  const span = max - min || 1;
  const y = (v: number) => pad.top + (1 - (v - min) / span) * (height - pad.top - pad.bottom);
  const pts: [number, number][] = values.map((v, i) => [(i / (values.length - 1)) * width, y(v)]);
  const d = smoothPath(pts);
  const area = `${d} L ${width} ${height} L 0 ${height} Z`;
  const last = pts[pts.length - 1]!;
  const active = hover ?? null;
  const grid = interactive ? [0.25, 0.5, 0.75].map((f) => rawMin + (rawMax - rawMin) * f) : [];

  return (
    <div
      ref={ref}
      className="chart"
      style={{ position: 'relative', height }}
      onPointerMove={(e) => {
        if (!interactive) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const i = Math.round(((e.clientX - rect.left) / rect.width) * (values.length - 1));
        setHover(Math.max(0, Math.min(values.length - 1, i)));
      }}
      onPointerLeave={() => setHover(null)}
    >
      {measured > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          style={{ display: 'block', overflow: 'visible' }}
        >
          <defs>
            <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {grid.map((g) => (
            <g key={g}>
              <line x1={0} x2={width} y1={y(g)} y2={y(g)} stroke="var(--border)" strokeDasharray="3 5" />
              <text x={width} y={y(g) - 5} textAnchor="end" className="chart-axis">
                {format!(g)}
              </text>
            </g>
          ))}
          <motion.path
            d={area}
            fill={`url(#fill-${id})`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.3 }}
          />
          <motion.path
            d={d}
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          />
          {active === null ? (
            <motion.circle
              cx={last[0]}
              cy={last[1]}
              r="4"
              fill={color}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 1 }}
            />
          ) : (
            <g>
              <line
                x1={pts[active]![0]}
                x2={pts[active]![0]}
                y1={0}
                y2={height}
                stroke="var(--border-strong)"
              />
              <circle
                cx={pts[active]![0]}
                cy={pts[active]![1]}
                r="5"
                fill="var(--surface)"
                stroke={color}
                strokeWidth="2.5"
              />
            </g>
          )}
        </svg>
      )}
      {active !== null && format && (
        <div
          className="chart-tip"
          style={{
            left: Math.min(Math.max(pts[active]![0], 60), width - 60),
            top: Math.max(pts[active]![1] - 52, -8),
          }}
        >
          <strong>{format(values[active]!)}</strong>
          {labels?.[active] && <span>{labels[active]}</span>}
        </div>
      )}
    </div>
  );
}

/** Kept for compatibility: a compact area chart. */
export function Sparkline({ values, height = 80 }: { values: number[]; width?: number; height?: number }) {
  return <AreaChart values={values} height={height} />;
}

/** Horizontal share bar, e.g. frozen vs. available money. */
export function ShareBar({ parts }: { parts: { value: number; color: string; label: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div
      style={{
        display: 'flex',
        height: 8,
        borderRadius: 999,
        overflow: 'hidden',
        background: 'var(--surface-3)',
      }}
    >
      {parts.map((p) => (
        <motion.div
          key={p.label}
          title={p.label}
          style={{ background: p.color }}
          initial={{ width: 0 }}
          animate={{ width: `${(p.value / total) * 100}%` }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      ))}
    </div>
  );
}
