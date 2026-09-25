import { QUICK_REACTIONS, type FileInfo, type Message, type UserSummary } from '@ovl/shared';
import { AttachmentList, ErrorAlert } from '@ovl/ui';
import { useRef, useState, type ReactNode } from 'react';
import { api } from '../api';

const MENTION = /(@[a-z][a-z0-9_]{2,31})\b/gi;

/** Message text with @mentions highlighted (your own name stands out). */
export function MessageText({ body, myUsername }: { body: string; myUsername: string }) {
  const parts = body.split(MENTION);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className={`mention${part.slice(1).toLowerCase() === myUsername ? ' me' : ''}`}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

const isImage = (f: FileInfo) => f.contentType.startsWith('image/');

/** Pictures shown inline, other files as cards. */
export function MessageFiles({ files }: { files: FileInfo[] }) {
  if (!files.length) return null;
  const images = files.filter(isImage);
  const others = files.filter((f) => !isImage(f));
  return (
    <div className="msg-files" onClick={(e) => e.stopPropagation()}>
      {images.length > 0 && (
        <div className={`msg-images n${Math.min(images.length, 3)}`}>
          {images.map((f) => (
            <a key={f.id} href={api.files.url(f.url)} target="_blank" rel="noreferrer">
              <img src={api.files.url(f.url)} alt={f.name} loading="lazy" />
            </a>
          ))}
        </div>
      )}
      <AttachmentList files={others} href={api.files.url} />
    </div>
  );
}

/** Reaction pills under a message; clicking one adds or takes back yours. */
export function Reactions({
  message,
  onToggle,
  disabled,
}: {
  message: Message;
  onToggle: (emoji: string, mine: boolean) => void;
  disabled?: boolean;
}) {
  if (!message.reactions.length) return null;
  return (
    <div className="reactions" onClick={(e) => e.stopPropagation()}>
      {message.reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          className={`reaction${r.mine ? ' mine' : ''}`}
          aria-pressed={r.mine}
          aria-label={`${r.emoji} ${r.count}`}
          disabled={disabled}
          onClick={() => onToggle(r.emoji, r.mine)}
        >
          <span>{r.emoji}</span>
          <span className="num">{r.count}</span>
        </button>
      ))}
    </div>
  );
}

/** The quick reactions offered in a message's toolbar. */
export function QuickReactions({
  message,
  onToggle,
}: {
  message: Message;
  onToggle: (emoji: string, mine: boolean) => void;
}) {
  return (
    <div className="quick-reactions" role="group" aria-label="React">
      {QUICK_REACTIONS.map((emoji) => {
        const mine = message.reactions.some((r) => r.emoji === emoji && r.mine);
        return (
          <button
            key={emoji}
            type="button"
            className={`btn sm ghost${mine ? ' active' : ''}`}
            aria-label={`React ${emoji}`}
            onClick={() => onToggle(emoji, mine)}
          >
            {emoji}
          </button>
        );
      })}
    </div>
  );
}

/** Files picked, pasted or dropped into a composer, uploaded at once and sent with the message. */
export function useChatUploads(max = 10) {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const input = useRef<HTMLInputElement>(null);
  const add = async (picked: File[]) => {
    const room = Math.max(0, max - files.length);
    if (!picked.length || !room) return;
    setBusy(true);
    setError(null);
    const added: FileInfo[] = [];
    try {
      for (const file of picked.slice(0, room))
        added.push(await api.files.upload(file, file.name || 'pasted.png'));
    } catch (err) {
      setError(err);
    } finally {
      setFiles((current) => [...current, ...added]);
      setBusy(false);
    }
  };
  const remove = (file: FileInfo) => {
    setFiles((current) => current.filter((f) => f.id !== file.id));
    void api.files.remove(file.id).catch(() => undefined);
  };
  const picker: ReactNode = (
    <input
      ref={input}
      type="file"
      multiple
      hidden
      aria-label="Choose files to attach"
      accept="image/*,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.odt,.ods,.zip"
      onChange={(e) => {
        const picked = [...(e.target.files ?? [])];
        e.target.value = '';
        void add(picked);
      }}
    />
  );
  const pending: ReactNode =
    files.length || error ? (
      <div className="composer-files">
        <AttachmentList files={files} href={api.files.url} onRemove={remove} />
        <ErrorAlert error={error} />
      </div>
    ) : null;
  return {
    files,
    busy,
    pick: () => input.current?.click(),
    add,
    clear: () => setFiles([]),
    picker,
    pending,
  };
}

/** The "@na" being typed right before the caret, if any. */
export function mentionQuery(text: string, caret: number): string | null {
  const match = /(?:^|\s)@([a-z0-9_]{0,32})$/i.exec(text.slice(0, caret));
  return match ? match[1]!.toLowerCase() : null;
}

/** Replace the "@na" before the caret with "@username ". */
export function insertMention(text: string, caret: number, username: string) {
  const before = text.slice(0, caret).replace(/@([a-z0-9_]{0,32})$/i, `@${username} `);
  return { text: before + text.slice(caret), caret: before.length };
}

export function MentionList({
  people,
  selected,
  onPick,
}: {
  people: UserSummary[];
  selected: number;
  onPick: (user: UserSummary) => void;
}) {
  if (!people.length) return null;
  return (
    <div className="mention-list" role="listbox" aria-label="Mention someone">
      {people.map((u, i) => (
        <button
          key={u.id}
          type="button"
          role="option"
          aria-selected={i === selected}
          className={`mention-option${i === selected ? ' active' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(u);
          }}
        >
          <b>{u.displayName}</b> <span className="muted">@{u.username}</span>
        </button>
      ))}
    </div>
  );
}

/** Up to five people whose username or name starts with the query. */
export function matchPeople(people: UserSummary[], query: string, exclude: string) {
  return people
    .filter(
      (u) =>
        u.id !== exclude &&
        (u.username.startsWith(query) ||
          u.displayName
            .toLowerCase()
            .split(/\s+/)
            .some((w) => w.startsWith(query))),
    )
    .slice(0, 5);
}
