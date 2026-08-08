import { Battle } from './Battle';
import { CampaignScreen } from './campaign/CampaignScreen';
import { Mechbay } from './mechbay/Mechbay';
import { useGame } from './store';

export function App() {
  const screen = useGame((state) => state.screen);
  const patch = useGame((state) => state.patch);

  if (screen === 'mechbay') return <Mechbay onExit={() => patch({ screen: 'battle' })} />;
  if (screen === 'campaign') return <CampaignScreen onExit={() => patch({ screen: 'battle' })} />;
  return <Battle />;
}
