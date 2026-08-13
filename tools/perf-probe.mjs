/**
 * Renders a mission for a few seconds and reports what it costs: frame rate,
 * draw calls, triangles, and geometry/texture counts from the WebGL renderer's
 * own bookkeeping. A sanity gauge, not a benchmark — run it before and after a
 * graphics change to see what the change actually bought or spent.
 *
 *   npm run dev            # in one terminal
 *   node tools/perf-probe.mjs [missionId] [url]
 *
 * Defaults to the densest mission and http://localhost:5199. Numbers from the
 * sandbox's software rasteriser say nothing absolute about a phone — watch the
 * draw calls and triangles, which are the same everywhere.
 */
import { chromium } from 'playwright';

const mission = process.argv[2] ?? 'foundry_sweep';
const url = process.argv[3] ?? 'http://localhost:5199/';

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errors = [];
page.on('pageerror', (event) => errors.push(event.message));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => globalThis.__ironline !== undefined, { timeout: 40_000 });
await page.selectOption('[data-testid="mission-picker"]', mission).catch(() => {});
await page.waitForTimeout(1_000);
const deploy = page.locator('.briefing button').first();
if ((await deploy.count()) > 0) await deploy.click().catch(() => {});
await page.waitForFunction(() => globalThis.__ironline !== undefined, { timeout: 40_000 });
await page.waitForTimeout(1_000);

const report = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const g = globalThis.__ironline;
      const info = g.engine.renderer.renderer.info;
      const t0 = performance.now();
      let frames = 0;
      const samples = { calls: 0, triangles: 0 };
      const tick = () => {
        frames += 1;
        samples.calls = Math.max(samples.calls, info.render.calls);
        samples.triangles = Math.max(samples.triangles, info.render.triangles);
        if (performance.now() - t0 < 5_000) requestAnimationFrame(tick);
        else {
          resolve({
            fps: Math.round((frames / (performance.now() - t0)) * 1000),
            drawCalls: samples.calls,
            triangles: samples.triangles,
            geometries: info.memory.geometries,
            textures: info.memory.textures,
            entities: g.world.entities.length,
          });
        }
      };
      requestAnimationFrame(tick);
    }),
);

console.log(`mission    ${mission}`);
for (const [key, value] of Object.entries(report)) {
  console.log(`${key.padEnd(10)} ${value.toLocaleString('en-US')}`);
}
if (errors.length > 0) console.log('page errors:', errors.slice(0, 3).join(' | '));
await browser.close();
process.exit(errors.length > 0 ? 1 : 0);
