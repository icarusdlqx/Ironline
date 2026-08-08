import { z } from 'zod';
import { IdSchema, NameSchema } from './common';

export const TerrainMapSchema = z
  .strictObject({
    id: IdSchema,
    name: NameSchema,
    tileSize: z.number().positive().max(64),
    width: z.number().int().min(4).max(256),
    height: z.number().int().min(4).max(256),
    legend: z.record(z.string().length(1), IdSchema),
    tiles: z.array(z.string()).min(4),
    elevation: z.array(z.string()).optional(),
  })
  .superRefine((map, ctx) => {
    if (map.tiles.length !== map.height) {
      ctx.addIssue({
        code: 'custom',
        path: ['tiles'],
        message: `expected ${map.height} rows, got ${map.tiles.length}`,
      });
    }

    map.tiles.forEach((row, index) => {
      if (row.length !== map.width) {
        ctx.addIssue({
          code: 'custom',
          path: ['tiles', index],
          message: `expected ${map.width} columns, got ${row.length}`,
        });
        return;
      }
      for (const symbol of row) {
        if (map.legend[symbol] === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['tiles', index],
            message: `symbol "${symbol}" is not in the legend`,
          });
          return;
        }
      }
    });

    if (map.elevation === undefined) return;

    if (map.elevation.length !== map.height) {
      ctx.addIssue({
        code: 'custom',
        path: ['elevation'],
        message: `expected ${map.height} rows, got ${map.elevation.length}`,
      });
    }

    map.elevation.forEach((row, index) => {
      if (row.length !== map.width) {
        ctx.addIssue({
          code: 'custom',
          path: ['elevation', index],
          message: `expected ${map.width} columns, got ${row.length}`,
        });
        return;
      }
      if (!/^[0-9]+$/.test(row)) {
        ctx.addIssue({
          code: 'custom',
          path: ['elevation', index],
          message: 'elevation rows are digits 0-9',
        });
      }
    });
  });

export type TerrainMapData = z.infer<typeof TerrainMapSchema>;
