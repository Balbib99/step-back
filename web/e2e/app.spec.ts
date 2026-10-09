import { expect, test, type Page } from '@playwright/test';

// The five things the app is for, in a real browser, against the built app. The data is the
// recorded one plus three made-up games placed around now (e2e/server/e2e-server.ts):
//   - DEN at MIN, live, 58-61 (a favourite is playing)
//   - GS at POR, final, yesterday, with its recorded player numbers
//   - LAL at SAC, in three days

const LIVE_GAME = /Denver Nuggets 58, Minnesota Timberwolves 61/;

const tab = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name });

test('portada: the games of your teams come first, with the live score', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 2, name: 'Tus equipos' })).toBeVisible();
  const live = page.getByRole('article', { name: LIVE_GAME });
  await expect(live).toBeVisible();
  await expect(live).toContainText('Q3 4:12');
  // The page is set in its own typography, not the browser defaults.
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(14, 16, 21)');
});

test('calendario: today shows the game, and opening it gives the match page', async ({ page }) => {
  await page.goto('/');
  await tab(page, 'Calendario').click();

  await expect(page.getByRole('group', { name: 'Días de la semana' })).toBeVisible();
  await page.getByRole('link', { name: /^Ver el partido: .*Denver Nuggets 58/ }).click();

  await expect(page).toHaveURL(/\/partido\/e2e-live$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Partido' })).toBeVisible();
  await expect(page.getByText('Target Center')).toBeVisible();
});

test('partido: a finished game gives the numbers of each player, starters first and then the bench', async ({
  page,
}) => {
  await page.goto('/partido/e2e-final');

  const warriors = page.getByRole('group', { name: 'Estadísticas de Golden State Warriors' });
  await expect(warriors).toBeVisible();
  // The starters are cards: D. Terry had 23 points in 43 minutes, with 8 rebounds and 9 assists.
  const terry = warriors.getByRole('article', { name: 'Dalen Terry' });
  await expect(terry).toContainText('23');
  await expect(terry).toContainText('43 min');
  await expect(terry).toContainText('REB8AST9');
  await expect(terry).not.toContainText('MÁX'); // the top scorer of the team came off the bench
  // The bench is a list of rows: M. Kelly scored 24 off the bench.
  const kelly = warriors
    .getByRole('list', { name: 'Banquillo' })
    .getByRole('listitem', { name: 'Miles Kelly' });
  await expect(kelly).toContainText('24');
  await expect(kelly).toContainText('★ MÁX');

  await page.getByRole('button', { name: 'POR', exact: true }).click();
  await expect(
    page.getByRole('group', { name: 'Estadísticas de Portland Trail Blazers' }),
  ).toBeVisible();
});

test('clasificación: opens on the conference of your first team and switches', async ({ page }) => {
  await page.goto('/');
  await tab(page, 'Clasificación').click();

  // Minnesota is first among the favourites: the West.
  const west = page.getByRole('list', { name: 'Clasificación del Oeste' });
  await expect(west).toBeVisible();
  await expect(west.getByRole('listitem')).toHaveCount(15);
  await expect(west.getByRole('listitem', { name: /Minnesota Timberwolves/ })).toBeVisible();

  await page.getByRole('button', { name: 'Este', exact: true }).click();
  const east = page.getByRole('list', { name: 'Clasificación del Este' });
  await expect(east).toBeVisible();
  await expect(east.getByRole('listitem')).toHaveCount(15);
  await expect(page).toHaveURL(/conferencia=este/);
});

test('noticias: an English post is translated on demand and the original is one tap away', async ({
  page,
}) => {
  await page.goto('/noticias?equipo=todos');

  const toTranslate = page.getByRole('button', { name: 'Traducir al español' });
  await expect(toTranslate.first()).toBeVisible();
  // The button goes away once pressed, so find the post again by its title.
  const label = await page
    .getByRole('article')
    .filter({ has: toTranslate })
    .first()
    .getAttribute('aria-label');
  const post = page.getByRole('article', { name: label ?? '', exact: true });
  const title = post.getByRole('heading').first();
  // Not innerText: the page shortens long titles with "…" for the eye only.
  const original = (await title.textContent()) ?? '';

  await post.getByRole('button', { name: 'Traducir al español' }).click();

  await expect(post.getByRole('button', { name: 'Ver original' })).toBeVisible();
  await expect(title).toHaveText(`ES: ${original}`);
  await post.getByRole('button', { name: 'Ver original' }).click();
  await expect(title).toHaveText(original);
  await expect(post.getByRole('button', { name: 'Ver traducción' })).toBeVisible();
});

test('shorts: the short videos of a Spanish channel have their own view and play in the app', async ({
  page,
}) => {
  // The player is YouTube's: it is not reached from the tests, only asked for.
  await page.route('https://www.youtube-nocookie.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<p>player</p>' }),
  );
  const blocked: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) blocked.push(message.text());
  });

  await page.goto('/noticias');
  // The news do not mix the Shorts in.
  await expect(page.getByRole('article').first()).toBeVisible();
  await expect(page.getByRole('list', { name: 'Shorts' })).toHaveCount(0);

  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Shorts' }).click();
  const shorts = page.getByRole('list', { name: 'Shorts' });
  await expect(shorts).toBeVisible();
  await expect(page).toHaveURL(/vista=shorts/);
  await expect(shorts.getByRole('listitem')).toHaveCount(7);
  await expect(shorts.getByRole('listitem').first()).toContainText('Drafteados');

  // The newest Short of the recorded channel feed.
  await shorts
    .getByRole('button', { name: /Reproducir NIKOLA JOKIC VA A SER EL NUEVO MR/ })
    .click();
  const player = page.locator('iframe[title^="NIKOLA JOKIC"]');
  await expect(player).toBeVisible();
  await expect(player).toHaveAttribute(
    'src',
    /youtube-nocookie\.com\/embed\/vq3_0AVlrJM\?autoplay=1/,
  );

  await page.getByRole('button', { name: 'Cerrar' }).click();
  await expect(player).toHaveCount(0);
  expect(blocked).toEqual([]);
});

test('sin conexión: the app opens with what it had and says it is not live', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.getByRole('article', { name: LIVE_GAME })).toBeVisible();

  // The worker stores the app and the data it has just used; wait until it is in charge.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  await page.reload();
  await expect(page.getByRole('article', { name: LIVE_GAME })).toBeVisible();

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByRole('article', { name: LIVE_GAME })).toBeVisible();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: /Sin conexión/ })
      .first(),
  ).toBeVisible();

  await context.setOffline(false);
});
