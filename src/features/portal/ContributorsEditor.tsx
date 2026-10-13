import { useState } from 'react';
import type { Contributor } from '../../lib/models';

export function ContributorsEditor({
  value,
  onChange,
}: {
  value: Contributor[];
  onChange: (next: Contributor[]) => void;
}) {
  const [expanded, setExpanded] = useState(0);
  const [validationMessage, setValidationMessage] = useState('');
  const update = (index: number, field: keyof Contributor, text: string) =>
    onChange(value.map((author, i) => (i === index ? { ...author, [field]: text } : author)));
  const move = (index: number, direction: number) => {
    const next = [...value];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    onChange(next);
    setExpanded(index + direction);
  };
  return (
    <fieldset
      className="space-y-3"
      onChange={() => setValidationMessage('')}
      onInvalidCapture={(event) => {
        event.preventDefault();
        const first = event.currentTarget.querySelector<HTMLInputElement>('input:invalid');
        if (!first) return;
        const index = Number(
          first.closest('[data-author-index]')?.getAttribute('data-author-index'),
        );
        setExpanded(index);
        setValidationMessage(`Author ${index + 1}: ${first.validationMessage}`);
        requestAnimationFrame(() => first.focus());
      }}
    >
      <legend className="mb-2 text-sm font-semibold">Authors & co-authors</legend>
      <p className="text-xs text-slate-500">
        List every author in publication order, up to 20. Names and institutions appear on the
        published article. Email addresses are only available to the submitting account and
        authorized admins.
      </p>
      {value.map((author, index) => (
        <section className="contributor-card" key={index} data-author-index={index}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              className="flex-1 text-left text-sm font-semibold"
              aria-expanded={expanded === index}
              aria-controls={`contributor-${index}`}
              onClick={() => setExpanded(index)}
            >
              {index + 1}. {author.name || 'New co-author'}{' '}
              <span className="text-xs font-normal text-slate-500">
                {index === 0 ? 'First author' : 'Co-author'}
              </span>
            </button>
            <div className="flex gap-3 text-xs">
              <button
                type="button"
                disabled={index === 0}
                className="text-link disabled:opacity-30"
                aria-label={`Move author ${index + 1} up`}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={index === value.length - 1}
                className="text-link disabled:opacity-30"
                aria-label={`Move author ${index + 1} down`}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
              {value.length > 1 && (
                <button
                  type="button"
                  className="text-red-700"
                  aria-label={`Remove author ${index + 1}`}
                  onClick={() => {
                    onChange(value.filter((_, i) => i !== index));
                    setExpanded(Math.max(0, index - 1));
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
          <div
            id={`contributor-${index}`}
            hidden={expanded !== index}
            className="mt-4 grid gap-4 sm:grid-cols-2"
          >
            <label className="sm:col-span-2">
              Full name
              <input
                required
                minLength={2}
                maxLength={160}
                value={author.name}
                onChange={(e) => update(index, 'name', e.target.value)}
              />
            </label>
            <label>
              Institute / Organization
              <input
                required
                minLength={2}
                maxLength={200}
                value={author.institution}
                onChange={(e) => update(index, 'institution', e.target.value)}
              />
            </label>
            <label>
              Email
              <input
                type="email"
                required
                maxLength={254}
                value={author.email}
                onChange={(e) => update(index, 'email', e.target.value)}
              />
            </label>
          </div>
        </section>
      ))}
      {validationMessage && (
        <p role="alert" className="text-sm text-red-700">
          {validationMessage}
        </p>
      )}
      <button
        type="button"
        className="btn-secondary"
        disabled={value.length >= 20}
        onClick={() => {
          onChange([...value, { name: '', institution: '', email: '' }]);
          setExpanded(value.length);
        }}
      >
        + Add co-author
      </button>
    </fieldset>
  );
}
