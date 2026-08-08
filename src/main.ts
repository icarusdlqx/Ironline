import { loadCatalog } from './schema/load';

const catalog = loadCatalog();
const root = document.querySelector('#app');

if (root !== null) {
  root.textContent = [
    'IRONLINE — Phase 0 foundation',
    `${catalog.chassis.size} chassis`,
    `${catalog.weapons.size} weapons`,
    `${catalog.equipment.size} equipment`,
  ].join(' · ');
}
