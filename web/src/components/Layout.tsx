import { Outlet } from 'react-router-dom';
import { AppBar } from './AppBar';
import { TabBar } from './TabBar';

/** Phone-first column: on a wider screen it stays a centred ~480 px column (docs/design.md). */
export function Layout() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col">
      <AppBar />
      <main className="flex-1 px-4 pb-28">
        <Outlet />
      </main>
      <TabBar />
    </div>
  );
}
