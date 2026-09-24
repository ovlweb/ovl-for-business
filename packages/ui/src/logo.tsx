import { motion } from 'motion/react';
import { useId } from 'react';

/** The OVL mark: an orbit around a core, drawn in the theme gradient. */
export function Logo({ size = 32, animated = false }: { size?: number; animated?: boolean }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="OVL For Business">
      <defs>
        <linearGradient id={`logo-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--grad-from)" />
          <stop offset="100%" stopColor="var(--grad-to)" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill={`url(#logo-${id})`} />
      <motion.ellipse
        cx="32"
        cy="32"
        rx="19"
        ry="13"
        fill="none"
        stroke="#fff"
        strokeWidth="5"
        initial={animated ? { pathLength: 0, rotate: -30 } : false}
        animate={{ pathLength: 1, rotate: 0 }}
        transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
        style={{ originX: '32px', originY: '32px' }}
      />
      <motion.circle
        cx="32"
        cy="32"
        r="5"
        fill="#fff"
        initial={animated ? { scale: 0 } : false}
        animate={{ scale: 1 }}
        transition={{ delay: animated ? 0.6 : 0, type: 'spring', stiffness: 400, damping: 14 }}
      />
    </svg>
  );
}
