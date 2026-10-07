import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { CalendarIcon, HighlightsIcon, HomeIcon, NewsIcon, StandingsIcon } from './icons';

const TABS: { to: string; label: string; icon: ReactNode }[] = [
  { to: '/', label: 'Hoy', icon: <HomeIcon /> },
  { to: '/calendario', label: 'Calendario', icon: <CalendarIcon /> },
  { to: '/clasificacion', label: 'Clasificación', icon: <StandingsIcon /> },
  { to: '/noticias', label: 'Noticias', icon: <NewsIcon /> },
  { to: '/jugadas', label: 'Jugadas', icon: <HighlightsIcon /> },
];

export function TabBar() {
  return (
    <nav
      aria-label="Principal"
      className="fixed bottom-0 left-1/2 z-10 grid w-full max-w-[480px] -translate-x-1/2 grid-cols-5 border-t border-line bg-[#12151c] px-1 pt-1.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]"
    >
      {TABS.map(({ to, label, icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `grid min-h-[52px] content-center justify-items-center gap-0.5 text-[11px] font-semibold no-underline ${
              isActive ? 'text-text' : 'text-text-3'
            }`
          }
        >
          {({ isActive }) => (
            <>
              {icon}
              <span>{label}</span>
              {isActive && (
                <span aria-hidden="true" className="mt-px h-[3px] w-[18px] rounded-sm bg-text" />
              )}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
