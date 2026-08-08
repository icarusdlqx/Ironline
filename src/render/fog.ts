import { Graphics } from 'pixi.js';
import type { TeamVision } from '../sim/sensors';
import type { TerrainGrid } from '../sim/terrain';
import { UI } from './palette';

const REMEMBERED_ALPHA = 0.55;

export class FogLayer {
  readonly graphics = new Graphics();
  private lastTick = -1;

  update(grid: TerrainGrid, vision: TeamVision | null, tick: number): void {
    if (vision === null) {
      this.graphics.clear();
      return;
    }
    if (tick === this.lastTick) return;
    this.lastTick = tick;

    this.graphics.clear();

    for (let row = 0; row < grid.height; row += 1) {
      let runStart = -1;
      let runAlpha = 0;

      const flush = (endColumn: number): void => {
        if (runStart < 0 || runAlpha === 0) return;
        this.graphics
          .rect(
            runStart * grid.tileSize,
            row * grid.tileSize,
            (endColumn - runStart) * grid.tileSize,
            grid.tileSize,
          )
          .fill({ color: UI.fogUnexplored, alpha: runAlpha });
        runStart = -1;
      };

      for (let column = 0; column < grid.width; column += 1) {
        const cell = row * grid.width + column;
        const alpha =
          vision.tiles[cell] === 1 ? 0 : vision.explored[cell] === 1 ? REMEMBERED_ALPHA : 1;

        if (alpha !== runAlpha) {
          flush(column);
          runAlpha = alpha;
          runStart = alpha === 0 ? -1 : column;
        }
      }

      flush(grid.width);
    }
  }
}
