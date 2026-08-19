import { readFile } from 'node:fs/promises';

export async function runCampaignRecovery({ page, shots, check }) {
  const damaged = '{"version":1,"state":{"campaignId":"border_dispute"}';
  await page.evaluate((raw) => localStorage.setItem('ironline.campaign', raw), damaged);
  await page.reload();
  await page.waitForSelector('[data-testid="open-campaign"]');
  await page.locator('[data-testid="open-campaign"]').click();
  await page.waitForSelector('[data-testid="camp-recovery"]');

  const retained = await page.evaluate(() => localStorage.getItem('ironline.campaign'));
  check('a damaged campaign is left byte-for-byte intact', retained === damaged);
  check(
    'the campaign explains its memory-only recovery state',
    (await page.locator('[data-testid="camp-recovery"]').innerText()).includes('memory-only'),
  );

  const dayBefore = Number(
    (await page.locator('[data-testid="camp-day"]').innerText()).replace('Day ', ''),
  );
  await page.locator('[data-testid="camp-advance"]').click();
  const dayAfter = Number(
    (await page.locator('[data-testid="camp-day"]').innerText()).replace('Day ', ''),
  );
  check('memory-only transactions remain usable', dayAfter === dayBefore + 1);
  check(
    'memory-only transactions do not overwrite the damaged save',
    (await page.evaluate(() => localStorage.getItem('ironline.campaign'))) === damaged,
  );

  const downloadEvent = page.waitForEvent('download');
  await page.locator('[data-testid="camp-recovery-export"]').click();
  const download = await downloadEvent;
  const path = await download.path();
  check(
    'recovery export returns the original bytes',
    path !== null && (await readFile(path, 'utf8')) === damaged,
  );

  await page.screenshot({ path: `${shots}/08-save-recovery.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${shots}/08-save-recovery-touch.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.locator('[data-testid="camp-restart"]').click();
  check('an explicit restart clears recovery mode', (await page.locator('[data-testid="camp-recovery"]').count()) === 0);
  const recovered = await page.evaluate(() => {
    try {
      const raw = localStorage.getItem('ironline.campaign');
      return raw === null ? null : JSON.parse(raw).state?.campaignId;
    } catch {
      return null;
    }
  });
  check(
    'an explicit restart writes a valid campaign',
    recovered === 'border_dispute',
  );
}
