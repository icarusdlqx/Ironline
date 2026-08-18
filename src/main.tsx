import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';
import './ui/tacticalReadout.css';

const host = document.getElementById('root');
if (host === null) throw new Error('missing #root');

createRoot(host).render(<App />);
