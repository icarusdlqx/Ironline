export async function checkBriefingInputSafety({
  page,
  check,
  sim,
  state,
  beforeBriefing,
  shots,
}) {
  await page.setViewportSize({ width: 1280, height: 720 });
  const clockControlsHeld =
    (await page.locator('[data-testid="pause-button"]').isDisabled()) &&
    (await page.locator('button[data-testid^="speed-"]').evaluateAll((buttons) =>
      buttons.every((button) => button instanceof HTMLButtonElement && button.disabled),
    ));
  check('desktop clock controls stay disabled until deployment', clockControlsHeld);

  const compactDesktop = await page.evaluate(() => {
    const hitIds = [
      'pause-button',
      'fx-toggle',
      'open-mechbay',
      'open-campaign',
      'difficulty-picker',
      'mission-picker',
      'feedback-link',
    ];
    const blocked = hitIds.filter((testId) => {
      const target = document.querySelector(`[data-testid="${testId}"]`);
      if (!(target instanceof HTMLElement)) return true;
      const rect = target.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === null || !target.contains(hit);
    });
    const hint = document.querySelector('.topbar .hint');
    const topbar = document.querySelector('[data-testid="topbar"]');
    return {
      blocked,
      hintHidden: hint === null || getComputedStyle(hint).display === 'none',
      fits: topbar instanceof HTMLElement && topbar.scrollWidth <= topbar.clientWidth + 1,
    };
  });
  check(
    '1280px briefing leaves desktop navigation on top',
    compactDesktop.blocked.length === 0,
    compactDesktop.blocked.join(', '),
  );
  check('1280px topbar fits without a shortcut column', compactDesktop.hintHidden && compactDesktop.fits);
  await page.screenshot({ path: `${shots}/01-boot-1280x720.png` });
  await page.locator('[data-testid="open-mechbay"]').click();
  await page.waitForSelector('[data-testid="mechbay"]');
  check('1280px briefing leaves Mechbay navigation clickable', true);
  await page.locator('[data-testid="bay-exit"]').click();
  await page.waitForSelector('[data-testid="briefing"]');
  await page.setViewportSize({ width: 1440, height: 900 });

  const battleCode = page.locator('[data-testid="briefing-battle-code"]');
  await battleCode.fill('Ridge Touch');
  await battleCode.press('Space');
  check(
    'Space types into the focused Battle code',
    (await battleCode.inputValue()) === 'Ridge Touch ',
    await battleCode.inputValue(),
  );
  check('focused Battle code leaves the clock held', (await sim(page)).tick === beforeBriefing);
  await battleCode.evaluate((field) => field.blur());
  const predeployState = await state(page);
  await page.keyboard.press('Space');
  check(
    'battle hotkeys do nothing before deployment',
    (await state(page)).paused === predeployState.paused &&
      (await sim(page)).tick === beforeBriefing,
  );
}

export async function clearControlFocus(page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

export async function checkDeployedInputSafety({ page, check, state }) {
  const fxToggle = page.locator('[data-testid="fx-toggle"]');
  const fxBefore = await fxToggle.innerText();
  const pauseBeforeFx = (await state(page)).paused;
  await fxToggle.focus();
  await page.keyboard.press('Space');
  check(
    'Space activates a focused battle button without pausing',
    (await fxToggle.innerText()) !== fxBefore && (await state(page)).paused === pauseBeforeFx,
  );
  await page.keyboard.press('Space');
  await clearControlFocus(page);
  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Space', key: ' ', repeat: true, bubbles: true }),
    );
  });
  check('a repeated toggle key does not change pause', (await state(page)).paused === pauseBeforeFx);
}
