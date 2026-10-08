import type { ReactNode } from 'react';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-6 fill-none stroke-current"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const HomeIcon = () => (
  <Icon>
    <path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />
  </Icon>
);
export const CalendarIcon = () => (
  <Icon>
    <rect x="4" y="5" width="16" height="15" rx="2" />
    <path d="M4 10h16M9 3v4M15 3v4" />
  </Icon>
);
export const StandingsIcon = () => (
  <Icon>
    <path d="M5 20V10M12 20V4M19 20v-7" />
  </Icon>
);
export const NewsIcon = () => (
  <Icon>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M8 9h8M8 13h8M8 17h5" />
  </Icon>
);
export const HighlightsIcon = () => (
  <Icon>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="M10 9.5l5 2.5-5 2.5z" />
  </Icon>
);
export const BellIcon = () => (
  <Icon>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" />
  </Icon>
);
