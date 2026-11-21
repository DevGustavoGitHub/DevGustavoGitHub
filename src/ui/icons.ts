/** Ícones SVG originais (traço). Todos 24x24, currentColor. */
const P: Record<string, string> = {
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9M9.5 10c0-1.2 1.2-2 2.5-2s2.5.8 2.5 2-1.2 1.6-2.5 2-2.5.8-2.5 2 1.2 2 2.5 2 2.5-.8 2.5-2"/>',
  tablet: '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M10 18h4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-4 3.5-5.5 7-5.5s6.2 1.5 7 5.5"/>',
  users: '<circle cx="9" cy="9" r="3"/><path d="M3.5 19c.6-3.3 2.7-4.6 5.5-4.6s4.9 1.300 5.500 4.600"/><circle cx="17" cy="9.500" r="2.300"/><path d="M16.500 14.600c2.400-.1 3.600 1.200 4 3.700"/>',
  star: '<path d="M12 3.5l2.6 5.400 5.900.8-4.300 4.100 1.100 5.800L12 16.800 6.700 19.600l1.100-5.800L3.500 9.700l5.900-.8z"/>',
  cart: '<path d="M3 4h2.500l2 11h10l2-8H7"/><circle cx="9" cy="19" r="1.500"/><circle cx="17" cy="19" r="1.500"/>',
  tag: '<path d="M3.500 12.500V4.500h8l9 9-8 8z"/><circle cx="8" cy="9" r="1.200"/>',
  badge: '<path d="M12 3l7 3v5c0 4.500-3 8-7 10-4-2-7-5.500-7-10V6z"/><path d="M9 12l2.200 2.200L15.500 10"/>',
  sofa: '<path d="M5 11V8a3 3 0 013-3h8a3 3 0 013 3v3"/><path d="M3 12a2 2 0 014 0v3h10v-3a2 2 0 014 0v5H3z"/><path d="M6 20v-3M18 20v-3"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  box: '<path d="M3.500 8L12 4l8.500 4v8.500L12 20.500l-8.500-4z"/><path d="M3.500 8L12 12l8.500-4M12 12v8.500"/>',
  brush: '<path d="M14 4l6 6-8 8H6v-6z"/><path d="M5 20h6"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  up: '<path d="M12 19V6M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v13M6 13l6 6 6-6"/>',
  lock: '<rect x="5" y="10.500" width="14" height="9.500" rx="2"/><path d="M8 10.500V8a4 4 0 018 0v2.500"/>',
  check: '<path d="M5 12.500l4.500 4.500L19 7.500"/>',
  store: '<path d="M4 9l1.500-5h13L20 9"/><path d="M4 9a2.700 2.700 0 005.300 0 2.700 2.700 0 005.400 0A2.700 2.700 0 0020 9"/><path d="M5.500 12v8h13v-8"/><path d="M10 20v-5h4v5"/>',
  hand: '<path d="M8 12V6a1.500 1.500 0 013 0v5M11 11V4.500a1.500 1.500 0 013 0V11M14 11V6a1.500 1.500 0 013 0v7"/><path d="M8 12.500l-1.300-1.800a1.500 1.500 0 00-2.400 1.800L8 18a6 6 0 005 3h.5a5.500 5.500 0 005.500-5.500V13"/>',
  scan: '<path d="M4 8V5a1 1 0 011-1h3M20 8V5a1 1 0 00-1-1h-3M4 16v3a1 1 0 001 1h3M20 16v3a1 1 0 01-1 1h-3"/><path d="M4 12h16"/>',
  card: '<rect x="3" y="6" width="18" height="12" rx="2.500"/><path d="M3 10h18M7 15h4"/>',
  undo: '<path d="M9 7L4.500 11.500 9 16"/><path d="M5 11.500h9a5 5 0 010 10h-2"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 00-3.500 10.900c.6.500 1 1.200 1 2.100h5c0-.9.400-1.600 1-2.100A6 6 0 0012 3z"/>',
  backspace: '<path d="M9 5h11v14H9l-6-7z"/><path d="M13 9.500l4 5M17 9.500l-4 5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.600 5.600L7 7M17 17l1.400 1.400M18.400 5.600L17 7M7 17l-1.400 1.400"/>',
  clock: '<circle cx="12" cy="12" r="8.500"/><path d="M12 7v5l3 2"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.500M12 17.300v.2"/>',
  bank: '<path d="M3.500 9.500L12 4l8.500 5.500z"/><path d="M6 11v6M10 11v6M14 11v6M18 11v6M4 20h16"/>',
  play: '<path d="M8 5.500v13l11-6.500z"/>',
};
export type IconName = keyof typeof P;
export function icon(name: string, size = 22): string {
  const body = P[name] ?? P.box;
  return `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
export const iconEl = (name: string, size = 22): HTMLSpanElement => {
  const s = document.createElement('span');
  s.className = 'ic-wrap';
  s.innerHTML = icon(name, size);
  return s;
};
