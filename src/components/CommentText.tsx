import { useState } from 'react';

export function CommentText({ body }: { body: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = body.length > 350;
  return (
    <div className="mt-3">
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-600">
        {long && !expanded ? `${body.slice(0, 350).trimEnd()}…` : body}
      </p>
      {long && (
        <button
          type="button"
          className="text-link text-xs mt-2"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show less' : 'Read full comment'}
        </button>
      )}
    </div>
  );
}
