/**
 * Gerente da loja — personagem ORIGINAL desenhado em SVG (nada do jogo de referência): mulher de cabelo crespo
 * preso em coque alto, óculos redondos, camisa amarela e avental verde com crachá. Poses: busto (retrato),
 * comemorando (braços para cima) e joinha.
 */
export type ManagerPose = 'bust' | 'cheer' | 'thumbs';

const SKIN = '#b9784e', SKIN_D = '#9a5d38', HAIR = '#2a1913', HAIR_L = '#3d261c';
const SHIRT = '#ffcf3f', SHIRT_D = '#e5ac17', APRON = '#1f9d6e', APRON_D = '#147551', GLASS = '#22313a';
const OL = 'stroke="#2a1a14" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"';

function arm(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): string {
  // ombro → cotovelo (manga até a metade) → mão
  const mx = x0 + (x1 - x0) * 0.55, my = y0 + (y1 - y0) * 0.55;
  return `<path d="M${x0} ${y0}L${x1} ${y1}L${x2} ${y2}" fill="none" stroke="#2a1a14" stroke-width="27" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M${x0} ${y0}L${x1} ${y1}L${x2} ${y2}" fill="none" stroke="${SKIN}" stroke-width="21" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M${x0} ${y0}L${mx} ${my}" fill="none" stroke="#2a1a14" stroke-width="33" stroke-linecap="round"/>
    <path d="M${x0} ${y0}L${mx} ${my}" fill="none" stroke="${SHIRT}" stroke-width="27" stroke-linecap="round"/>`;
}
function openHand(x: number, y: number, flip = false): string {
  const s = flip ? -1 : 1;
  return `<g transform="translate(${x} ${y}) scale(${s} 1)">
    <path d="M-12 6c-2-8 0-16 4-20 2-2 4 0 4 2v-6c0-3 5-3 5 0v-2c0-3 5-3 5 0v3c0-3 5-3 5 0v10c2-3 6-2 5 1-2 6-4 10-8 14-5 4-17 4-20-2z" fill="${SKIN}" ${OL}/>
  </g>`;
}
function thumbHand(x: number, y: number, flip = false): string {
  const s = flip ? -1 : 1;
  return `<g transform="translate(${x} ${y}) scale(${s} 1)">
    <rect x="-13" y="-6" width="26" height="22" rx="8" fill="${SKIN}" ${OL}/>
    <path d="M-6 -4v-14c0-5 7-5 7 0v14" fill="${SKIN}" ${OL}/>
    <path d="M-9 3h18M-9 9h17" stroke="${SKIN_D}" stroke-width="2.500" stroke-linecap="round"/>
  </g>`;
}

function body(pose: ManagerPose): string {
  let arms = '';
  if (pose === 'cheer') arms = arm(78, 196, 52, 140, 44, 86) + arm(162, 196, 188, 140, 196, 86);
  else if (pose === 'thumbs') arms = arm(76, 200, 56, 252, 88, 236) + arm(164, 200, 184, 252, 152, 236);
  else arms = arm(76, 200, 64, 250, 66, 296) + arm(164, 200, 176, 250, 174, 296);
  const torso = `<path d="M62 300L66 206Q70 180 98 172H142Q170 180 174 206L178 300Z" fill="${SHIRT}" ${OL}/>
    <path d="M98 172l22 22 22-22" fill="${SHIRT_D}" ${OL}/>
    <path d="M94 196H146V232Q146 240 154 244L160 300H80L86 244Q94 240 94 232Z" fill="${APRON}" ${OL}/>
    <path d="M94 196L102 174M146 196L138 174" stroke="${APRON_D}" stroke-width="6" stroke-linecap="round"/>
    <rect x="104" y="252" width="32" height="22" rx="4" fill="${APRON_D}" ${OL}/>
    <path d="M128 252l6-18" stroke="#f2c14e" stroke-width="5" stroke-linecap="round"/><path d="M134 234l1.500-4" stroke="#e8463c" stroke-width="5" stroke-linecap="round"/>
    <rect x="124" y="206" width="20" height="14" rx="2.500" fill="#fff" ${OL}/><rect x="124" y="206" width="20" height="4.500" rx="2" fill="#1ea0f2"/>
    <path d="M128 214h12M128 217.500h8" stroke="#8a96a3" stroke-width="1.800" stroke-linecap="round"/>`;
  // braços levantados ficam atrás do tronco; os da frente (joinha/parado) por cima
  const hands = pose === 'cheer' ? openHand(44, 76, true) + openHand(196, 76) : pose === 'thumbs' ? thumbHand(90, 232) + thumbHand(150, 232, true) : '';
  return pose === 'cheer' ? arms + hands + torso : torso + arms + hands;
}

function head(pose: ManagerPose): string {
  const happy = pose !== 'bust';
  return `
    <circle cx="120" cy="44" r="27" fill="${HAIR}" ${OL}/>
    <circle cx="101" cy="36" r="11" fill="${HAIR_L}"/><circle cx="138" cy="34" r="10" fill="${HAIR_L}"/><circle cx="120" cy="24" r="10" fill="${HAIR_L}"/>
    <path d="M100 66q20-10 40 0" stroke="#e8463c" stroke-width="7" fill="none" stroke-linecap="round"/>
    <circle cx="80" cy="102" r="17" fill="${HAIR}" ${OL}/><circle cx="160" cy="102" r="17" fill="${HAIR}" ${OL}/>
    <rect x="108" y="146" width="24" height="30" fill="${SKIN_D}" ${OL}/>
    <ellipse cx="78" cy="118" rx="8" ry="11" fill="${SKIN}" ${OL}/><ellipse cx="162" cy="118" rx="8" ry="11" fill="${SKIN}" ${OL}/>
    <circle cx="77" cy="131" r="4" fill="#ffd23f" stroke="#c4900f" stroke-width="2"/><circle cx="163" cy="131" r="4" fill="#ffd23f" stroke="#c4900f" stroke-width="2"/>
    <ellipse cx="120" cy="114" rx="43" ry="47" fill="${SKIN}" ${OL}/>
    <path d="M78 104Q80 64 120 63Q160 64 162 104Q152 80 128 78Q132 86 124 90Q120 80 104 82Q88 86 78 104Z" fill="${HAIR}" ${OL}/>
    <path d="M94 98q8-6 16 0M130 98q8-6 16 0" stroke="${HAIR}" stroke-width="4.500" fill="none" stroke-linecap="round"/>
    <circle cx="102" cy="114" r="14" fill="#fff" fill-opacity=".2" stroke="${GLASS}" stroke-width="4.500"/>
    <circle cx="138" cy="114" r="14" fill="#fff" fill-opacity=".2" stroke="${GLASS}" stroke-width="4.500"/>
    <path d="M116 113q4-3 8 0M88 112l-9-3M152 112l9-3" stroke="${GLASS}" stroke-width="4" fill="none" stroke-linecap="round"/>
    ${happy
    ? `<path d="M96 116q6-6 12 0M132 116q6-6 12 0" stroke="#2a1913" stroke-width="4" fill="none" stroke-linecap="round"/>`
    : `<ellipse cx="102" cy="116" rx="4.500" ry="5.500" fill="#2a1913"/><ellipse cx="138" cy="116" rx="4.500" ry="5.500" fill="#2a1913"/>
       <circle cx="103.500" cy="114" r="1.600" fill="#fff"/><circle cx="139.500" cy="114" r="1.600" fill="#fff"/>`}
    <path d="M121 120q-5 10 0 13q3 1 6-1" stroke="${SKIN_D}" stroke-width="3" fill="none" stroke-linecap="round"/>
    <circle cx="90" cy="134" r="7" fill="#ff7d6e" opacity=".35"/><circle cx="150" cy="134" r="7" fill="#ff7d6e" opacity=".35"/>
    ${happy
    ? `<path d="M98 138Q120 166 142 138Q120 148 98 138Z" fill="#7a1f2b" ${OL}/><path d="M102 140Q120 147 138 140L136 145Q120 150 104 145Z" fill="#fff"/>
       <path d="M110 152q10-6 20 0q-10 6-20 0z" fill="#ff8a8a"/>`
    : `<path d="M102 138Q120 154 138 138" stroke="#7a1f2b" stroke-width="4.500" fill="none" stroke-linecap="round"/>`}`;
}

/** SVG do gerente. `bust` = retrato recortado (cabeça e ombros). */
export function managerSvg(pose: ManagerPose, cls = ''): string {
  const vb = pose === 'bust' ? '50 14 140 168' : '20 6 200 300';
  const inner = body(pose === 'bust' ? 'bust' : pose) + head(pose);
  return `<svg class="mgr ${cls}" viewBox="${vb}" preserveAspectRatio="xMidYMin meet" aria-hidden="true" focusable="false">${inner}</svg>`;
}
