import { AnimatePresence, motion } from 'motion/react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { errorMessage } from './format';
import { Icon } from './icons';

type Tone = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  tone: Tone;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (error: unknown) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi>({ success: () => {}, error: () => {}, info: () => {} });

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Tone, message: string) => {
    const id = nextId++;
    setToasts((list) => [...list.slice(-3), { id, tone, message }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), tone === 'error' ? 6000 : 3500);
  }, []);
  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      info: (m) => push('info', m),
      error: (e) => push('error', errorMessage(e)),
    }),
    [push],
  );
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              className={`toast ${t.tone}`}
              initial={{ opacity: 0, y: 24, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, transition: { duration: 0.2 } }}
              transition={{ type: 'spring', stiffness: 500, damping: 36 }}
            >
              <span className="toast-icon">
                <Icon
                  name={t.tone === 'success' ? 'check' : t.tone === 'error' ? 'info' : 'bell'}
                  size={16}
                />
              </span>
              <span className="grow">{t.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
