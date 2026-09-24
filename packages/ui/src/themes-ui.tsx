import { THEMES, type Theme } from '@ovl/shared';
import { motion } from 'motion/react';
import { Icon } from './icons';

function Preview({ theme }: { theme: Theme }) {
  const c = theme.colors;
  return (
    <div className="theme-preview" style={{ background: c.bg, border: `1px solid ${c.border}` }}>
      <div
        className="tp-side"
        style={{ background: c.sidebarBg, borderRight: `1px solid ${c.sidebarBorder}` }}
      >
        <div
          className="tp-line"
          style={{ width: '70%', background: `linear-gradient(90deg, ${c.gradFrom}, ${c.gradTo})` }}
        />
        <div className="tp-line" style={{ width: '85%', background: c.sidebarActiveBg }} />
        <div className="tp-line" style={{ width: '60%', background: c.sidebarMuted, opacity: 0.5 }} />
        <div className="tp-line" style={{ width: '75%', background: c.sidebarMuted, opacity: 0.5 }} />
      </div>
      <div className="tp-main">
        <div className="tp-line" style={{ width: '45%', background: c.text, opacity: 0.85 }} />
        <div className="tp-card" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
          <div className="tp-line" style={{ width: '60%', background: c.text2, opacity: 0.6 }} />
          <div className="tp-line" style={{ width: '35%', background: c.accent }} />
          <div style={{ display: 'flex', gap: 4, marginTop: 'auto' }}>
            <span style={{ width: 16, height: 6, borderRadius: 3, background: c.success }} />
            <span style={{ width: 16, height: 6, borderRadius: 3, background: c.warning }} />
            <span style={{ width: 16, height: 6, borderRadius: 3, background: c.council }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Grid of theme previews; "system" follows the OS light / dark mode. */
export function ThemeGallery({
  value,
  onChange,
  includeSystem = true,
}: {
  value: string;
  onChange: (id: string, origin: { x: number; y: number }) => void;
  includeSystem?: boolean;
}) {
  const options: { id: string; name: string; description: string; preview: Theme | [Theme, Theme] }[] = [
    ...(includeSystem
      ? [
          {
            id: 'system',
            name: 'Match system',
            description: 'Daylight or Midnight, following your device.',
            preview: [THEMES[0]!, THEMES[1]!] as [Theme, Theme],
          },
        ]
      : []),
    ...THEMES.map((t) => ({ id: t.id, name: t.name, description: t.description, preview: t })),
  ];
  return (
    <div className="grid-3" role="radiogroup" aria-label="Theme">
      {options.map((o, i) => (
        <motion.button
          key={o.id}
          type="button"
          className="theme-card"
          role="radio"
          aria-checked={value === o.id}
          aria-label={o.name}
          title={o.description}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.03, duration: 0.35 }}
          onClick={(e) => onChange(o.id, { x: e.clientX, y: e.clientY })}
        >
          {Array.isArray(o.preview) ? (
            <div style={{ position: 'relative' }}>
              <Preview theme={o.preview[0]} />
              <div style={{ position: 'absolute', inset: 0, clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }}>
                <Preview theme={o.preview[1]} />
              </div>
            </div>
          ) : (
            <Preview theme={o.preview} />
          )}
          <div style={{ padding: '0 4px 2px' }}>
            <div className="bold">{o.name}</div>
            <div className="tiny muted">{o.description}</div>
          </div>
          {value === o.id && (
            <motion.span
              className="theme-check"
              layoutId="theme-check"
              transition={{ type: 'spring', stiffness: 500, damping: 32 }}
            >
              <Icon name="check" size={14} />
            </motion.span>
          )}
        </motion.button>
      ))}
    </div>
  );
}

/** Compact theme list for menus and popovers: a swatch, the name and a check. */
export function ThemeMenu({
  value,
  onChange,
  includeSystem = true,
}: {
  value: string;
  onChange: (id: string, origin: { x: number; y: number }) => void;
  includeSystem?: boolean;
}) {
  const options = [
    ...(includeSystem
      ? [{ id: 'system', name: 'Match system', swatch: 'linear-gradient(135deg, #f8fafc 50%, #0b1220 50%)' }]
      : []),
    ...THEMES.map((t) => ({
      id: t.id,
      name: t.name,
      swatch: `linear-gradient(135deg, ${t.colors.sidebarBg} 0 45%, ${t.colors.gradFrom} 45% 72%, ${t.colors.gradTo} 72%)`,
    })),
  ];
  return (
    <div role="radiogroup" aria-label="Theme">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          className="menu-item"
          onClick={(e) => onChange(o.id, { x: e.clientX, y: e.clientY })}
        >
          <span className="theme-swatch" style={{ background: o.swatch }} />
          <span className="grow">{o.name}</span>
          {value === o.id && <Icon name="check" size={16} />}
        </button>
      ))}
    </div>
  );
}
