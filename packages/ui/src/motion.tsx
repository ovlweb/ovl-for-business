import { motion, type HTMLMotionProps } from 'motion/react';
import type { ReactNode } from 'react';

const ease = [0.22, 1, 0.36, 1] as const;

/** Fade and rise into place. */
export function FadeIn({
  delay = 0,
  y = 10,
  children,
  ...props
}: { delay?: number; y?: number; children: ReactNode } & HTMLMotionProps<'div'>) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/** Children appear one after another (use StaggerItem inside). */
export function Stagger({
  children,
  gap = 0.05,
  ...props
}: { children: ReactNode; gap?: number } & HTMLMotionProps<'div'>) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: gap } } }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, ...props }: { children: ReactNode } & HTMLMotionProps<'div'>) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 12 },
        show: { opacity: 1, y: 0, transition: { duration: 0.4, ease } },
      }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/** Wrap routed content so page changes cross-fade. Key it by location. */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div
      style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28, ease }}
    >
      {children}
    </motion.div>
  );
}
