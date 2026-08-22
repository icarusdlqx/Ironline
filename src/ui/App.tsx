import { Battle } from './Battle';
import { CampaignScreen } from './campaign/CampaignScreen';
import { HomeScreen } from './HomeScreen';
import { Mechbay } from './mechbay/Mechbay';
import { PlaytestProvider } from './playtest';
import { useGame } from './store';

export function App() {
  return (
    <PlaytestProvider>
      <AppRoute />
    </PlaytestProvider>
  );
}

function AppRoute() {
  const screen = useGame((state) => state.screen);
  const patch = useGame((state) => state.patch);

  if (screen === 'home') return <HomeScreen />;
  if (screen === 'mechbay') return <Mechbay onExit={() => patch({ screen: 'battle' })} />;
  if (screen === 'campaign') return <CampaignScreen onExit={() => patch({ screen: 'home' })} />;
  return <Battle />;
}
