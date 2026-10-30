/**
 * The map options menu: one button on the map opens a panel with every map option except the GPS button.
 * Pure DOM, no app state: the touring view passes handlers and calls `sync(state)` after every render.
 */
import { h, icon } from '../ui.js';

/**
 * @param {{speechAvailable:boolean, onToggleMenu:()=>void, onFit:()=>void, onDest:()=>void, onRoute:()=>void,
 *          on3d:()=>void, onSkin:()=>void, onSpeech:()=>void, onLegend:()=>void}} o
 */
export function buildMapMenu(o) {
  const item = (iconName, label, onclick, { toggle = false, sub = false, hidden = false, expanded = false } = {}) => h('button', {
    class: `mi${sub ? ' mi--sub' : ''}`, type: 'button', hidden, onclick,
    ...(toggle ? { 'aria-pressed': 'false' } : {}), ...(expanded ? { 'aria-expanded': 'false' } : {})
  },
  h('span', { class: 'mi__icon' }, icon(iconName)),
  h('span', { class: 'mi__label' }, label),
  toggle || expanded ? h('span', { class: 'mi__state' }, 'OFF') : h('span', { class: 'mi__go' }, icon('arrow-right')));

  const items = {
    fit: item('fit', 'Fit all riders', o.onFit),
    dest: item('flag', 'Go to destination', o.onDest),
    route: item('route', 'Route line', o.onRoute, { toggle: true }),
    map3d: item('cube', '3D map', o.on3d, { toggle: true }),
    skin: item('moon', 'Neon Night skin', o.onSkin, { toggle: true, sub: true, hidden: true }),
    speech: item('volume', 'Spoken navigation', o.onSpeech, { toggle: true, hidden: !o.speechAvailable }),
    legend: item('info', 'Map legend', o.onLegend, { expanded: true })
  };
  const button = h('button', { class: 'btn btn--icon', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'map-menu', 'aria-label': 'Map menu', title: 'Map menu', onclick: o.onToggleMenu }, icon('apps'));
  const menu = h('div', { class: 'map-menu', id: 'map-menu', role: 'group', 'aria-label': 'Map options', hidden: true },
    h('div', { class: 'map-menu__head' }, 'Map'), items.fit, items.dest, items.route, items.map3d, items.skin, items.speech, items.legend);

  const set = (btn, on, attr = 'aria-pressed') => { btn.setAttribute(attr, String(on)); const st = btn.querySelector('.mi__state'); if (st) st.textContent = on ? 'ON' : 'OFF'; };
  /** @param {{menuOpen:boolean, routeVisible:boolean, map3d:boolean, skin:boolean, speech:boolean, legendOpen:boolean}} s */
  function sync(s) {
    set(items.route, s.routeVisible);
    set(items.map3d, s.map3d);
    set(items.speech, s.speech);
    items.speech.querySelector('.mi__icon').replaceChildren(icon(s.speech ? 'volume' : 'volume-off'));
    items.skin.hidden = !s.map3d;
    set(items.skin, s.skin);
    set(items.legend, s.legendOpen, 'aria-expanded');
    button.setAttribute('aria-expanded', String(s.menuOpen));
    menu.hidden = !s.menuOpen;
  }
  return { button, menu, items, sync };
}
