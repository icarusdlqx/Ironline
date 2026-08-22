import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';
import {
  checkBriefingInputSafety,
  checkDeployedInputSafety,
  clearControlFocus,
} from './input-safety.mjs';
import { runCampaignRecovery } from './campaign-recovery.mjs';
import { runMobilePlaythrough } from './mobile-playthrough.mjs';

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

async function arrowCameraShift(page, key) {
  const before = await page.evaluate(() => {
    const { engine, world } = globalThis.__ironline;
    const { camera, viewport } = engine.renderer;
    camera.centreOn({
      x: (world.terrain.width * world.terrain.tileSize) / 2,
      y: (world.terrain.height * world.terrain.tileSize) / 2,
    });
    camera.update(viewport);
    return { ...camera.target };
  });

  await clearControlFocus(page);
  await page.keyboard.down(key);
  await sleep(220);
  await page.keyboard.up(key);

  return page.evaluate((previousTarget) => {
    const { camera, viewport } = globalThis.__ironline.engine.renderer;
    camera.update(viewport);
    const previousOnScreen = camera.worldToScreen(previousTarget, viewport);
    return {
      x: previousOnScreen.x - viewport.width / 2,
      y: previousOnScreen.y - viewport.height / 2,
    };
  }, before);
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });

  // detached puts npx and vite in their own process group, so shutdown can
  // kill the group: signalling npx alone orphans vite, which keeps the stdio
  // pipes open and the finished script waiting forever to exit.
  // Worktrees share the dependency install during validation. Force Vite to
  // rebuild its root-specific dep graph so a prior worktree cannot leave React
  // optimized against a different source root.
  const server = spawn('npx', ['vite', '--force', '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
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

    check(
      'a fresh profile opens on training',
      (await page.evaluate(() => globalThis.__ironline.world.mission.id)) === 'training_ground',
    );
    await page.screenshot({ path: `${SHOTS}/00-training-briefing.png` });
    await page.locator('[data-testid="briefing-deploy"]').click();
    await page.waitForSelector('[data-testid="training-coach"]');
    await page.waitForSelector('[data-testid="lance-bar"]');
    await page.screenshot({ path: `${SHOTS}/00-training-coach.png` });
    await page.locator('[data-testid="choose-mission"]').click();
    await page.waitForSelector('[data-testid="briefing"]');
    await page.locator('[data-testid="mission-picker"]').selectOption('skirmish_ridge');
    await page.waitForFunction(() => globalThis.__ironline.world.mission.id === 'skirmish_ridge');

    process.stdout.write('\nboot\n');
    const canvas = await page.locator('.viewport canvas:not(.perf-overlay)').boundingBox();
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

    process.stdout.write('\nbriefing\n');
    await page.waitForSelector('[data-testid="briefing"]');
    check('the mission opens on a briefing', (await page.locator('[data-testid="briefing"]').count()) === 1);
    check(
      'the briefing lists the objectives',
      (await page.locator('[data-testid="briefing"] li').count()) >= 2,
    );
    const beforeBriefing = (await sim(page)).tick;
    await sleep(600);
    check('the sim is held while briefing', (await sim(page)).tick === beforeBriefing);
    await page.screenshot({ path: `${SHOTS}/01-boot.png` });

    await checkBriefingInputSafety({
      page,
      check,
      sim,
      state,
      beforeBriefing,
      shots: SHOTS,
    });

    const battleCode = page.locator('[data-testid="briefing-battle-code"]');
    await battleCode.fill('x');
    check(
      'an invalid Battle code blocks deployment',
      await page.locator('[data-testid="briefing-deploy"]').isDisabled(),
    );
    await battleCode.fill('Ridge Touch 0000002A');
    await page.locator('[data-testid="briefing-deploy"]').click();
    await sleep(1200);
    const running = await sim(page);
    check('deploying starts the clock', running.tick > beforeBriefing, `${beforeBriefing} → ${running.tick}`);
    check(
      'typing then tapping deploy locks the normalized Battle code',
      (await page.evaluate(() => globalThis.__ironline.useGame.getState().battleCode)) ===
        'ridge-touch-0000002a',
    );
    await checkDeployedInputSafety({ page, check, state });

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
    check(
      'tactical readouts expose ability, stability, alpha heat and governor state',
        (await page.locator('[data-testid="tactical-readout"]').count()) === 1 &&
        (await page.locator('[data-testid="stability-readout"]').innerText()).includes('/') &&
        (await page.locator('[data-testid="alpha-readout"]').innerText()).includes('%') &&
        (await page.locator('[data-testid="governor-readout"]').count()) === 1,
    );
    check(
      'ability and alpha commands show live readiness',
      (await page.locator('[data-testid="command-ability"]').innerText()).includes('READY') &&
        (await page.locator('[data-testid="command-alpha_strike"]').innerText()).includes('READY'),
    );
    await page.screenshot({ path: `${SHOTS}/02-selected.png` });

    process.stdout.write('\npause\n');
    await clearControlFocus(page);
    await page.keyboard.press('Space');
    await page.waitForSelector('[data-testid="paused-banner"]');
    const pausedTick = (await sim(page)).tick;
    await sleep(900);
    const stillPaused = await sim(page);
    check('pause freezes the simulation', stillPaused.tick === pausedTick, `${pausedTick} → ${stillPaused.tick}`);
    check('pause banner is shown', (await page.locator('[data-testid="paused-banner"]').count()) === 1);

    process.stdout.write('\norders while paused\n');
    const selectedId = (await state(page)).selection[0];
    const box = await page.locator('.viewport canvas:not(.perf-overlay)').boundingBox();
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

    // A click on a mech that wobbles a few pixels — a human hand, or a stalled
    // frame delivering a burst of pointer moves — must still be a click. It
    // once became an empty box-select that cleared the selection, after which
    // the destination order that followed did nothing at all, silently.
    const wobbleTarget = await page.evaluate(() => {
      const { engine, world, useGame } = globalThis.__ironline;
      const s = useGame.getState();
      s.setSelection([]);
      const mine = world.entities.filter((e) => e.team === s.playerTeam);
      const body = engine.renderer.screenBodyOf(mine[0]);
      const bounds = document
        .querySelector('.viewport canvas:not(.perf-overlay)')
        .getBoundingClientRect();
      return { id: mine[0].id, x: bounds.left + body.x, y: bounds.top + body.y };
    });
    await page.mouse.move(wobbleTarget.x, wobbleTarget.y);
    await page.mouse.down();
    await page.mouse.move(wobbleTarget.x + 9, wobbleTarget.y + 6);
    await page.mouse.up();
    const afterWobble = await state(page);
    check(
      'a wobbly click still selects the mech',
      afterWobble.selection.includes(wobbleTarget.id),
      JSON.stringify(afterWobble.selection),
    );

    await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.45, { button: 'right' });
    const afterWobbleOrder = await sim(page);
    const wobbleOrdered = afterWobbleOrder.entities.find((e) => e.id === wobbleTarget.id);
    check(
      'the destination order after a wobbly click lands with a route',
      wobbleOrdered?.hasMoveOrder === true && (wobbleOrdered?.pathLength ?? 0) > 0,
      `move ${wobbleOrdered?.hasMoveOrder}, path ${wobbleOrdered?.pathLength}`,
    );

    process.stdout.write('\nresume and move\n');
    await page.keyboard.press('Space');
    await sleep(1500);
    const moved = await sim(page);
    const mover = moved.entities.find((entity) => entity.id === selectedId);
    const start = afterOrder.entities.find((entity) => entity.id === selectedId);
    const travelled = Math.hypot(mover.pos.x - start.pos.x, mover.pos.y - start.pos.y);
    check('the ordered mech actually moves', travelled > 5, `travelled ${travelled.toFixed(1)}m`);
    check('resuming restarts the clock', moved.tick > pausedTick);

    process.stdout.write('\nformation move\n');
    await page.keyboard.press('Space');
    const formation = await page.evaluate(() => {
      const { engine, world, useGame } = globalThis.__ironline;
      const ids = world.entities.filter((entity) => entity.team === 0 && !entity.destroyed).map((entity) => entity.id);
      const centre = ids.reduce((sum, id) => {
        const entity = world.entities.find((candidate) => candidate.id === id);
        return { x: sum.x + entity.pos.x / ids.length, y: sum.y + entity.pos.y / ids.length };
      }, { x: 0, y: 0 });
      let destination = { x: 500, y: 500 };
      let best = Number.POSITIVE_INFINITY;
      for (let row = 3; row < world.terrain.height - 3; row += 1) {
        for (let column = 3; column < world.terrain.width - 3; column += 1) {
          let open = true;
          for (let y = -3; y <= 3 && open; y += 1) {
            for (let x = -3; x <= 3; x += 1) {
              if (!world.terrain.passable(column + x, row + y)) open = false;
            }
          }
          if (!open) continue;
          const candidate = world.terrain.tileCentre(column, row);
          const range = Math.hypot(candidate.x - centre.x, candidate.y - centre.y);
          const score = Math.abs(range - 120);
          if (score < best) {
            best = score;
            destination = candidate;
          }
        }
      }
      useGame.getState().setSelection(ids);
      engine.orderMove(destination, false);
      return ids.map((id) => world.entities.find((entity) => entity.id === id)?.orders.move?.to);
    });
    check(
      'a group move gives every mech a distinct destination',
      new Set(formation.map((point) => `${point?.x.toFixed(1)}:${point?.y.toFixed(1)}`)).size === formation.length,
      JSON.stringify(formation),
    );
    await page.screenshot({ path: `${SHOTS}/03-formation-order.png` });
    await page.evaluate((id) => globalThis.__ironline.useGame.getState().setSelection([id]), selectedId);
    await page.keyboard.press('Space');

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
    const zoomPointer = { x: box.width * 0.72, y: box.height * 0.46 };
    const before = await page.evaluate((screen) => {
      const { renderer } = globalThis.__ironline.engine;
      return {
        target: { ...renderer.camera.target },
        distance: renderer.camera.distance,
        anchor: renderer.camera.screenToWorld(
          screen,
          renderer.viewport,
          renderer.groundMesh,
        ),
      };
    }, zoomPointer);
    await page.mouse.move(box.x + zoomPointer.x, box.y + zoomPointer.y);
    await page.mouse.wheel(0, -600);
    const afterZoom = await page.evaluate((screen) => {
      const { renderer } = globalThis.__ironline.engine;
      return {
        target: { ...renderer.camera.target },
        distance: renderer.camera.distance,
        anchor: renderer.camera.screenToWorld(
          screen,
          renderer.viewport,
          renderer.groundMesh,
        ),
      };
    }, zoomPointer);
    // Zooming in pulls the eye closer: wheel-up shrinks the camera distance.
    check(
      'wheel zooms the camera',
      afterZoom.distance < before.distance,
      `${before.distance} → ${afterZoom.distance}`,
    );
    check(
      'wheel zoom keeps the ground under the pointer',
      Math.hypot(
        afterZoom.anchor.x - before.anchor.x,
        afterZoom.anchor.y - before.anchor.y,
      ) < 1,
    );
    const arrowShifts = {
      ArrowLeft: await arrowCameraShift(page, 'ArrowLeft'),
      ArrowRight: await arrowCameraShift(page, 'ArrowRight'),
      ArrowUp: await arrowCameraShift(page, 'ArrowUp'),
      ArrowDown: await arrowCameraShift(page, 'ArrowDown'),
    };
    check(
      'left arrow moves the view left',
      arrowShifts.ArrowLeft.x > 5 && Math.abs(arrowShifts.ArrowLeft.y) < 1,
      JSON.stringify(arrowShifts.ArrowLeft),
    );
    check(
      'right arrow moves the view right',
      arrowShifts.ArrowRight.x < -5 && Math.abs(arrowShifts.ArrowRight.y) < 1,
      JSON.stringify(arrowShifts.ArrowRight),
    );
    check(
      'up arrow moves the view up',
      arrowShifts.ArrowUp.y > 5 && Math.abs(arrowShifts.ArrowUp.x) < 1,
      JSON.stringify(arrowShifts.ArrowUp),
    );
    check(
      'down arrow moves the view down',
      arrowShifts.ArrowDown.y < -5 && Math.abs(arrowShifts.ArrowDown.x) < 1,
      JSON.stringify(arrowShifts.ArrowDown),
    );

    const centreError = async () =>
      page.evaluate(() => {
        const { engine, useGame, world } = globalThis.__ironline;
        const selected = new Set(useGame.getState().selection);
        const units = world.entities.filter((entity) => selected.has(entity.id));
        const sum = units.reduce(
          (point, entity) => ({ x: point.x + entity.pos.x, y: point.y + entity.pos.y }),
          { x: 0, y: 0 },
        );
        const expected = { x: sum.x / units.length, y: sum.y / units.length };
        return {
          error: Math.hypot(
            engine.renderer.camera.target.x - expected.x,
            engine.renderer.camera.target.y - expected.y,
          ),
          tolerance: world.terrain.tileSize * 4,
        };
      });
    await page.locator('[data-testid="centre-selection"]').click();
    const buttonCentre = await centreError();
    check('centre button finds the selection', buttonCentre.error < buttonCentre.tolerance);

    process.stdout.write('\nfog of war\n');
    const fog = await sim(page);
    check(
      'fog hides at least some of the opposing lance at range',
      fog.visibleEnemies !== null && fog.visibleEnemies.length < 4,
      `${fog.visibleEnemies?.length ?? '?'} of 4 enemies visible`,
    );

    process.stdout.write('\nrun the battle to a conclusion\n');
    await page.locator('[data-testid="feedback-link"]').focus();
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
    check('battle debrief is shown', (await page.locator('.battle-results').count()) === 1);
    await page.waitForFunction(() => document.activeElement?.classList.contains('battle-results'));
    check(
      'battle debrief receives focus without skipping its report',
      await page.evaluate(() => document.activeElement?.classList.contains('battle-results')),
    );
    const debriefInputBefore = await page.evaluate(() => {
      const { engine, useGame } = globalThis.__ironline;
      return {
        paused: useGame.getState().paused,
        orderMode: useGame.getState().orderMode,
        camera: { ...engine.renderer.camera.target },
      };
    });
    await page.keyboard.press('Space');
    await page.keyboard.down('ArrowRight');
    await sleep(120);
    await page.keyboard.up('ArrowRight');
    const debriefInputAfter = await page.evaluate(() => {
      const { engine, useGame } = globalThis.__ironline;
      return {
        paused: useGame.getState().paused,
        orderMode: useGame.getState().orderMode,
        camera: { ...engine.renderer.camera.target },
      };
    });
    check(
      'battle controls stay suspended behind the debrief',
      JSON.stringify(debriefInputAfter) === JSON.stringify(debriefInputBefore),
    );
    await page.keyboard.press('Tab');
    check(
      'battle debrief tabs into its first action',
      (await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))) ===
        'replay-mission',
    );
    await page.locator('[data-testid="choose-mission"]').focus();
    await page.keyboard.press('Tab');
    check(
      'battle debrief traps forward focus',
      (await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))) ===
        'replay-mission',
    );
    await page.keyboard.press('Shift+Tab');
    check(
      'battle debrief traps reverse focus',
      (await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))) ===
        'choose-mission',
    );
    check(
      'the debrief reports battle and lance statistics',
      (await page.locator('.battle-results-summary > div').count()) === 4 &&
        (await page.locator('.battle-results-row').count()) === 5,
    );
    check(
      'skirmish debrief offers replay or another briefing',
      (await page.locator('[data-testid="replay-mission"]').count()) === 1 &&
        (await page.locator('[data-testid="choose-mission"]').count()) === 1,
    );
    check('battle log recorded destructions', (await page.locator('[data-testid="event-log"] li').count()) > 0);
    await page.screenshot({ path: `${SHOTS}/04-outcome.png` });
    await page.evaluate(() => localStorage.clear());

    process.stdout.write('\nobjectives and support\n');
    await page.locator('[data-testid="result-mission-picker"]').selectOption('base_capture_ridge');
    await page.locator('[data-testid="choose-mission"]').click();
    await page.waitForSelector('[data-testid="briefing"]');
    check(
      'closing the battle debrief returns focus',
      (await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))) ===
        'feedback-link',
    );
    check(
      'switching mission shows its briefing',
      (await page.locator('[data-testid="briefing"] h2').innerText()).includes('Base Capture'),
    );
    await page.locator('[data-testid="briefing-deploy"]').click();
    await page.waitForSelector('[data-testid="objective-list"]');

    const mission = await page.evaluate(() => {
      const { world } = globalThis.__ironline;
      return {
        id: world.mission.id,
        zones: world.zones.length,
        objectives: world.objectives.length,
        triggers: world.triggers.length,
        rp: world.resources.get(0),
        reserves: world.reserves.length,
        reserveCost: world.rules.support.reinforcement.cost,
      };
    });
    check('the base capture mission is loaded', mission.id === 'base_capture_ridge', mission.id);
    check(
      'deployed setup is locked until the run is left explicitly',
      (await page.locator('[data-testid="setup-locked"]').count()) === 1 &&
        (await page.locator('[data-testid="mission-picker"]').isDisabled()) &&
        (await page.locator('[data-testid="difficulty-picker"]').isDisabled()),
    );
    await page.evaluate(() => {
      globalThis.__setupEngine = globalThis.__ironline.engine;
    });
    await page.locator('[data-testid="restart-battle"]').click();
    await page.waitForFunction(
      () =>
        globalThis.__ironline.engine !== globalThis.__setupEngine &&
        globalThis.__ironline.engine.world.mission.id === 'base_capture_ridge',
    );
    const restarted = await page.evaluate(() => {
      delete globalThis.__setupEngine;
      const state = globalThis.__ironline.useGame.getState();
      return { briefingSeen: state.briefingSeen, paused: state.paused };
    });
    check(
      'restart redeploys the same setup immediately',
      restarted.briefingSeen && !restarted.paused,
    );
    check('it has two comm posts and three objectives', mission.zones === 2 && mission.objectives === 3);
    check('the objective tracker is on screen', (await page.locator('[data-testid="objective-list"] li').count()) >= 3);
    check('the zone tracker lists both posts', (await page.locator('[data-testid="zone-list"] li').count()) === 2);
    check('resource points are shown', (await page.locator('[data-testid="resource-points"]').innerText()).includes('RP'));
    // A mission reserve replaces the probe rather than growing a fourth button.
    check('exactly three support calls are offered', (await page.locator('.support-call').count()) === 3);
    check(
      'the authored reserve reaches the support palette',
      (await page.locator('[data-testid="support-reinforcement"]').count()) === 1 &&
        (await page.locator('[data-testid="support-air_strike"]').count()) === 1 &&
        (await page.locator('[data-testid="support-repair_truck"]').count()) === 1 &&
        (await page.locator('[data-testid="support-sensor_probe"]').count()) === 0,
    );
    const reserveCopy = await page.locator('[data-testid="support-reinforcement"]').innerText();
    check(
      'support cost and effect are visible without a tooltip',
      reserveCopy.includes(`${mission.reserveCost} RP`) && reserveCopy.includes('Drop one mission reserve'),
      reserveCopy,
    );

    const rpText = async () =>
      Number((await page.locator('[data-testid="resource-points"]').innerText()).replace(/[^0-9]/g, ''));
    const rpBefore = await rpText();

    const canvasBox = await page.locator('.viewport canvas:not(.perf-overlay)').boundingBox();
    // Report rather than hang: a disabled button times the click out after
    // thirty seconds and kills the run, which says nothing about why.
    // The truck costs 500, so the mission pool has to cover it — the check
    // follows the authored value rather than pinning a number that will drift.
    check(
      'the mission resource points reached the HUD',
      rpBefore === mission.rp && mission.rp >= 500,
      `${rpBefore} RP in the palette, ${mission.rp} in the world`,
    );

    await page.locator('[data-testid="support-air_strike"]').click();
    await page.mouse.move(canvasBox.x + canvasBox.width * 0.62, canvasBox.y + canvasBox.height * 0.36);
    await page.screenshot({ path: `${SHOTS}/09-support-lane.png` });
    await page.evaluate(() => globalThis.__ironline.useGame.getState().setSupportMode(null));

    // The repair truck fires on the press; the air strike wants a drag for
    // its run-in, so the truck is the one the pointer test drives.
    await page.locator('[data-testid="support-repair_truck"]').click({ timeout: 5_000 });
    check('picking a support call arms it', (await state(page)).supportMode === 'repair_truck');
    check(
      'the armed call explains placement in the palette',
      (await page.locator('[data-testid="support-repair_truck"]').innerText()).includes('Armed'),
    );
    await page.mouse.move(canvasBox.x + canvasBox.width * 0.55, canvasBox.y + canvasBox.height * 0.4);
    await page.screenshot({ path: `${SHOTS}/09-support-radius.png` });
    await page.mouse.click(canvasBox.x + canvasBox.width * 0.55, canvasBox.y + canvasBox.height * 0.4);

    const truckCost = 500;
    const afterCall = await page.evaluate(() => {
      const { world } = globalThis.__ironline;
      return { rp: world.resources.get(0), pending: world.support.pending.length };
    });
    check('calling the truck spends resource points', afterCall.rp === mission.rp - truckCost, `${mission.rp} → ${afterCall.rp}`);
    check('the call is queued with a delay', afterCall.pending === 1);
    await page.waitForFunction(
      (before) => Number(document.querySelector('[data-testid="resource-points"]')?.textContent?.replace(/[^0-9]/g, '')) < before,
      rpBefore,
    );
    check('the HUD reflects the spend', (await rpText()) < rpBefore);
    await page.screenshot({ path: `${SHOTS}/09-support.png` });

    const resolvedCall = await page.evaluate(async () => {
      const { engine } = globalThis.__ironline;
      for (let step = 0; step < 200; step += 1) engine.forceStep();
      return engine.world.support.pending.length;
    });
    check('the call resolves after its delay', resolvedCall === 0);

    const supportOutcome = await page.evaluate(async () => {
      const { engine } = globalThis.__ironline;
      const world = engine.world;
      const calls = ['air_strike', 'repair_truck', 'reinforcement'];
      const mod = await import('/src/sim/support.ts');
      world.resources.set(0, 20000);
      const results = {};
      for (const call of calls) {
        const enemy = world.entities.find((e) => e.team === 1 && !e.destroyed);
        const point = enemy ? { x: enemy.pos.x, y: enemy.pos.y } : { x: 500, y: 500 };
        results[call] = mod.callSupport(world, 0, call, point, 0).ok;
      }
      // Resolution and damage are pinned by the sim's own mission tests;
      // here it is enough that every offered call is accepted and resolves.
      for (let step = 0; step < 400 && !world.finished; step += 1) engine.forceStep();
      return { results, pending: world.support.pending.length };
    });
    check(
      'air strike, repair truck and reinforcement were all accepted',
      Object.values(supportOutcome.results).every(Boolean),
      JSON.stringify(supportOutcome.results),
    );
    check('every accepted call resolved', supportOutcome.pending === 0);

    const triggered = await page.evaluate(async () => {
      const { engine } = globalThis.__ironline;
      const world = engine.world;
      const zone = world.zones.find((z) => z.id === 'south_post');
      for (const entity of world.entities) {
        if (entity.team === 0) entity.pos = { x: zone.x, y: zone.y };
        else entity.pos = { x: 30, y: 30 };
      }
      const enemiesBefore = world.entities.filter((e) => e.team === 1).length;
      for (let step = 0; step < 400 && !world.finished; step += 1) engine.forceStep();
      return {
        owner: world.zones.find((z) => z.id === 'south_post').owner,
        enemiesBefore,
        enemiesAfter: world.entities.filter((e) => e.team === 1).length,
        spawnLog: globalThis.__ironline.useGame.getState().log.join(' | '),
      };
    });
    check('holding a comm post captures it', triggered.owner === 0);
    check(
      'capturing the south post calls in the relief lance',
      triggered.enemiesAfter === triggered.enemiesBefore + 2,
      `${triggered.enemiesBefore} → ${triggered.enemiesAfter}`,
    );
    // The engine drains world.events into the renderer each step, so the visible
    // battle log is the durable record of what the trigger announced.
    check(
      'the relief lance was announced to the player',
      /relief lance/i.test(triggered.spawnLog),
      triggered.spawnLog.slice(0, 120),
    );
    await page.screenshot({ path: `${SHOTS}/10-objectives.png` });

    process.stdout.write('\nmechbay\n');
    await page.locator('[data-testid="choose-mission"]').click();
    await page.waitForSelector('[data-testid="briefing"]');
    await page.locator('[data-testid="open-mechbay"]').click();
    await page.waitForSelector('[data-testid="mechbay"]');

    check('mechbay shows all eight locations', (await page.locator('.bay-location').count()) === 8);
    check(
      'the starting build is legal',
      (await page.locator('[data-testid="bay-status"]').innerText()).includes('legal') &&
        !(await page.locator('[data-testid="bay-save"]').isDisabled()),
    );
    check(
      'heat efficiency shows alpha strike and sustained heat',
      (await page.locator('[data-testid="heat-alpha"]').innerText()).length > 0 &&
        (await page.locator('[data-testid="heat-sustained"]').innerText()).includes('/s'),
    );
    check(
      'the mechbay renders the battlefield machine and visual weapon comparisons',
      (await page.locator('[data-testid="mech-preview-canvas"]').count()) === 1 &&
        (await page.locator('.weapon-card').first().locator('[role="meter"]').count()) === 3 &&
        (await page.locator('.weapon-glyph').count()) > 0,
    );
    await page.screenshot({ path: `${SHOTS}/05-mechbay-overview.png` });

    const freeTonnage = async () =>
      Number((await page.locator('[data-testid="free-tonnage"]').innerText()).replace('t', ''));
    const startingFree = await freeTonnage();

    // Picking a location narrows the shelf to that hardpoint. Window-shopping
    // remains possible, but an incompatible card cannot be armed or dragged.
    check(
      'the shelf hides weapons the hull cannot mount',
      (await page.locator('[data-testid="stock-weapon-gauss_rifle"]').count()) === 0,
    );
    await page.locator('[data-testid="bay-location-right_torso"] .bay-location-name').click();
    check(
      'selecting a hardpoint filters the shelf to that mount',
      (await page.locator('[data-testid="bay-location-filter"]').innerText()).toLowerCase().includes('right torso') &&
        (await page.locator('.weapon-card.is-unavailable').count()) === 0,
    );
    await page.locator('[data-testid="shelf-show-all"]').check();
    const incompatibleGauss = page.locator('[data-testid="stock-weapon-gauss_rifle"]');
    check(
      'showing incompatible weapons explains rather than offering them',
      (await incompatibleGauss.getAttribute('aria-disabled')) === 'true' &&
        (await incompatibleGauss.getAttribute('title'))?.includes('Right Torso'),
    );
    await page.locator('[data-testid="shelf-show-all"]').uncheck();

    // Native buttons make the same pick-then-place path work from a keyboard.
    const mediumLaser = page.locator('[data-testid="stock-weapon-medium_laser"]');
    await mediumLaser.focus();
    await page.keyboard.press('Enter');
    check(
      'a keyboard pick arms only compatible hardpoints',
      (await page.locator('[data-testid="bay-armed"]').count()) === 1 &&
        (await page.locator('.bay-location.armed-target').count()) === 1 &&
        (await page.locator('[data-testid="bay-location-right_torso"].armed-target').count()) === 1,
    );
    await page.locator('[data-testid="bay-location-right_torso"]').click();

    const afterDrag = await freeTonnage();
    check('keyboard pick-to-hardpoint mounts the weapon', afterDrag < startingFree, `${startingFree}t → ${afterDrag}t`);
    check('an illegal build reports its problems', (await page.locator('[data-testid="bay-issues"] li').count()) > 0);
    await page.screenshot({ path: `${SHOTS}/05-mechbay-illegal.png` });
    check('save is refused for an illegal build', await page.locator('[data-testid="bay-save"]').isDisabled());
    check('export is refused for an illegal build', await page.locator('[data-testid="bay-export"]').isDisabled());

    const blocked = await page.evaluate(() => {
      const button = document.querySelector('[data-testid="bay-save"]');
      const before = Object.keys(localStorage).length;
      button.click();
      return { added: Object.keys(localStorage).length - before };
    });
    check('clicking a disabled save writes nothing to storage', blocked.added === 0);

    await page
      .locator('[data-testid="bay-location-right_torso"] .slot-block.tone-energy button')
      .last()
      .click();
    check('removing the weapon restores a legal build', !(await page.locator('[data-testid="bay-save"]').isDisabled()));
    check('free tonnage returns to its starting value', (await freeTonnage()) === startingFree);

    // Desktop drag-and-drop uses the same fit predicate and remains available
    // alongside the touch/keyboard grammar.
    await page
      .locator('[data-testid="stock-weapon-medium_laser"]')
      .dragTo(page.locator('[data-testid="bay-location-right_torso"]'));
    check(
      'drag-to-hardpoint uses the same legal mount path',
      (await freeTonnage()) < startingFree,
    );
    await page
      .locator('[data-testid="bay-location-right_torso"] .slot-block.tone-energy button')
      .last()
      .click();
    check('dragged weapon can be removed cleanly', (await freeTonnage()) === startingFree);

    // Per-location armour lives behind a disclosure now; the everyday control
    // is one slider for the whole machine.
    await page.locator('[data-testid="armour-detail"] summary').click();
    await page.locator('[data-testid="armour-head"]').fill('0');
    check('the armour slider frees tonnage', (await freeTonnage()) > startingFree);
    await page.locator('[data-testid="max-armour"]').click();
    check(
      'spending the remainder on armour keeps the build legal',
      !(await page.locator('[data-testid="bay-save"]').isDisabled()),
    );

    await page.locator('[data-testid="bay-save"]').click();
    const saved = await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith('ironline.design.')),
    );
    check('a legal build saves to storage', saved.length > 0, saved.join(','));
    check(
      'saving reports success',
      (await page.locator('[data-testid="bay-status"]').innerText()).startsWith('Saved'),
    );

    await page.screenshot({ path: `${SHOTS}/06-mechbay-legal.png` });
    await page.locator('[data-testid="bay-exit"]').click();
    await page.waitForSelector('[data-testid="briefing"]');
    check('returning to the skirmish remounts the battle', (await page.locator('.viewport canvas:not(.perf-overlay)').count()) === 1);

    process.stdout.write('\ncampaign\n');
    await page.evaluate(() => localStorage.clear());
    await page.locator('[data-testid="open-campaign"]').click();
    await page.waitForSelector('[data-testid="campaign"]');

    const day = async () =>
      Number((await page.locator('[data-testid="camp-day"]').innerText()).replace('Day ', ''));
    const cash = async () =>
      Number(
        (await page.locator('[data-testid="camp-cbills"]').innerText()).replace(/[^0-9-]/g, ''),
      );

    const campaignNodeIds = await page.locator('.camp-node').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-testid')?.replace('camp-node-', '') ?? ''),
    );
    const expectedCampaignNodeIds = [
      'militia_raid',
      'pass_skirmish',
      'supply_line',
      'ridge_hold',
      'causeway_push',
      'foundry_sweep_node',
      'shale_overwatch_node',
      'depot_burn',
      'depot_take',
    ];
    check(
      'campaign map draws the four-act route and both depot endings',
      campaignNodeIds.length === expectedCampaignNodeIds.length &&
        expectedCampaignNodeIds.every((id) => campaignNodeIds.includes(id)),
      campaignNodeIds.join(', '),
    );
    check('only the opening node is available', (await page.locator('.camp-node.available').count()) === 1);
    check('the lance is on the books', (await page.locator('[data-testid="camp-bay"] li').count()) === 4);
    // Count the company's own pilots, not every row in the section — the
    // hiring hall lives under the same panel and lists whoever is signable.
    check(
      'the barracks lists four pilots',
      (await page.locator('li[data-testid^="camp-pilot-"]').count()) === 4,
    );
    check('stores start empty', (await page.locator('[data-testid="camp-store"] .empty').count()) === 1);

    const firstRunCode = await page.locator('[data-testid="camp-seed"]').innerText();
    check(
      'a new campaign exposes a readable run code',
      /^Run [a-z]+-[a-z]+-[0-9a-f]{8}$/.test(firstRunCode),
      firstRunCode,
    );
    await page.locator('[data-testid="camp-restart"]').click();
    const restartedCode = await page.locator('[data-testid="camp-seed"]').innerText();
    const persistedRun = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('ironline.campaign')).state.seed,
    );
    check('restart rolls a fresh run code', restartedCode !== firstRunCode, restartedCode);
    check('the fresh run is saved immediately', restartedCode === `Run ${persistedRun}`);

    await runCampaignRecovery({ page, shots: SHOTS, check });

    await page.locator('[data-testid="camp-manual-toggle"]').click();
    await page.waitForSelector('[data-testid="manual-controls"]');
    check(
      'the field manual takes keyboard focus',
      await page.locator('[data-testid="camp-manual-close"]').evaluate(
        (element) => element === document.activeElement,
      ),
    );
    const manualText = await page.locator('[data-testid="camp-manual"]').textContent();
    check(
      'the field manual carries desktop, touch and support controls',
      manualText.includes('Mouse and keyboard') &&
        manualText.includes('Touch') &&
        manualText.includes('Support calls'),
    );
    check(
      'the manual names only the current camera grammar',
      manualText.includes('Arrow keys') && !manualText.includes('WASD'),
    );
    await page.screenshot({ path: `${SHOTS}/08-field-manual.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${SHOTS}/08-field-manual-touch.png` });
    await page.keyboard.press('Escape');
    check(
      'Escape closes the manual and returns focus',
      (await page.locator('[data-testid="camp-manual"]').count()) === 0 &&
        (await page.locator('[data-testid="camp-manual-toggle"]').evaluate(
          (element) => element === document.activeElement,
        )),
    );
    await page.setViewportSize({ width: 1440, height: 900 });

    const offerFor = async (termsId) => {
      const choice = page.locator(`[data-testid="camp-terms-${termsId}"]`);
      await choice.click();
      return choice.evaluate((element) => element.closest('label')?.innerText ?? '');
    };
    const payoutHeavy = await offerFor('fee_first');
    const salvageHeavy = await offerFor('salvage_first');
    const selectedTermsText = await page.locator('[data-testid="camp-contract"]').innerText();
    check(
      'named packages trade payout against salvage',
      payoutHeavy !== salvageHeavy &&
        payoutHeavy.includes('0% salvage') &&
        !salvageHeavy.includes('0% salvage'),
      `${payoutHeavy} vs ${salvageHeavy}`,
    );
    check(
      'contract terms name success pay, field clock and wage exposure',
      selectedTermsText.includes('on success only') &&
        selectedTermsText.includes('clock') &&
        selectedTermsText.includes('maximum through deadline'),
      selectedTermsText,
    );
    await page.screenshot({ path: `${SHOTS}/08-contract-terms.png` });

    const posted = await page.locator('[data-testid="camp-hall"] li').count();
    check('the hiring hall is posting work', posted > 0, `${posted} postings`);
    const postingFacts = await page.locator('[data-testid="camp-hall"] button').first().innerText();
    check(
      'a posting states its battlefield and rated opposition',
      postingFacts.includes('drop /') && postingFacts.includes('rated opposition'),
      postingFacts,
    );
    check(
      'the board states when it renews',
      (await page.locator('[data-testid="camp-hall"] .hall-note').innerText()).includes(
        'New work arrives on day',
      ),
    );

    // Selecting a posting has to drive the same contract panel the map does,
    // or side work would be visible and unsignable.
    const hallName = await page.locator('[data-testid="camp-hall"] .hall-name').first().innerText();
    await page.locator('[data-testid="camp-hall"] button').first().click();
    const shown = await page.locator('[data-testid="camp-contract"] h3').innerText();
    // Case-insensitive: the panel heading is uppercased in CSS, not in the DOM.
    check(
      'a posting drives the contract panel',
      shown.toLowerCase() === hallName.toLowerCase(),
      `${shown} vs ${hallName}`,
    );

    const dayBefore = await day();
    await page.locator('[data-testid="camp-advance"]').click();
    check('advancing a day moves the clock', (await day()) === dayBefore + 1);

    // Back to the war for the rest of the run: the authored node is the one
    // whose payout, salvage and unlocks the later checks are written against.
    await page.locator('[data-testid="camp-node-militia_raid"]').click();

    await page.locator('[data-testid="camp-terms-salvage_first"]').click();
    await page.locator('[data-testid="camp-accept"]').click();
    check('signing shows the active contract', (await page.locator('[data-testid="camp-deploy"]').count()) === 1);
    check(
      'the active contract preserves its named package',
      (await page.locator('[data-testid="camp-active-terms"]').textContent()) === 'Salvage first',
    );

    await page.locator('[data-testid="camp-save"]').click();
    const savedCampaign = await page.evaluate(() => localStorage.getItem('ironline.campaign'));
    check('the campaign saves to storage', savedCampaign !== null && savedCampaign.length > 100);

    const cashBefore = await cash();
    // Deploying walks the prep corridor: the hangar first — repairs and
    // refits — then the manifest, and launching from it starts the drop.
    await page.locator('[data-testid="camp-deploy"]').click();
    await page.waitForSelector('[data-testid="hangar-stage"]');
    check(
      'the hangar stage lists the company machines',
      (await page.locator('[data-testid^="hangar-"][data-testid*="mech_"]').count()) > 0 ||
        (await page.locator('.hangar .manifest-row').count()) > 0,
    );
    await page.locator('[data-testid="hangar-continue"]').click();
    await page.waitForSelector('[data-testid="lance-manifest"]');
    // Five rated bars per pilot, not three lines of prose: what the player
    // needs off this screen is to be able to tell two pilots apart.
    const rated = page.locator('.manifest-row [data-testid="pilot-stats"]').first();
    check(
      'the manifest lists the crew with their skills',
      (await page.locator('.manifest-row').count()) >= 4 &&
        (await rated.locator('li').count()) === 5 &&
        (await rated.innerText()).includes('Gunnery'),
    );
    check(
      'the manifest marks who is actually dropping',
      (await page.locator('.manifest-row.drops').count()) > 0,
    );

    // Holding a pilot back takes them out of the drop, and calling them up
    // puts them back: the bench is the only reason this screen exists.
    const dropsBefore = await page.locator('.manifest-row.drops').count();
    const bench = page.locator('[data-testid^="manifest-bench-"]').first();
    await bench.click();
    check(
      'holding a pilot back removes them from the drop',
      (await page.locator('.manifest-row.drops').count()) === dropsBefore - 1,
    );
    await bench.click();
    check(
      'calling them up puts them back',
      (await page.locator('.manifest-row.drops').count()) === dropsBefore,
    );

    // The bay opens on one of the company's own machines, stocked from its own
    // stores — mission prep is who drops, in what, carrying what.
    await page.locator('[data-testid^="manifest-refit-"]').first().click();
    await page.waitForSelector('[data-testid="refit-bay"]');
    check(
      'the refit bay opens on the company mech',
      (await page.locator('[data-testid="bay-commission"]').innerText()).startsWith('Refit'),
    );
    const shelvedWeapons = await page
      .locator('.bay-side [data-testid^="stock-weapon-"]')
      .evaluateAll((entries) => entries.map((entry) => entry.getAttribute('data-testid') ?? ''));
    check(
      'the campaign shelf holds the selected welded mech\'s own weapons',
      shelvedWeapons.length === 2 &&
        shelvedWeapons.includes('stock-weapon-flamer') &&
        shelvedWeapons.includes('stock-weapon-srm2') &&
        !shelvedWeapons.includes('stock-weapon-medium_laser'),
      shelvedWeapons.join(', '),
    );
    const coolingOptions = await page.locator('[data-testid="heat-sink-type"] option').evaluateAll(
      (options) => options.map((option) => ({ value: option.value, label: option.textContent ?? '' })),
    );
    check(
      'campaign cooling offers only the sink technology the company owns',
      coolingOptions.length === 1 && coolingOptions[0]?.value === 'heat_sink',
      JSON.stringify(coolingOptions),
    );
    check(
      'every location draws its slots',
      (await page.locator('.slot-block').count()) > 8,
      `${await page.locator('.slot-block').count()} slot blocks`,
    );
    check(
      'the weapon card explains its costs, heat and range without a second panel',
      (await page.locator('[data-testid="weapon-card-flamer"] [role="meter"]').count()) === 3 &&
        (await page.locator('[data-testid="weapon-card-flamer"]').innerText()).includes('slot') &&
        (await page.locator('[data-testid="weapon-card-flamer"] .weapon-range-strip').count()) === 1,
    );
    check(
      'campaign stock cannot be fitted twice before commit',
      (await page.locator('[data-testid="stock-weapon-flamer"]').getAttribute('aria-disabled')) === 'true',
    );
    await page.locator('[data-testid="bay-save"]').click();
    await page.waitForSelector('[data-testid="lance-manifest"]');
    check(
      'a company-owned no-change refit returns to the manifest',
      (await page.locator('[data-testid="refit-bay"]').count()) === 0 &&
        (await page.locator('[data-testid="lance-manifest"]').count()) === 1,
    );

    await page.locator('[data-testid="manifest-launch"]').click();
    await page.waitForSelector('[data-testid="briefing"]');
    check('the contracted mission opens on its briefing', true);
    await page.locator('[data-testid="briefing-deploy"]').click();
    await page.waitForSelector('[data-testid="lance-bar"]');
    check('deploying launches the contracted mission', (await page.locator('.viewport canvas:not(.perf-overlay)').count()) === 1);

    const deployed = await page.evaluate(() => {
      const { world } = globalThis.__ironline;
      return {
        mission: world.mission.id,
        playerMechs: world.entities.filter((e) => e.team === 0).map((e) => e.name),
      };
    });
    check(
      'the mission is the opening Linewrought contract',
      deployed.mission === 'line_maintenance',
      deployed.mission,
    );
    check('the campaign lance deployed', deployed.playerMechs.length === 4, deployed.playerMechs.join(', '));

    await page.evaluate(async () => {
      const { engine } = globalThis.__ironline;
      const deadline = Date.now() + 25_000;
      while (!engine.world.finished && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        for (let step = 0; step < 400 && !engine.world.finished; step += 1) engine.forceStep();
      }
    });
    await page.waitForSelector('[data-testid="return-to-campaign"]');
    await page.screenshot({ path: `${SHOTS}/07-campaign-battle.png` });

    await page.locator('[data-testid="return-to-campaign"]').click();
    await page.locator('[data-testid="return-to-campaign"]').click();
    await page.waitForSelector('[data-testid="campaign"]');

    // Coming home opens the debrief: what the drop earned each pilot.
    await page.waitForSelector('[data-testid="debrief"]');
    check(
      'the debrief accounts for every pilot who dropped',
      (await page.locator('[data-testid^="debrief-fate-"]').count()) > 0,
    );
    const debriefText = await page.locator('[data-testid="debrief"]').innerText();
    check('the debrief reports experience earned', debriefText.includes('+') && debriefText.includes('XP'));
    check('the debrief records banked experience', debriefText.includes('banked'));
    check(
      'the debrief names the signed package',
      (await page.locator('[data-testid="debrief"] header').innerText()).includes('Salvage first'),
    );
    await page.locator('[data-testid="debrief-close"]').click();

    const resolvedState = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('ironline.campaign')).state,
    );
    check('the contract resolved into history', resolvedState.history.length === 1);
    check('the contract slot is clear again', resolvedState.contract === null);
    check(
      'drop experience waits for a training choice',
      resolvedState.pilots.some((pilot) => pilot.xp > 0) &&
        resolvedState.pilots.every((pilot) => pilot.spentXp === 0),
    );
    const rosterText = await page.locator('[data-testid="camp-roster"]').innerText();
    check(
      'the barracks states experience and daily payroll',
      rosterText.includes('XP banked') && rosterText.includes('/day'),
    );

    if (resolvedState.history[0].won) {
      check('winning paid out', (await cash()) > cashBefore, `${cashBefore} → ${await cash()}`);
      check('salvage reached stores', resolvedState.store.length > 0);
      check(
        'the next contracts unlocked',
        (await page.locator('.camp-node.available').count()) >= 1,
      );
    } else {
      check('a critical loss leaves the victory route open', resolvedState.failedNodes.length === 0);
      check('the failed contract returns to the board', resolvedState.finished === false);
      check(
        'recovery terms are explained',
        resolvedState.log.some((entry) => entry.text.includes('returns to the board')),
      );
    }

    check('battle damage came home', (await page.locator('[data-testid="camp-bay"] li').count()) >= 4);
    await page.screenshot({ path: `${SHOTS}/08-campaign.png` });

    await page.locator('[data-testid="camp-load"]').click();
    const afterReload = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('ironline.campaign')).state,
    );
    check(
      'reloading preserves the campaign exactly',
      JSON.stringify(afterReload) === JSON.stringify(resolvedState),
    );

    check('no page errors across the whole run', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
    await runMobilePlaythrough({ browser, url: URL, shots: SHOTS, check });
  } finally {
    await browser.close();
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      server.kill('SIGTERM');
    }
  }

  process.stdout.write(`\n${checks - failures.length}/${checks} checks passed\n`);
  if (failures.length > 0) {
    process.stdout.write(`\nFAILURES:\n${failures.map((line) => `  - ${line}`).join('\n')}\n`);
    process.exitCode = 1;
  }
}

await main();
