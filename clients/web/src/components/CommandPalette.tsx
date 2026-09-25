import type { Chat } from '@ovl/shared';
import { Avatar, Icon, useDebounced, type IconName, t } from '@ovl/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

interface Result {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon?: IconName;
  avatar?: { name: string; url?: string | null };
  to: string;
}

/** Ctrl/⌘ + K: jump to any page, chat, person or registry entry. */
export function CommandPalette({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: { to: string; icon: IconName; label: string }[];
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const search = useDebounced(q.trim(), 200);

  useEffect(() => {
    if (open) {
      setQ('');
      setCursor(0);
      setTimeout(() => input.current?.focus(), 30);
    }
  }, [open]);

  const people = useQuery({
    queryKey: ['palette', 'people', search],
    queryFn: () => api.users.search(search),
    enabled: open && search.length > 1,
  });
  const registry = useQuery({
    queryKey: ['palette', 'registry', search],
    queryFn: () => api.registry.search({ q: search, limit: 5 }),
    enabled: open && search.length > 1,
  });

  const results = useMemo<Result[]>(() => {
    const needle = q.trim().toLowerCase();
    const pages = items
      .filter((i) => !needle || t(i.label).toLowerCase().includes(needle))
      .map((i) => ({ id: `page:${i.to}`, group: 'Pages', label: i.label, icon: i.icon, to: i.to }));
    const chats = (queryClient.getQueryData<Chat[]>(['chats']) ?? [])
      .filter((c) => needle && c.title.toLowerCase().includes(needle))
      .slice(0, 5)
      .map((c) => ({
        id: `chat:${c.id}`,
        group: 'Chats',
        label: c.title,
        hint: c.type === 'direct' ? t('Direct message') : c.type,
        avatar: { name: c.title, url: c.peer?.avatarUrl },
        to: `/chats/${c.id}`,
      }));
    const users = (search.length > 1 ? (people.data ?? []) : []).slice(0, 5).map((u) => ({
      id: `user:${u.id}`,
      group: 'People',
      label: u.displayName,
      hint: `@${u.username}`,
      avatar: { name: u.displayName, url: u.avatarUrl },
      to: `/u/${u.username}`,
    }));
    const entries = (search.length > 1 ? (registry.data?.items ?? []) : []).map((e) => ({
      id: `reg:${e.id}`,
      group: 'Registry',
      label: e.title,
      hint: e.number,
      icon: 'book' as const,
      to: `/registry?q=${encodeURIComponent(e.number)}`,
    }));
    return [...pages, ...chats, ...users, ...entries];
  }, [q, search, items, people.data, registry.data, queryClient]);

  const choose = (r: Result | undefined) => {
    if (!r) return;
    onClose();
    navigate(r.to);
  };

  let lastGroup = '';
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop palette-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            className="palette"
            role="dialog"
            aria-label={t('Search')}
            initial={{ opacity: 0, y: -16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 460, damping: 34 }}
          >
            <div className="palette-input">
              <Icon name="search" size={19} />
              <input
                ref={input}
                autoFocus
                value={q}
                placeholder={t('Search pages, chats, people, registry numbers…')}
                onChange={(e) => {
                  setQ(e.target.value);
                  setCursor(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') onClose();
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setCursor((c) => Math.min(results.length - 1, c + 1));
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setCursor((c) => Math.max(0, c - 1));
                  }
                  if (e.key === 'Enter') choose(results[cursor]);
                }}
              />
              <kbd>{t('Esc')}</kbd>
            </div>
            <div className="palette-results">
              {results.map((r, i) => {
                const header = r.group !== lastGroup ? r.group : null;
                lastGroup = r.group;
                return (
                  <div key={r.id}>
                    {header && <div className="palette-group">{t(header)}</div>}
                    <button
                      className={`palette-item${i === cursor ? ' active' : ''}`}
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => choose(r)}
                    >
                      {r.avatar ? (
                        <Avatar name={r.avatar.name} url={r.avatar.url} size={26} />
                      ) : (
                        <span className="palette-icon">
                          <Icon name={r.icon ?? 'arrowRight'} size={16} />
                        </span>
                      )}
                      <span className="grow ellipsis">{t(r.label)}</span>
                      {r.hint && <span className="tiny muted">{t(r.hint)}</span>}
                      {i === cursor && <Icon name="arrowRight" size={14} />}
                    </button>
                  </div>
                );
              })}
              {results.length === 0 && <div className="palette-empty">{t('No results for “{0}”', q)}</div>}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
