import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadCatalog } from '../schema/load';
import { missionTickBudget } from '../schema/missionClock';
import { runBattle, type BattleResult } from '../sim/world';
import { aggregate, formatReport } from './report';

interface Options {
  mission: string;
  iterations: number;
  seed: string;
  out: string | null;
  maxTicks: number | null;
  verbose: boolean;
}

const DEFAULTS = {
  mission: 'skirmish_ridge',
  iterations: 10,
  seed: '1337',
};

function parseOptions(argv: readonly string[]): Options {
  const raw = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';
    if (!token.startsWith('--')) continue;

    const equals = token.indexOf('=');
    if (equals !== -1) {
      raw.set(token.slice(2, equals), token.slice(equals + 1));
      continue;
    }

    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      raw.set(token.slice(2), next);
      index += 1;
    } else {
      raw.set(token.slice(2), 'true');
    }
  }

  const iterations = Number(raw.get('iterations') ?? DEFAULTS.iterations);
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error(`--iterations must be a positive integer, got "${raw.get('iterations')}"`);
  }

  const maxTicksRaw = raw.get('max-ticks');
  const maxTicks = maxTicksRaw === undefined ? null : Number(maxTicksRaw);
  if (maxTicks !== null && (!Number.isInteger(maxTicks) || maxTicks < 1)) {
    throw new Error(`--max-ticks must be a positive integer, got "${maxTicksRaw}"`);
  }

  return {
    mission: raw.get('mission') ?? DEFAULTS.mission,
    iterations,
    seed: raw.get('seed') ?? DEFAULTS.seed,
    out: raw.get('out') ?? null,
    maxTicks,
    verbose: raw.get('verbose') === 'true',
  };
}

export function runSuite(options: Options): BattleResult[] {
  const catalog = loadCatalog();
  const results: BattleResult[] = [];

  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    results.push(
      runBattle(catalog, {
        seed: `${options.seed}:${iteration}`,
        missionId: options.mission,
        maxTicks: options.maxTicks ?? missionTickBudget(catalog, options.mission),
      }),
    );
  }

  return results;
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const catalog = loadCatalog();

  const started = process.hrtime.bigint();
  const results = runSuite(options);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  const summary = aggregate(results);

  process.stdout.write(
    `IRONLINE headless harness — mission "${options.mission}", ` +
      `${options.iterations} iteration(s), seed "${options.seed}"\n\n`,
  );
  process.stdout.write(`${formatReport(summary, catalog)}\n\n`);
  process.stdout.write(
    `simulated in ${elapsedMs.toFixed(0)}ms ` +
      `(${(elapsedMs / options.iterations).toFixed(1)}ms per battle)\n`,
  );

  if (options.verbose) {
    for (const result of results) {
      process.stdout.write(
        `  seed=${String(result.seed)} winner=${result.winner ?? 'draw'} ` +
          `ticks=${result.ticks} duration=${result.durationSeconds.toFixed(1)}s\n`,
      );
    }
  }

  if (options.out !== null) {
    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(options.out, `${JSON.stringify({ options, results }, null, 2)}\n`);
    process.stdout.write(`wrote ${options.out}\n`);
  }
}

main();
