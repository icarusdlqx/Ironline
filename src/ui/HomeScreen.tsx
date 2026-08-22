import { useEffect, useState } from 'react';
import { loadCampaign } from '../campaign/save';
import { getCatalog } from '../schema/load';
import { createNewBattleCode, TRAINING_BATTLE_CODE } from './battleCode';
import { usePlaytest } from './playtest';
import { useGame } from './store';
import {
  skipTraining,
  readTraining,
  STANDARD_MISSION_ID,
  startTraining,
  TRAINING_MISSION_ID,
} from './trainingProgress';
import './onboarding.css';

export function HomeScreen() {
  const [entry] = useState(() => ({
    training: readTraining(),
    campaign: loadCampaign(getCatalog(), { storedOnly: true }).state !== null,
  }));
  const battleCode = useGame((state) => state.battleCode);
  const enterBattle = useGame((state) => state.enterBattle);
  const patch = useGame((state) => state.patch);
  const { record } = usePlaytest();

  useEffect(() => {
    record({ name: 'front_door_viewed' });
  }, [record]);
  const primary = entry.training?.status === 'active' ? 'learn' : entry.campaign ? 'campaign' :
    entry.training === null ? 'learn' : 'campaign';

  const learn = (): void => {
    record({ name: 'route_chosen', route: 'learn' });
    startTraining();
    enterBattle({ missionId: TRAINING_MISSION_ID, battleCode: TRAINING_BATTLE_CODE });
  };

  const campaign = (): void => {
    record({ name: 'route_chosen', route: 'campaign' });
    skipTraining();
    patch({ screen: 'campaign', campaignPending: false, error: null });
  };

  const skirmish = (): void => {
    record({ name: 'route_chosen', route: 'skirmish' });
    skipTraining();
    enterBattle({
      missionId: STANDARD_MISSION_ID,
      battleCode: createNewBattleCode(battleCode),
    });
  };

  return (
    <main className="home-screen" data-testid="home-screen">
      <section className="home-panel" aria-labelledby="home-title">
        <p className="home-kicker">Independent company command</p>
        <h1 id="home-title">IRONLINE</h1>
        <p className="home-premise">
          The railway repairs itself. The machines that defend it do not. Command a hired
          Linewrought company through the border works and account for what comes home.
        </p>

        <div className="home-routes" aria-label="Choose where to begin">
          <button type="button" className={`home-route${primary === 'learn' ? ' primary' : ''}`} onClick={learn} data-testid="home-learn">
            <strong>{entry.training?.status === 'active' ? 'Resume the Range' : 'Learn the Line'}</strong>
            <span>Take two machines through a short range walk.</span>
          </button>
          <button type="button" className={`home-route${primary === 'campaign' ? ' primary' : ''}`} onClick={campaign} data-testid="home-campaign">
            <strong>{entry.campaign ? 'Continue Campaign' : 'Start Campaign'}</strong>
            <span>Open the company ledger and the contract board.</span>
          </button>
          <button type="button" className="home-route" onClick={skirmish} data-testid="home-skirmish">
            <strong>Skirmish</strong>
            <span>Choose a field, lance and repeatable Battle code.</span>
          </button>
        </div>

        <p className="home-note">Real-time with pause. Orders remain available while the clock is stopped.</p>
      </section>
    </main>
  );
}
