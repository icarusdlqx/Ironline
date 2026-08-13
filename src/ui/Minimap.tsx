import { useEffect, useRef } from 'react';
import { TERRAIN_COLOURS, teamColour } from '../render/palette';
import { tileExplored, tileVisible } from '../sim/sensors';
import { isOperational } from '../sim/types';
import type { Engine } from './engine';

/**
 * The whole battlefield in a corner of the screen: terrain, fog, every
 * machine the player can see, and the box the camera is looking through.
 * Tapping it moves the camera there — which on a phone, where the viewport
 * shows a sliver of the map, is the fastest way to get anywhere.
 *
 * Drawn 1 pixel per tile into offscreen buffers and scaled up with smoothing
 * off, so a refresh costs two drawImage calls rather than thousands of rects.
 */
export function Minimap({ engine }: { engine: Engine | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (engine === null) return;
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const screen = canvas.getContext('2d');
    if (screen === null) return;

    const terrain = engine.world.terrain;
    const columns = terrain.width;
    const rows = terrain.height;

    // The ground never changes; paint it once, from the authored map because
    // the simulation grid keeps terrain effects, not terrain names.
    const map = engine.renderer.mapData;
    const base = document.createElement('canvas');
    base.width = columns;
    base.height = rows;
    const baseInk = base.getContext('2d');
    if (baseInk === null) return;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const id = map.legend[map.tiles[row]?.[column] ?? ''] ?? 'open';
        const colour = TERRAIN_COLOURS[id] ?? 0x3c4a33;
        baseInk.fillStyle = `#${colour.toString(16).padStart(6, '0')}`;
        baseInk.fillRect(column, row, 1, 1);
      }
    }

    const fog = document.createElement('canvas');
    fog.width = columns;
    fog.height = rows;
    const fogInk = fog.getContext('2d');
    if (fogInk === null) return;

    let running = true;
    let last = 0;

    const draw = (now: number): void => {
      if (!running) return;
      requestAnimationFrame(draw);
      // 10Hz is plenty for a map the size of a matchbox.
      if (now - last < 100) return;
      last = now;

      const world = engine.world;
      const view = engine.renderer.camera;
      const width = canvas.width;
      const height = canvas.height;

      screen.imageSmoothingEnabled = false;
      screen.drawImage(base, 0, 0, width, height);

      // Fog: unexplored ground is night, explored-but-dark ground is dusk.
      fogInk.clearRect(0, 0, columns, rows);
      if (world.vision !== null) {
        for (let row = 0; row < rows; row += 1) {
          for (let column = 0; column < columns; column += 1) {
            const cell = row * columns + column;
            if (tileVisible(world.vision, cell)) continue;
            fogInk.fillStyle = tileExplored(world.vision, cell)
              ? 'rgba(5, 8, 12, 0.55)'
              : 'rgba(5, 8, 12, 0.92)';
            fogInk.fillRect(column, row, 1, 1);
          }
        }
      }
      screen.drawImage(fog, 0, 0, width, height);

      // Machines. Friendlies always; hostiles only while the sensors hold them.
      const mapWidth = columns * terrain.tileSize;
      const mapHeight = rows * terrain.tileSize;
      for (const entity of world.entities) {
        if (entity.destroyed) continue;
        const mine = entity.team === (world.playerTeam ?? 0);
        if (!mine && world.vision !== null && !world.vision.visible.has(entity.id)) continue;
        if (!isOperational(entity)) continue;
        const x = (entity.pos.x / mapWidth) * width;
        const y = (entity.pos.y / mapHeight) * height;
        screen.fillStyle = `#${teamColour(entity.team).toString(16).padStart(6, '0')}`;
        screen.fillRect(x - 2, y - 2, 4, 4);
      }

      // The camera's window on the world.
      const span = (2 * view.distance * Math.tan(22.5 * (Math.PI / 180))) / Math.sin(view.elevation);
      const boxW = (span / mapWidth) * width;
      const boxH = ((span * 0.62) / mapHeight) * height;
      screen.strokeStyle = 'rgba(214, 226, 234, 0.85)';
      screen.lineWidth = 1;
      screen.strokeRect(
        (view.target.x / mapWidth) * width - boxW / 2,
        (view.target.y / mapHeight) * height - boxH / 2,
        boxW,
        boxH,
      );
    };
    requestAnimationFrame(draw);

    return () => {
      running = false;
    };
  }, [engine]);

  const jump = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (engine === null) return;
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    const terrain = engine.world.terrain;
    engine.renderer.camera.centreOn({
      x: ((event.clientX - bounds.left) / bounds.width) * terrain.width * terrain.tileSize,
      y: ((event.clientY - bounds.top) / bounds.height) * terrain.height * terrain.tileSize,
    });
  };

  return (
    <canvas
      ref={canvasRef}
      className="minimap"
      width={160}
      height={160}
      onPointerDown={jump}
      data-testid="minimap"
    />
  );
}
