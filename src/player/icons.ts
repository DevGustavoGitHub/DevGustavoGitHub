/** Ícones originais (SVG inline, cor = currentColor) dos controles de jogo do player. */
const svg = (body: string, extra = ''): string =>
  `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" ${extra}>${body}</svg>`;

/** Mão pegando (dorso arredondado, quatro dedos caídos e polegar). */
export const ICON_HAND = svg(
  '<path fill="currentColor" d="M9 31c0-10 8-17 19-17h10c10 0 17 7 17 16v2c0 3-2 5-5 5H14c-3 0-5-2-5-5z"/>' +
  '<rect fill="currentColor" x="14.5" y="31" width="7.5" height="17" rx="3.75"/>' +
  '<rect fill="currentColor" x="24" y="31" width="7.5" height="21" rx="3.75"/>' +
  '<rect fill="currentColor" x="33.5" y="31" width="7.5" height="20" rx="3.75"/>' +
  '<rect fill="currentColor" x="43" y="31" width="7.5" height="15.5" rx="3.75"/>' +
  '<rect fill="currentColor" x="3.5" y="27" width="8" height="15" rx="4" transform="rotate(-30 7.5 34.5)"/>',
);

/** Arremessar: trajetória pontilhada terminando numa caixa. */
export const ICON_THROW = svg(
  '<path d="M8 50C15 32 27 22 41 19" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-dasharray="1 9"/>' +
  '<g transform="rotate(-16 47 20)"><rect fill="currentColor" x="36" y="10" width="22" height="19" rx="3"/>' +
  '<rect fill="#000" fill-opacity=".28" x="44.5" y="10" width="5" height="19"/></g>' +
  '<path d="M6 40l6 12 12-4" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>',
);

/** Largar: caixa com seta para baixo. */
export const ICON_DROP = svg(
  '<rect fill="currentColor" x="16" y="6" width="32" height="25" rx="3.5"/>' +
  '<rect fill="#000" fill-opacity=".28" x="29" y="6" width="6" height="25"/>' +
  '<path d="M32 37v19M22 47l10 10 10-10" fill="none" stroke="currentColor" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>',
);

/** Caixa aberta (abas para fora) — ação "Abrir caixa". */
export const ICON_BOX_OPEN = svg(
  '<path fill="currentColor" d="M14 30h36v21a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4z"/>' +
  '<path fill="currentColor" d="M13 28L4 17l15-4 7 15zM51 28l9-11-15-4-7 15z"/>' +
  '<rect fill="#000" fill-opacity=".25" x="14" y="30" width="36" height="5"/>',
);

/** Caixa fechada com fita — ação "Fechar caixa". */
export const ICON_BOX_CLOSE = svg(
  '<path fill="currentColor" d="M12 25h40v26a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4z"/>' +
  '<rect fill="currentColor" x="9" y="15" width="46" height="11" rx="2.5"/>' +
  '<rect fill="#000" fill-opacity=".3" x="29" y="15" width="6" height="22"/>',
);

/** Mover (setas em quatro direções). */
export const ICON_MOVE = svg(
  '<path fill="currentColor" d="M32 4l9 10h-6v13h13v-6l10 11-10 11v-6H35v13h6L32 60l-9-10h6V37H16v6L6 32l10-11v6h13V14h-6z"/>',
);

/** Sair (seta saindo de um batente). */
export const ICON_EXIT = svg(
  '<path d="M30 9h17a5 5 0 0 1 5 5v36a5 5 0 0 1-5 5H30" fill="none" stroke="currentColor" stroke-width="5.5" stroke-linecap="round"/>' +
  '<path d="M40 32H9M19 21L8 32l11 11" fill="none" stroke="currentColor" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>',
);
