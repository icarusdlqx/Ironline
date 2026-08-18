import type { EmployerHistory } from '../../campaign/employers';
import './employers.css';

function cbills(value: number): string {
  return `${Math.round(value).toLocaleString('en-GB')} C`;
}

export function employerHistoryText(record: EmployerHistory): string {
  const dispositions = [
    record.withdrawn === 0 ? null : `${record.withdrawn} withdrawn`,
    record.expired === 0 ? null : `${record.expired} expired`,
  ].filter((entry): entry is string => entry !== null);
  const failed =
    dispositions.length === 0
      ? `${record.failed} failed`
      : `${record.failed} failed (${dispositions.join(', ')})`;
  return `${record.completed} completed · ${failed} · ${cbills(record.paid)} paid`;
}

export function EmployerLedger({ employers }: { employers: EmployerHistory[] }) {
  return (
    <details className="employer-ledger" data-testid="employer-ledger">
      <summary>Employers</summary>
      <ul>
        {employers.map((employer) => (
          <li key={employer.id} data-testid={`employer-ledger-${employer.id}`}>
            <span>{employer.name}</span>
            <small>{employerHistoryText(employer)}</small>
          </li>
        ))}
      </ul>
    </details>
  );
}
