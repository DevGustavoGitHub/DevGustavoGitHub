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

/* ---- ícones do botão de ação (um por ação) ---- */
const S = 'fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"';
const BOX = (x: number, y: number, w: number, h: number): string =>
  `<rect fill="currentColor" x="${x}" y="${y}" width="${w}" height="${h}" rx="2.5"/><rect fill="#000" fill-opacity=".28" x="${x + w / 2 - 2}" y="${y}" width="4" height="${h / 2}"/>`;
const SHELF = '<path d="M6 10v46M58 10v46M6 34h52M6 56h52" ' + S + '/>';

export const ACTION_ICONS: Record<string, string> = {
  /** Pegar: mão pegando uma caixa. */
  pick: svg(BOX(20, 8, 24, 20) + '<path d="M6 36h10l8 6h14a4 4 0 0 1 0 8H26M6 36v18h12l10 4 22-8c3-1 4-4 2-6" ' + S + '/>'),
  /** Repor: caixa → prateleira. */
  stock: svg(BOX(4, 24, 20, 17) + '<path d="M28 33h12M34 27l6 6-6 6" ' + S + '/><path d="M44 8v48M60 8v48M44 30h16M44 50h16" ' + S.replace('4.5', '3.5') + '/>'),
  /** Retirar: prateleira → caixa. */
  pull: svg('<path d="M4 8v48M20 8v48M4 30h16M4 50h16" ' + S.replace('4.5', '3.5') + '/><path d="M40 33H28M34 27l-6 6 6 6" ' + S + '/>' + BOX(40, 24, 20, 17)),
  /** Abrir caixa. */
  open: ICON_BOX_OPEN,
  /** Fechar caixa. */
  close: ICON_BOX_CLOSE,
  /** Jogar fora: lixeira. */
  trash: svg('<path d="M10 16h44M24 16V9h16v7M15 16l3 40h28l3-40M27 26v22M37 26v22" ' + S + '/>'),
  /** Reciclar: setas circulares. */
  recycle: svg('<path d="M32 8l9 14H23zM44 40l9-14M53 26l-9 14h-10M20 40l-9-14M11 26l9 14h10" ' + S + '/>'),
  /** Limpar: vassoura. */
  clean: svg('<path d="M52 6L30 34" ' + S + '/><path fill="currentColor" d="M26 30l10 8c2 8-2 16-14 20-8 2-14 0-16-2 8-4 8-12 6-20z"/>'),
  /** Sentar no caixa: cadeira. */
  sit: svg('<path d="M20 6v28h28M20 34v24M46 34v24M20 20h6" ' + S + '/><rect fill="currentColor" x="18" y="32" width="34" height="8" rx="3"/>'),
  /** Usar computador: notebook. */
  pc: svg('<rect x="12" y="12" width="40" height="28" rx="3" ' + S + '/><path fill="currentColor" d="M3 46h58l-4 8H7z"/>'),
  /** Abrir/Fechar loja: placa pendurada. */
  sign: svg('<path d="M8 8h48M20 8v8M44 8v8" ' + S + '/><rect fill="currentColor" x="10" y="16" width="44" height="34" rx="4"/><path d="M18 33h28" stroke="#000" stroke-opacity=".35" stroke-width="5" stroke-linecap="round"/>'),
  /** Preço: etiqueta. */
  price: svg('<path fill="currentColor" d="M6 8h24l28 28-22 22L8 30z"/><circle cx="20" cy="20" r="4.5" fill="#000" fill-opacity=".4"/>'),
  /** Mover: setas cruzadas. */
  move: ICON_MOVE,
  /** Guardar no depósito: caixa entrando na estante. */
  store: svg(SHELF + BOX(14, 14, 14, 14) + '<path d="M44 14v14M38 22l6 6 6-6" ' + S.replace('4.5', '3.5') + '/>'),
  /** Retirar do depósito: caixa saindo da estante. */
  take: svg(SHELF + BOX(14, 38, 14, 14) + '<path d="M44 28V14M38 20l6-6 6 6" ' + S.replace('4.5', '3.5') + '/>'),
  /** Largar: caixa com seta para baixo. */
  drop: ICON_DROP,
  /** Sem alvo / desabilitado: mão cinza. */
  none: ICON_HAND.replace(/currentColor/g, '#aab2bd'),
};
