import { ApiError } from '../lib/api';

const BUTTON =
  'inline-flex min-h-10 cursor-pointer items-center rounded-full border border-line bg-transparent px-3.5 text-[13px] font-semibold text-text disabled:cursor-default disabled:opacity-60';

/**
 * The translate control of a post in English: "Traducir al español" until pressed, then a switch
 * between the translation and the original. The original always stays one press away, and an
 * error says what happened while the original stays visible.
 */
export function TranslateButton({
  translated,
  showOriginal,
  pending,
  error,
  blocked,
  onTranslate,
  onToggle,
}: {
  /** True once the Spanish text has arrived. */
  translated: boolean;
  showOriginal: boolean;
  pending: boolean;
  error: Error | null;
  /** The translation quota is spent: the button is off and says why. */
  blocked: boolean;
  onTranslate: () => void;
  onToggle: () => void;
}) {
  const quotaSpent = blocked || (error instanceof ApiError && error.status === 429);

  if (translated) {
    return (
      <>
        <button type="button" onClick={onToggle} className={BUTTON}>
          {showOriginal ? 'Ver traducción' : 'Ver original'}
        </button>
        {!showOriginal && <span className="text-[12px] text-text-3">Traducido con DeepL</span>}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={onTranslate}
        disabled={pending || quotaSpent}
        className={BUTTON}
      >
        {pending ? 'Traduciendo…' : 'Traducir al español'}
      </button>
      {quotaSpent && !error && (
        <span className="text-[12px] text-text-3">Crédito de traducción agotado.</span>
      )}
      {error && (
        <span role="alert" className="basis-full text-[12px] text-text-2">
          {error instanceof ApiError && error.detail
            ? error.detail
            : 'No se pudo traducir. El texto original sigue aquí.'}
        </span>
      )}
    </>
  );
}
