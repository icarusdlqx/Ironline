import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SIM_DIR = join(ROOT, 'src', 'sim');

const FORBIDDEN_LAYERS = ['render', 'ui', 'campaign'];
const FORBIDDEN_PACKAGES = ['pixi.js', 'react', 'react-dom', 'zustand'];

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

  it.each(simSources)('%s does not import /render, /ui or /campaign', (path) => {
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
