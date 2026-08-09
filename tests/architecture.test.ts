import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SIM_DIR = join(ROOT, 'src', 'sim');

const FORBIDDEN_LAYERS = ['render', 'render3d', 'ui', 'campaign'];
const FORBIDDEN_PACKAGES = ['three', 'react', 'react-dom', 'zustand'];

function collectSources(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...collectSources(path));
    else if (entry.name.endsWith('.ts')) found.push(path);
  }
  return found;
}

const simSources = collectSources(SIM_DIR);

function importSpecifiers(source: string): string[] {
  const pattern = /(?:^|\s)(?:import|export)[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const specifiers: string[] = [];
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1] ?? match[2];
    if (specifier !== undefined) specifiers.push(specifier);
  }
  return specifiers;
}

describe('/sim boundary', () => {
  it('contains source files to check', () => {
    expect(simSources.length).toBeGreaterThan(0);
  });

  it.each(simSources)('%s does not import a rendering, UI or campaign layer', (path) => {
    const specifiers = importSpecifiers(readFileSync(path, 'utf8'));
    for (const specifier of specifiers) {
      for (const layer of FORBIDDEN_LAYERS) {
        expect(
          new RegExp(`(^|/)${layer}(/|$)`).test(specifier),
          `${path} imports "${specifier}" from the ${layer} layer`,
        ).toBe(false);
      }
    }
  });

  it.each(simSources)('%s does not import a rendering or UI package', (path) => {
    const specifiers = importSpecifiers(readFileSync(path, 'utf8'));
    for (const specifier of specifiers) {
      expect(FORBIDDEN_PACKAGES).not.toContain(specifier);
    }
  });
});

describe('/sim determinism', () => {
  it.each(simSources)('%s does not call Math.random', (path) => {
    expect(readFileSync(path, 'utf8')).not.toMatch(/Math\s*\.\s*random/);
  });

  it.each(simSources)('%s does not read the wall clock', (path) => {
    const source = readFileSync(path, 'utf8');
    expect(source).not.toMatch(/Date\s*\.\s*now/);
    expect(source).not.toMatch(/performance\s*\.\s*now/);
    expect(source).not.toMatch(/new\s+Date\s*\(/);
  });
});

describe('lint configuration', () => {
  const config = readFileSync(join(ROOT, 'eslint.config.js'), 'utf8');

  it('enforces the /sim import boundary', () => {
    expect(config).toContain('no-restricted-imports');
    for (const layer of FORBIDDEN_LAYERS) expect(config).toContain(`'${layer}'`);
  });

  it('bans Math.random in /sim', () => {
    expect(config).toContain("object: 'Math'");
    expect(config).toContain("property: 'random'");
  });
});

describe('/render boundary', () => {
  // The renderer is a leaf: it reads the simulation and draws it. Letting it
  // reach into the store or the campaign is how a redraw ends up mutating game
  // state, which is exactly the class of bug a rotating camera makes hard to see.
  const renderSources = [
    ...collectSources(join(ROOT, 'src', 'render')),
    ...collectSources(join(ROOT, 'src', 'render3d')),
  ].filter((path) => !path.endsWith('.test.ts'));

  it('contains source files to check', () => {
    expect(renderSources.length).toBeGreaterThan(0);
  });

  it.each(renderSources)('%s does not import /ui or /campaign', (path) => {
    const specifiers = importSpecifiers(readFileSync(path, 'utf8'));
    for (const specifier of specifiers) {
      for (const layer of ['ui', 'campaign']) {
        expect(
          new RegExp(`(^|/)${layer}(/|$)`).test(specifier),
          `${path} imports "${specifier}" from the ${layer} layer`,
        ).toBe(false);
      }
    }
  });
});
