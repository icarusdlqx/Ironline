import type { Catalog } from '../../schema/load';

export function CampaignLoreManual({
  catalog,
  open,
  onClose,
}: {
  catalog: Catalog;
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="camp-manual" data-testid="camp-manual">
      <div className="manual-sheet">
        <header>
          <h3>Field Manual</h3>
          <button type="button" onClick={onClose} data-testid="camp-manual-close">
            Close
          </button>
        </header>
        {[...catalog.lore.values()]
          .sort((a, b) => a.order - b.order)
          .map((entry) => (
            <article key={entry.id}>
              <h4>{entry.title}</h4>
              <p className="manual-summary">{entry.summary}</p>
              {entry.body.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </article>
          ))}
      </div>
    </div>
  );
}
