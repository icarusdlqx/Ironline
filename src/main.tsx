import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';
import './ui/tacticalReadout.css';
import './ui/mobileLayout.css';
import './ui/mobileBattle.css';
import './ui/damageReadouts.css';
import './ui/formationPicker.css';

const host = document.getElementById('root');
if (host === null) throw new Error('missing #root');

createRoot(host).render(<App />);
