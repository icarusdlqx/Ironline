import type { Campaign, CampaignNode } from '../../schema/campaign';
import type { Catalog } from '../../schema/load';

export type NodeState = 'locked' | 'available' | 'complete' | 'failed';

interface Props {
  campaign: Campaign;
  catalog: Catalog;
  stateOf: (node: CampaignNode) => NodeState;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Deterministic value noise, so the same theatre draws the same terrain every load. */
function noise(x: number, y: number, seed: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return value - Math.floor(value);
}

/** A closed contour ring, wobbled by the noise field — reads as high ground. */
function contour(cx: number, cy: number, radius: number, seed: number): string {
  const points: string[] = [];
  const steps = 26;
  for (let index = 0; index < steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    const wobble = 0.72 + noise(Math.cos(angle) * 3, Math.sin(angle) * 3, seed) * 0.55;
    points.push(
      `${(cx + Math.cos(angle) * radius * wobble).toFixed(1)},${(cy + Math.sin(angle) * radius * wobble * 0.62).toFixed(1)}`,
    );
  }
  return `M${points.join('L')}Z`;
}

/** What the contract actually asks you to do, from the mission it points at. */
function missionGlyph(catalog: Catalog, missionId: string): { glyph: string; kind: string } {
  const mission = catalog.missions.get(missionId);
  // Only the required objectives say what the contract is; the optional ones are bonuses.
  const types = new Set(
    (mission?.objectives ?? []).filter((objective) => objective.required).map((o) => o.type),
  );

  if (types.has('capture_zones') || types.has('hold_zones')) return { glyph: '◎', kind: 'Capture' };
  if (types.has('protect_zones')) return { glyph: '⬢', kind: 'Defend' };
  if (types.has('destroy_all')) return { glyph: '✳', kind: 'Strike' };
  if (types.has('survive')) return { glyph: '⌂', kind: 'Hold' };
  return { glyph: '✳', kind: 'Strike' };
}

export function CampaignMap({ campaign, catalog, stateOf, selectedId, onSelect }: Props) {
  const nodes = campaign.nodes;
  const at = (node: CampaignNode): { x: number; y: number } => ({
    x: node.position.x * 100,
    y: node.position.y * 100,
  });

  // Supply routes: a contract unlocks the ones that list it as a prerequisite.
  const routes = nodes.flatMap((node) =>
    node.requires.map((requiredId) => {
      const from = nodes.find((candidate) => candidate.id === requiredId);
      return from === undefined ? null : { from, to: node };
    }),
  );

  return (
    <section className="camp-map" data-testid="camp-map">
      <svg className="camp-terrain" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="camp-ground" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#141c18" />
            <stop offset="100%" stopColor="#0f1418" />
          </linearGradient>
        </defs>
        <rect width="100" height="100" fill="url(#camp-ground)" />

        {/* Highland masses, three contour levels each. */}
        {[
          { cx: 22, cy: 30, r: 20, seed: 3 },
          { cx: 68, cy: 24, r: 16, seed: 11 },
          { cx: 74, cy: 72, r: 22, seed: 7 },
          { cx: 34, cy: 76, r: 14, seed: 19 },
        ].map((hill, index) => (
          <g key={index}>
            {[1, 0.72, 0.44].map((scale, ring) => (
              <path
                key={ring}
                d={contour(hill.cx, hill.cy, hill.r * scale, hill.seed + ring)}
                fill="none"
                stroke="rgba(140, 224, 255, 0.10)"
                strokeWidth={0.25}
              />
            ))}
          </g>
        ))}

        {/* The river the whole border dispute is about. */}
        <path
          d="M-2,58 C18,52 26,68 44,64 C60,60 66,44 84,46 C94,47 98,42 102,40"
          fill="none"
          stroke="rgba(90, 150, 200, 0.30)"
          strokeWidth={1.4}
        />

        {routes.map((route, index) =>
          route === null ? null : (
            <line
              key={index}
              x1={at(route.from).x}
              y1={at(route.from).y}
              x2={at(route.to).x}
              y2={at(route.to).y}
              className={`camp-route ${stateOf(route.from) === 'complete' ? 'open' : ''}`}
            />
          ),
        )}
      </svg>

      {nodes.map((node) => {
        const state = stateOf(node);
        const { glyph, kind } = missionGlyph(catalog, node.missionId);
        const position = at(node);

        return (
          <button
            key={node.id}
            type="button"
            className={`camp-node ${state} ${selectedId === node.id ? 'selected' : ''}`}
            style={{ left: `${position.x}%`, top: `${position.y}%` }}
            disabled={state !== 'available'}
            onClick={() => onSelect(node.id)}
            data-testid={`camp-node-${node.id}`}
            title={`${node.employer} · ${kind}`}
          >
            <span className="node-glyph" aria-hidden="true">
              {state === 'complete' ? '✓' : state === 'failed' ? '✕' : glyph}
            </span>
            <span className="node-body">
              <span className="node-name">{node.name}</span>
              <span className="node-meta">
                {kind} · {node.employer}
              </span>
              <span className="node-state">
                {state === 'available'
                  ? `${(node.basePayout / 1000).toFixed(0)}k · salvage to ${(node.maxSalvageShare * 100).toFixed(0)}%`
                  : state}
              </span>
            </span>
          </button>
        );
      })}

      <ul className="camp-legend" aria-label="Map legend">
        <li><span aria-hidden="true">✳</span> Strike</li>
        <li><span aria-hidden="true">◎</span> Capture</li>
        <li><span aria-hidden="true">⌂</span> Hold</li>
        <li><span aria-hidden="true">⬢</span> Defend</li>
      </ul>
    </section>
  );
}
