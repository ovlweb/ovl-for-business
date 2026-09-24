export function Pager({
  total,
  limit,
  offset,
  onChange,
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
}) {
  if (total <= limit) return null;
  return (
    <div className="pager">
      <button
        className="btn sm"
        disabled={offset === 0}
        onClick={() => onChange(Math.max(0, offset - limit))}
      >
        Previous
      </button>
      <span className="small muted">
        {offset + 1}–{Math.min(offset + limit, total)} of {total}
      </span>
      <button className="btn sm" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>
        Next
      </button>
    </div>
  );
}
