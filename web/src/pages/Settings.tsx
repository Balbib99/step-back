import { useState } from 'react';
import { REMINDER_OPTIONS, type TeamPushSettings } from '@step-back/shared';
import { BackLink } from '../components/BackLink';
import { EmptyState, PageHeader } from '../components/PageHeader';
import { TeamBadge } from '../components/TeamBadge';
import { useDevicePush, type DevicePush } from '../lib/push';
import { useConfig, usePushSettings, useSavePushSettings, useTeams } from '../lib/queries';

const SECTION_TITLE = 'voice-name mt-6 mb-2.5 text-xl';
const BUTTON =
  'inline-flex min-h-11 cursor-pointer items-center rounded-full border border-line bg-transparent px-4 text-sm font-semibold text-text disabled:cursor-default disabled:opacity-60';
const PRIMARY = BUTTON.replace('bg-transparent', 'bg-text').replace('text-text', 'text-ground');

const REMINDER_LABEL: Record<number, string> = {
  0: 'Sin aviso previo',
  15: '15 min antes',
  30: '30 min antes',
  60: '1 hora antes',
};

function DeviceCard({ device, publicKey }: { device: DevicePush; publicKey: string | null }) {
  const { permission, subscribed, busy, error, enable, disable, test } = device;
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string }>();

  let status: string;
  let action: React.ReactNode = null;
  if (permission === 'unsupported') {
    status =
      'Este navegador no admite notificaciones. Instala la aplicación en Android (Chrome, «Añadir a pantalla de inicio») y ábrela desde allí.';
  } else if (permission === 'denied') {
    status =
      'Has bloqueado las notificaciones de esta aplicación. Para activarlas, permítelas en los ajustes del navegador o del sistema.';
  } else if (subscribed === null) {
    status = 'Comprobando…';
  } else if (subscribed && permission === 'granted') {
    status = 'Las notificaciones están activadas en este dispositivo.';
    action = (
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={testing}
          className={BUTTON}
          onClick={() => {
            setTesting(true);
            setTestResult(undefined);
            void test().then((result) => {
              setTestResult(result);
              setTesting(false);
            });
          }}
        >
          {testing ? 'Enviando…' : 'Enviar notificación de prueba'}
        </button>
        <button type="button" onClick={() => void disable()} disabled={busy} className={BUTTON}>
          {busy ? 'Desactivando…' : 'Desactivar en este dispositivo'}
        </button>
      </div>
    );
  } else {
    status = 'Recibe un aviso al empezar y al terminar los partidos de tus equipos.';
    action = (
      <button
        type="button"
        onClick={() => void enable()}
        disabled={busy || !publicKey}
        className={PRIMARY}
      >
        {busy ? 'Activando…' : 'Activar notificaciones'}
      </button>
    );
  }

  return (
    <div className="grid gap-3 rounded-card bg-surface p-4">
      <p className="text-sm text-text-2">{status}</p>
      {action && <div>{action}</div>}
      {testResult && (
        <p role={testResult.ok ? 'status' : 'alert'} className="text-[13px] text-text-2">
          {testResult.message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-text-2">
          {error}
        </p>
      )}
    </div>
  );
}

function TeamRow({
  settings,
  name,
  onChange,
}: {
  settings: TeamPushSettings;
  name: string;
  onChange: (next: TeamPushSettings) => void;
}) {
  const { team } = settings;
  return (
    <li className="grid gap-3 rounded-card bg-surface p-4">
      <div className="flex items-center gap-3">
        <TeamBadge abbr={team} />
        <span className="text-sm font-semibold">{name}</span>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {(
          [
            ['start', 'Inicio del partido'],
            ['end', 'Resultado final'],
            ['news', 'Noticias destacadas'],
          ] as const
        ).map(([field, label]) => (
          <label key={field} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-5 accent-[var(--color-ok)]"
              checked={settings[field]}
              aria-label={`${label} de ${name}`}
              onChange={(event) => onChange({ ...settings, [field]: event.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
      <label className="flex items-center justify-between gap-3 text-sm">
        Recordatorio
        <select
          aria-label={`Recordatorio de ${name}`}
          value={settings.reminderMinutes}
          onChange={(event) =>
            onChange({
              ...settings,
              reminderMinutes: Number(event.target.value) as TeamPushSettings['reminderMinutes'],
            })
          }
          className="min-h-11 rounded-full border border-line bg-surface-2 px-3 text-sm text-text"
        >
          {REMINDER_OPTIONS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {REMINDER_LABEL[minutes]}
            </option>
          ))}
        </select>
      </label>
    </li>
  );
}

/** Every team that is not a favourite: game alerts only, off until asked. */
function OtherTeams({
  teams,
  names,
  onChange,
}: {
  teams: TeamPushSettings[];
  names: Map<string, string>;
  onChange: (next: TeamPushSettings[]) => void;
}) {
  const all = (on: boolean) => onChange(teams.map((t) => ({ ...t, start: on, end: on })));
  const active = teams.filter((t) => t.start || t.end).length;
  return (
    <details className="mt-3 rounded-card bg-surface p-4">
      <summary className="min-h-11 cursor-pointer text-sm font-semibold">
        Otros equipos{active > 0 ? ` · ${active} con avisos` : ''}
      </summary>
      <p className="mt-2 text-[13px] text-text-2">
        Inicio y resultado final de los partidos de cualquier equipo. Activar todos puede dar muchos
        avisos en una noche de partidos.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={BUTTON} onClick={() => all(true)}>
          Activar todos
        </button>
        <button type="button" className={BUTTON} onClick={() => all(false)}>
          Quitar todos
        </button>
      </div>
      <ul className="m-0 mt-2 grid list-none gap-1 p-0">
        {teams.map((settings) => {
          const name = names.get(settings.team) ?? settings.team;
          return (
            <li
              key={settings.team}
              className="flex items-center justify-between gap-3 border-t border-line py-1"
            >
              <span className="text-sm">{name}</span>
              <span className="flex shrink-0 gap-3">
                {(
                  [
                    ['start', 'Inicio', 'Inicio del partido'],
                    ['end', 'Final', 'Resultado final'],
                  ] as const
                ).map(([field, short, label]) => (
                  <label
                    key={field}
                    className="flex min-h-11 cursor-pointer items-center gap-1.5 text-[13px]"
                  >
                    <input
                      type="checkbox"
                      className="size-5 accent-[var(--color-ok)]"
                      checked={settings[field]}
                      aria-label={`${label} de ${name}`}
                      onChange={(event) =>
                        onChange([{ ...settings, [field]: event.target.checked }])
                      }
                    />
                    {short}
                  </label>
                ))}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

export function Settings() {
  const config = useConfig();
  const teams = useTeams();
  const pushOn = config.data?.features.push === true;
  const settings = usePushSettings(pushOn);
  const save = useSavePushSettings();
  const device = useDevicePush(config.data?.vapidPublicKey ?? null);

  const names = new Map((teams.data?.teams ?? []).map((team) => [team.abbr, team.name]));
  const favorites = config.data?.favoriteTeams ?? [];
  const all = settings.data?.teams ?? [];
  const favoriteSettings = all.filter((t) => favorites.includes(t.team));
  const otherSettings = all
    .filter((t) => !favorites.includes(t.team))
    .sort((a, b) => (names.get(a.team) ?? a.team).localeCompare(names.get(b.team) ?? b.team, 'es'));

  return (
    <>
      <BackLink />
      <PageHeader title="Ajustes" />

      <h2 className={SECTION_TITLE}>Notificaciones</h2>
      {config.isPending ? (
        <p role="status" className="text-sm text-text-3">
          Cargando…
        </p>
      ) : config.isError ? (
        <EmptyState>No se pudo cargar la configuración del servidor.</EmptyState>
      ) : !pushOn ? (
        <EmptyState>Las notificaciones no están activadas en el servidor.</EmptyState>
      ) : (
        <>
          <DeviceCard device={device} publicKey={config.data.vapidPublicKey} />

          <h2 className={SECTION_TITLE}>Qué avisar</h2>
          {settings.isError ? (
            <EmptyState>No se pudieron cargar los avisos. Inténtalo más tarde.</EmptyState>
          ) : (
            <>
              <ul className="m-0 grid list-none gap-3 p-0">
                {favoriteSettings.map((team) => (
                  <TeamRow
                    key={team.team}
                    settings={team}
                    name={names.get(team.team) ?? team.team}
                    onChange={(next) => save.mutate([next])}
                  />
                ))}
              </ul>
              <p className="mt-2 text-[13px] text-text-3">
                Las noticias destacadas son titulares de ESPN sobre tu equipo, con un máximo de 5 al
                día.
              </p>
              {otherSettings.length > 0 && (
                <OtherTeams
                  teams={otherSettings}
                  names={names}
                  onChange={(next) => save.mutate(next)}
                />
              )}
            </>
          )}
          {save.isError && (
            <p role="alert" className="mt-3 text-[13px] text-text-2">
              No se pudo guardar el cambio. Se ha restaurado el valor anterior.
            </p>
          )}
        </>
      )}
    </>
  );
}
