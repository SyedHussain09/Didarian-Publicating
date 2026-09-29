import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { saveDraft, uploadManuscript } from '../../lib/api';
import { categories, type DraftInput, type Submission } from '../../lib/models';
import { errorMessage, validateFile } from '../../lib/validation';
import { Feedback, PortalHeader, button, secondary, field, panel } from './shared';
import { Resources } from './PortalHome';

export function SubmissionEditor({
  admin = false,
  current,
  onSaved,
  onBusyChange,
}: {
  admin?: boolean;
  current?: Submission;
  onSaved?: (data: Submission) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [saved, setSaved] = useState(current);
  const [input, setInput] = useState<DraftInput>(() => ({
    title: current?.title ?? '',
    abstract: current?.abstract ?? '',
    author_names:
      current?.author_names ?? [profile?.first_name, profile?.last_name].filter(Boolean).join(' '),
    category: current?.category ?? '',
    keywords: current?.keywords ?? [],
    publication_consent: current?.publication_consent ?? false,
  }));
  const [keywords, setKeywords] = useState(input.keywords.join(', '));
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  const change = (name: keyof DraftInput, value: string | boolean) =>
    setInput((previous) => ({ ...previous, [name]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    setPhase('Saving draft…');
    setProgress(null);
    try {
      if (!navigator.onLine)
        throw new Error(
          'You are offline. Reconnect before saving; your typed fields are still here.',
        );
      if (file) validateFile(file);
      let result = await saveDraft(
        {
          ...input,
          keywords: keywords
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        },
        saved,
      );
      setSaved(result);
      if (file) {
        controller.current = new AbortController();
        setPhase('Uploading manuscript…');
        result = await uploadManuscript(
          result,
          file,
          (bytes, total) => {
            setProgress(Math.round((bytes / total) * 100));
            if (bytes === total) setPhase('Upload complete. Verifying file and saving metadata…');
          },
          controller.current.signal,
        );
        setSaved(result);
      }
      await cache.invalidateQueries({ queryKey: ['private'] });
      if (onSaved) onSaved(result);
      else navigate(`${admin ? '/admin' : '/author'}/submissions/${result.id}`, { replace: true });
    } catch (e) {
      setError(errorMessage(e));
      setPhase('');
    } finally {
      setBusy(false);
      controller.current = null;
    }
  }
  return (
    <section className={current ? '' : 'mx-auto w-full max-w-5xl px-4 py-8 sm:px-6'}>
      {!current && (
        <PortalHeader title={admin ? 'Create Article' : 'New Submission'} admin={admin} />
      )}
      <div className={current ? '' : 'grid gap-6 lg:grid-cols-[2fr_1fr]'}>
        <form
          onSubmit={(event) => {
            void submit(event);
          }}
          className={`${panel} space-y-5`}
          aria-busy={busy}
        >
          <p className="text-sm leading-relaxed text-slate-500">
            Save your manuscript as a private draft.{' '}
            {admin
              ? 'After verification, review its details and publish.'
              : 'When you are ready, submit the saved draft for review.'}
          </p>
          <fieldset disabled={busy} className="space-y-5">
            <label className="block text-sm font-medium">
              Paper title
              <input
                required
                minLength={5}
                maxLength={300}
                className={`${field} mt-1`}
                value={input.title}
                onChange={(e) => change('title', e.target.value)}
              />
            </label>
            <label className="block text-sm font-medium">
              Abstract
              <textarea
                required
                minLength={30}
                maxLength={10000}
                rows={7}
                className={`${field} mt-1`}
                value={input.abstract}
                onChange={(e) => change('abstract', e.target.value)}
              />
            </label>
            <label className="block text-sm font-medium">
              Author names for publication
              <input
                required
                maxLength={1000}
                className={`${field} mt-1`}
                value={input.author_names}
                onChange={(e) => change('author_names', e.target.value)}
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                Use the names and order you want shown publicly.
              </span>
            </label>
            <label className="block text-sm font-medium">
              Category
              <select
                required
                className={`${field} mt-1`}
                value={input.category}
                onChange={(e) => change('category', e.target.value)}
              >
                <option value="">Select category</option>
                {categories.map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium">
              Keywords{' '}
              <span className="font-normal text-slate-500">
                (optional, up to 12, comma separated)
              </span>
              <input
                maxLength={600}
                className={`${field} mt-1`}
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
              />
            </label>
            <label className="block text-sm font-medium">
              Manuscript (PDF, DOC, DOCX)
              <input
                type="file"
                accept=".pdf,.doc,.docx"
                className={`${field} mt-1 file:mr-4 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1 file:text-brand-900`}
                onChange={(e) => {
                  setError('');
                  const selected = e.target.files?.[0] ?? null;
                  if (selected) {
                    try {
                      validateFile(selected);
                      setFile(selected);
                    } catch (error) {
                      setError(errorMessage(error));
                      setFile(null);
                      e.target.value = '';
                    }
                  } else setFile(null);
                }}
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                Maximum 20 MB.{' '}
                {saved?.current_file_id
                  ? 'Selecting a file creates a new immutable draft version.'
                  : 'You may save metadata first; a verified file is required before submitting.'}{' '}
                Basic file checks are not malware scanning.
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm font-normal">
              <input
                className="mt-1 h-4 w-4 shrink-0 accent-teal-600"
                type="checkbox"
                checked={input.publication_consent}
                onChange={(e) => change('publication_consent', e.target.checked)}
              />
              <span>
                I have permission to submit this work for publication. On acceptance, the title,
                abstract, listed authors, category, keywords, and selected manuscript file will be
                public.
              </span>
            </label>
          </fieldset>
          {file && (
            <p className="break-all text-xs text-slate-500">
              {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
            </p>
          )}
          {busy && (
            <div role="status" aria-live="polite">
              <p className="text-sm text-brand-900">{phase}</p>
              {progress !== null && (
                <>
                  <progress
                    className="mt-2 h-2 w-full accent-teal-600"
                    value={progress}
                    max={100}
                    aria-label="Manuscript upload progress"
                  />
                  <p className="text-xs text-slate-500">{progress}% uploaded</p>
                </>
              )}
            </div>
          )}
          {error && (
            <Feedback error>
              {error}
              {saved && (
                <span className="mt-1 block">
                  Draft {saved.id.slice(0, 8).toUpperCase()} is saved. You can retry without
                  retyping the fields.
                </span>
              )}
            </Feedback>
          )}
          <div className="flex flex-wrap gap-3">
            <button className={button} type="submit" disabled={busy}>
              {busy ? 'Saving…' : file ? 'Upload Paper / Save Draft' : 'Save Draft'}
            </button>
            {busy && controller.current && (
              <button
                type="button"
                className={secondary}
                onClick={() => controller.current?.abort()}
              >
                Cancel upload
              </button>
            )}
          </div>
        </form>
        {!current && <Resources />}
      </div>
    </section>
  );
}
