import { EmptyState, PageHeader } from '../components/PageHeader';
import { TeamBadge } from '../components/TeamBadge';
import { DEFAULT_TIME_ZONE, formatDayLabel } from '../lib/format';
import { useConfig } from '../lib/queries';

export function Today() {
  const { data: config, isError } = useConfig();
  const timeZone = config?.timeZone ?? DEFAULT_TIME_ZONE;

  return (
    <>
      <PageHeader title="Hoy" subtitle={formatDayLabel(new Date(), timeZone)} />
      <h2 className="voice-name mt-6 mb-2.5 text-xl">Tus equipos</h2>
      {isError ? (
        <EmptyState>
          No se pudo cargar tu configuración. Comprueba que el servidor está en marcha.
        </EmptyState>
      ) : config ? (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Equipos favoritos">
          {config.favoriteTeams.map((abbr) => (
            <li key={abbr}>
              <TeamBadge abbr={abbr} />
            </li>
          ))}
        </ul>
      ) : (
        <div aria-hidden="true" className="flex gap-2">
          {[0, 1, 2].map((slot) => (
            <span key={slot} className="h-9 w-16 rounded-card bg-surface-2" />
          ))}
        </div>
      )}
      <EmptyState>Aquí aparecerán los partidos de hoy, con tus equipos primero.</EmptyState>
    </>
  );
}
