import type { CampaignNode } from '../../schema/campaign';
import type { Catalog } from '../../schema/load';
import type { Campaign } from '../../schema/campaign';
import type { EmployerHistory } from '../../campaign/employers';
import { employerDisplayName } from '../../campaign/employers';
import { nextOfferDay, sideContractProfile } from '../../campaign/sidework';
import { employerHistoryText } from './EmployerLedger';

function cbills(value: number): string {
  return `${Math.round(value).toLocaleString('en-GB')} C`;
}

function capitalise(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase()}${value.slice(1)}`;
}

export interface HiringHallProps {
  catalog: Catalog;
  campaign: Campaign;
  day: number;
  offers: CampaignNode[];
  employers: EmployerHistory[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function HiringHall({
  catalog,
  campaign,
  day,
  offers,
  employers,
  selectedId,
  onSelect,
}: HiringHallProps) {
  if (offers.length === 0) return null;

  return (
    <section className="camp-hall" data-testid="camp-hall">
      <h3>Hiring hall</h3>
      <ul>
        {offers.map((offer) => {
          const profile = sideContractProfile(catalog, offer.missionId);
          const name = employerDisplayName(campaign, offer.employerId);
          const history = employers.find((employer) => employer.id === offer.employerId);
          return (
            <li key={offer.id} className={offer.id === selectedId ? 'chosen' : ''}>
              <button
                type="button"
                onClick={() => onSelect(offer.id)}
                data-testid={`camp-side-${offer.id}`}
              >
                <span className="hall-name">{offer.name}</span>
                <span className="hall-employer">
                  {name}
                  {history === undefined ? '' : ` · ${employerHistoryText(history)}`}
                </span>
                <span className="hall-terms">
                  {cbills(offer.basePayout)} · {offer.deadlineDays}d
                </span>
                {profile === null ? null : (
                  <span className="hall-profile">
                    {capitalise(profile.operation)} · {profile.battlefield} · {profile.dropTonnage}t
                    drop / {profile.oppositionTonnage}t rated opposition
                    {profile.objectives.length === 0
                      ? ''
                      : ` · ${profile.objectives.join(' / ')}`}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="hall-note">
        New work arrives on day {nextOfferDay(catalog, day)}. Ground, objectives and tonnage
        are the listed mission as written.
      </p>
    </section>
  );
}
