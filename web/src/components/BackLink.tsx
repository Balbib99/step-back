import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Back to where the viewer came from. When the screen was opened directly (a link, a reload, the
 * installed app) there is nothing behind it, so it goes to the home screen instead.
 */
export function BackLink({ label = 'Volver' }: { label?: string }) {
  const navigate = useNavigate();
  // The first screen of a session has the key "default"; any screen reached from another has its own.
  const hasHistory = useLocation().key !== 'default';
  return (
    <button
      type="button"
      onClick={() => (hasHistory ? navigate(-1) : navigate('/'))}
      className="-ml-2 mt-1 inline-flex min-h-10 cursor-pointer items-center gap-1 rounded-full border-0 bg-transparent px-2 text-sm font-semibold text-text-2"
    >
      <span aria-hidden="true">‹</span> {label}
    </button>
  );
}
