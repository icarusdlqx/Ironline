import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 5183;
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOT_DIR ?? './reports/e2e';

const failures = [];
let checks = 0;

function check(name, condition, detail = '') {
  checks += 1;
  if (condition) {
    process.stdout.write(`  ✓ ${name}\n`);
    return true;
  }
  failures.push(`${name}${detail === '' ? '' : ` — ${detail}`}`);
  process.stdout.write(`  ✗ ${name}${detail === '' ? '' : ` — ${detail}`}\n`);
  return false;
}

async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // server not up yet
    }
    await sleep(250);
  }
  throw new Error(`dev server did not start at ${url}`);
}

const state = (page) => page.evaluate(() => globalThis.__ironline.useGame.getState());
const sim = (page) =>
  page.evaluate(() => {
    const { world } = globalThis.__ironline;
    return {
      tick: world.tick,
      finished: world.finished,
      winner: world.winner,
      entities: world.entities.map((entity) => ({
        id: entity.id,
        team: entity.team,
        autopilot: entity.autopilot,
        pos: { x: entity.pos.x, y: entity.pos.y },
        motion: entity.motion,
        heat: entity.heat,
        targetId: entity.targetId,
        pathLength: entity.path.length,
        hasMoveOrder: entity.orders.move !== null,
        attackTarget: entity.orders.attack?.targetId ?? null,
        calledShot: entity.orders.attack?.calledShot ?? null,
        groupEnabled: [...entity.groupEnabled],
        destroyed: entity.destroyed,
      })),
      visibleEnemies: world.vision === null ? null : [...world.vision.visible],
    };
  });

async function main() {
  mkdirSync(SHOTS, { recursive: true });

  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', (chunk) => process.stderr.write(chunk));

  // The sandbox image ships its own Chromium; Playwright's pinned revision is not present.
  const executablePath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
  const browser = await chromium.launch({
    executablePath: existsSync(executablePath) ? executablePath : undefined,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });

  try {
    await waitForServer(URL);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text());
    });

    await page.goto(URL);
    await page.waitForFunction(() => globalThis.__ironline !== undefined, { timeout: 30_000 });
    await page.waitForSelector('[data-testid="lance-bar"]');

    process.stdout.write('\nboot\n');
    const canvas = await page.locator('.viewport canvas').boundingBox();
    check('canvas is mounted at full size', (canvas?.width ?? 0) > 1000 && (canvas?.height ?? 0) > 700);
    check('no page errors during boot', pageErrors.length === 0, pageErrors.join(' | '));

    const boot = await sim(page);
    check('eight mechs deployed', boot.entities.length === 8, `got ${boot.entities.length}`);
    check(
      'player lance is under player control',
      boot.entities.filter((entity) => entity.team === 0).every((entity) => !entity.autopilot),
    );
    check(
      'opposing lance is on autopilot',
      boot.entities.filter((entity) => entity.team === 1).every((entity) => entity.autopilot),
    );

    await sleep(1200);
    const running = await sim(page);
    check('simulation advances', running.tick > boot.tick, `${boot.tick} → ${running.tick}`);
    await page.screenshot({ path: `${SHOTS}/01-boot.png` });

    process.stdout.write('\nselection\n');
    await page.locator('[data-testid="lance-bar"] button').first().click();
    check('lance card selects a mech', (await state(page)).selection.length === 1);
    await page.waitForSelector('[data-testid="paper-doll"]');
    check('paper doll renders eight locations', (await page.locator('.doll-cell').count()) === 8);
    check('heat bar renders', (await page.locator('[data-testid="heat-bar"]').count()) === 1);
    check(
      'weapon groups render with cooldown rings',
      (await page.locator('.cooldown-ring').count()) > 0,
    );
    await page.screenshot({ path: `${SHOTS}/02-selected.png` });

    process.stdout.write('\npause\n');
    await page.keyboard.press('Space');
    await page.waitForSelector('[data-testid="paused-banner"]');
    const pausedTick = (await sim(page)).tick;
    await sleep(900);
    const stillPaused = await sim(page);
    check('pause freezes the simulation', stillPaused.tick === pausedTick, `${pausedTick} → ${stillPaused.tick}`);
    check('pause banner is shown', (await page.locator('[data-testid="paused-banner"]').count()) === 1);

    process.stdout.write('\norders while paused\n');
    const selectedId = (await state(page)).selection[0];
    const box = await page.locator('.viewport canvas').boundingBox();
    await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.32, { button: 'right' });

    const afterOrder = await sim(page);
    const ordered = afterOrder.entities.find((entity) => entity.id === selectedId);
    check('right-click issues a move order while paused', ordered?.hasMoveOrder === true);
    check('a path was planned', (ordered?.pathLength ?? 0) > 0, `path length ${ordered?.pathLength}`);
    check(
      'simulation is still frozen after issuing orders',
      (await sim(page)).tick === pausedTick,
    );
    await page.screenshot({ path: `${SHOTS}/03-paused-order.png` });

    process.stdout.write('\nresume and move\n');
    await page.keyboard.press('Space');
    await sleep(1500);
    const moved = await sim(page);
    const mover = moved.entities.find((entity) => entity.id === selectedId);
    const start = afterOrder.entities.find((entity) => entity.id === selectedId);
    const travelled = Math.hypot(mover.pos.x - start.pos.x, mover.pos.y - start.pos.y);
    check('the ordered mech actually moves', travelled > 5, `travelled ${travelled.toFixed(1)}m`);
    check('resuming restarts the clock', moved.tick > pausedTick);

    process.stdout.write('\nweapon groups and hold fire\n');
    await page.locator('[data-testid="group-2"]').click();
    const toggled = await sim(page);
    check(
      'clicking a group toggles it off',
      toggled.entities.find((entity) => entity.id === selectedId).groupEnabled[1] === false,
    );
    await page.locator('[data-testid="command-hold_fire"]').click();
    const holding = await sim(page);
    check(
      'hold fire disables every group',
      holding.entities
        .find((entity) => entity.id === selectedId)
        .groupEnabled.every((enabled) => !enabled),
    );
    await page.locator('[data-testid="command-hold_fire"]').click();

    process.stdout.write('\ncalled shot\n');
    await page.locator('[data-testid="doll-left_leg"]').click();
    check('called shot mode arms from the paper doll', (await state(page)).orderMode === 'called_shot');
    check('called shot location is recorded', (await state(page)).calledShotLocation === 'left_leg');

    process.stdout.write('\ncamera\n');
    const before = await page.evaluate(() => {
      const { camera } = globalThis.__ironline.engine.renderer;
      return { x: camera.x, y: camera.y, zoom: camera.zoom };
    });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -600);
    await page.keyboard.down('ArrowRight');
    await sleep(400);
    await page.keyboard.up('ArrowRight');
    const after = await page.evaluate(() => {
      const { camera } = globalThis.__ironline.engine.renderer;
      return { x: camera.x, y: camera.y, zoom: camera.zoom };
    });
    check('wheel zooms the camera', after.zoom > before.zoom, `${before.zoom} → ${after.zoom}`);
    check('arrow keys pan the camera', after.x !== before.x, `${before.x} → ${after.x}`);

    process.stdout.write('\nfog of war\n');
    const fog = await sim(page);
    check(
      'fog hides at least some of the opposing lance at range',
      fog.visibleEnemies !== null && fog.visibleEnemies.length < 4,
      `${fog.visibleEnemies?.length ?? '?'} of 4 enemies visible`,
    );

    process.stdout.write('\nrun the battle to a conclusion\n');
    const outcome = await page.evaluate(async () => {
      const { engine } = globalThis.__ironline;
      const deadline = Date.now() + 25_000;
      while (!engine.world.finished && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        for (let step = 0; step < 400 && !engine.world.finished; step += 1) {
          engine.forceStep();
        }
      }
      return { finished: engine.world.finished, winner: engine.world.winner, tick: engine.world.tick };
    });

    check('battle reaches a conclusion', outcome.finished === true, JSON.stringify(outcome));
    await page.waitForSelector('[data-testid="outcome"]', { timeout: 5000 }).catch(() => {});
    check('outcome banner is shown', (await page.locator('[data-testid="outcome"]').count()) === 1);
    check('battle log recorded destructions', (await page.locator('[data-testid="event-log"] li').count()) > 0);
    await page.screenshot({ path: `${SHOTS}/04-outcome.png` });

    check('no page errors across the whole run', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }

  process.stdout.write(`\n${checks - failures.length}/${checks} checks passed\n`);
  if (failures.length > 0) {
    process.stdout.write(`\nFAILURES:\n${failures.map((line) => `  - ${line}`).join('\n')}\n`);
    process.exitCode = 1;
  }
}

await main();
