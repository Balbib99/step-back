import { useEffect, type ReactNode } from 'react';
import type { Section } from '../lib/sources';
import { SourceNotice } from './SourceNotice';

/** Page title plus the document title, so the installed app and the browser tab both say where you are. */
export function PageHeader({
  title,
  subtitle,
  sources,
}: {
  title: string;
  subtitle?: ReactNode;
  /** The outside sources this screen lives off: if one is failing, the screen says so under the title. */
  sources?: readonly Section[];
}) {
  useEffect(() => {
    document.title = title === 'Hoy' ? 'step-back' : `${title} · step-back`;
  }, [title]);

  return (
    <div className="pt-1">
      <h1 className="voice-number text-[30px]">{title}</h1>
      {subtitle && <p className="mt-1 text-[13px] text-text-2">{subtitle}</p>}
      {sources && <SourceNotice sections={sources} />}
    </div>
  );
}

/** What to show when there is nothing yet: say what will be here and what to do meanwhile. */
export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="mt-8 rounded-card bg-surface p-4 text-sm text-text-2">{children}</p>;
}
