import type { Vec2 } from '../sim/types';

export interface ReadoutObstacle {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ReadoutLayout {
  width: number;
  height: number;
  obstacles: readonly ReadoutObstacle[];
}

export interface ReadoutEnvelope {
  halfWidth: number;
  above: number;
  below: number;
}

const EDGE_GAP = 8;
const BLOCKERS = [
  '.topbar',
  '.setup-run-actions',
  '.objectives',
  '.hostiles',
  '.sidebar',
  '.bottombar',
  '.mobile-dock',
  '.minimap',
  '.training-coach',
  '.paused-banner',
  '.mobile-menu-sheet',
].join(',');

function clippedObstacle(
  viewport: DOMRect,
  rect: DOMRect,
  width: number,
  height: number,
): ReadoutObstacle | null {
  const left = Math.max(0, rect.left - viewport.left);
  const top = Math.max(0, rect.top - viewport.top);
  const right = Math.min(width, rect.right - viewport.left);
  const bottom = Math.min(height, rect.bottom - viewport.top);
  return right <= left || bottom <= top ? null : { left, top, right, bottom };
}

/** HUD rectangles move between desktop and touch layouts; their live boxes are authoritative. */
export function measureReadoutLayout(host: HTMLElement): ReadoutLayout {
  const viewport = host.getBoundingClientRect();
  const width = host.clientWidth || viewport.width || 1;
  const height = host.clientHeight || viewport.height || 1;
  const obstacles: ReadoutObstacle[] = [];
  const app = host.parentElement;
  if (app !== null) {
    for (const element of app.querySelectorAll<HTMLElement>(BLOCKERS)) {
      const obstacle = clippedObstacle(viewport, element.getBoundingClientRect(), width, height);
      if (obstacle !== null) obstacles.push(obstacle);
    }
  }
  return { width, height, obstacles };
}

export function readoutEnvelope(
  label: string,
  viewportWidth: number,
  reducedMotion: boolean,
): ReadoutEnvelope {
  const compact = viewportWidth <= 700;
  const fontSize = compact ? 11 : Math.max(10, Math.min(13, viewportWidth * 0.0105));
  const maxWidth = Math.max(
    1,
    Math.min(compact ? viewportWidth * 0.74 : Math.min(360, viewportWidth * 0.62), viewportWidth - 16),
  );
  const naturalWidth = Math.max(44, label.length * fontSize * 0.68 + 16);
  const width = Math.min(maxWidth, naturalWidth);
  const lines = Math.max(1, Math.ceil(naturalWidth / maxWidth));
  const height = lines * fontSize * 1.25 + 8;
  return {
    halfWidth: width / 2,
    above: height * (reducedMotion ? 0.5 : 1.55),
    below: height * (reducedMotion ? 0.5 : 0.65),
  };
}

export function readoutOverlaps(
  point: Vec2,
  envelope: ReadoutEnvelope,
  obstacle: ReadoutObstacle,
): boolean {
  return (
    point.x + envelope.halfWidth > obstacle.left - EDGE_GAP &&
    point.x - envelope.halfWidth < obstacle.right + EDGE_GAP &&
    point.y + envelope.below > obstacle.top - EDGE_GAP &&
    point.y - envelope.above < obstacle.bottom + EDGE_GAP
  );
}

export function readoutBounds(point: Vec2, envelope: ReadoutEnvelope): ReadoutObstacle {
  return {
    left: point.x - envelope.halfWidth,
    top: point.y - envelope.above,
    right: point.x + envelope.halfWidth,
    bottom: point.y + envelope.below,
  };
}

function clamp(value: number, low: number, high: number): number {
  if (high < low) return (low + high) / 2;
  return Math.max(low, Math.min(high, value));
}

/** The closest clear candidate keeps the label tied to its mech when a HUD panel intervenes. */
export function clampReadout(
  point: Vec2,
  label: string,
  layout: ReadoutLayout,
  reducedMotion: boolean,
  occupied: readonly ReadoutObstacle[] = [],
): Vec2 {
  const envelope = readoutEnvelope(label, layout.width, reducedMotion);
  const xMin = EDGE_GAP + envelope.halfWidth;
  const xMax = layout.width - EDGE_GAP - envelope.halfWidth;
  const yMin = EDGE_GAP + envelope.above;
  const yMax = layout.height - EDGE_GAP - envelope.below;
  const origin = {
    x: clamp(point.x, xMin, xMax),
    y: clamp(point.y, yMin, yMax),
  };
  const xs = [origin.x];
  const ys = [origin.y];
  const blockers = [...layout.obstacles, ...occupied];
  for (const obstacle of blockers) {
    xs.push(
      clamp(obstacle.left - EDGE_GAP - envelope.halfWidth, xMin, xMax),
      clamp(obstacle.right + EDGE_GAP + envelope.halfWidth, xMin, xMax),
    );
    ys.push(
      clamp(obstacle.top - EDGE_GAP - envelope.below, yMin, yMax),
      clamp(obstacle.bottom + EDGE_GAP + envelope.above, yMin, yMax),
    );
  }

  let best: Vec2 | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const x of xs) {
    for (const y of ys) {
      const candidate = { x, y };
      if (blockers.some((obstacle) => readoutOverlaps(candidate, envelope, obstacle))) {
        continue;
      }
      const dx = x - origin.x;
      const dy = y - origin.y;
      const cost = dx * dx * 1.35 + dy * dy;
      if (cost >= bestCost) continue;
      best = candidate;
      bestCost = cost;
    }
  }
  return best ?? origin;
}
