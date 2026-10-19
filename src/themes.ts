/**
 * Board colour themes.
 *
 * The original ships textured PNG/JPG boards; this clean-room version renders
 * a flat two-colour board from an inline SVG, so only the colours are kept.
 * Colour values are plain data (hex strings) taken from the board's theme table.
 */
export interface BoardTheme {
  /** Colour of the dark squares. */
  dark: string;
  /** Colour of the light squares. */
  light: string;
  /** Colour of last-move / selection highlights on this board. */
  highlight: string;
}

export const BOARD_THEMES: Record<string, BoardTheme> = {
  green: { dark: '#779952', light: '#edeed1', highlight: '#ffff00' },
  brown: { dark: '#B58863', light: '#F0D9B5', highlight: '#ffff00' },
  blue: { dark: '#4D6D92', light: '#ECECD7', highlight: '#00a5ff' },
  red: { dark: '#BA5546', light: '#F0D8BF', highlight: '#f8f893' },
  orange: { dark: '#D08B18', light: '#FCE4B2', highlight: '#ffff00' },
  tan: { dark: '#D08B18', light: '#FCE4B2', highlight: '#f7d84a' },
  purple: { dark: '#8877B7', light: '#EFEFEF', highlight: '#7dacc9' },
  sky: { dark: '#c2d7e2', light: '#efefef', highlight: '#65daf7' },
  bubblegum: { dark: '#f9cdd3', light: '#fff3f3', highlight: '#de5d6f' },
  light: { dark: '#aaaaaa', light: '#dcdcdc', highlight: '#a4b8c4' },
  overlay: { dark: '#789ebd', light: '#4878a0', highlight: '#0d9acf' },
  icy_sea: { dark: '#7a9db2', light: '#c5d5dc', highlight: '#5ed7f1' },
  sand: { dark: '#b8a590', light: '#e5d3c4', highlight: '#e2bc87' },
  stone: { dark: '#666463', light: '#c8c3bd', highlight: '#36525f' },
  marble: { dark: '#706b66', light: '#c7bdaa', highlight: '#f0db86' },
  metal: { dark: '#6e6e6e', light: '#c9c9c9', highlight: '#a3becd' },
  walnut: { dark: '#835f42', light: '#c0a684', highlight: '#d1a52d' },
  dark_wood: { dark: '#8d675e', light: '#e7cdb2', highlight: '#cc9122' },
  burled_wood: { dark: '#895132', light: '#d9b088', highlight: '#ee9016' },
  parchment: { dark: '#B58863', light: '#F0D9B5', highlight: '#d8cc66' },
  tournament: { dark: '#316549', light: '#ebece8', highlight: '#a4c25b' },
  neon: { dark: '#636363', light: '#b9b9b9', highlight: '#6d90a6' },
  '8_bit': { dark: '#6a9b41', light: '#f3f3f4', highlight: '#ffff00' },
};

export const DEFAULT_THEME = 'green';

export function resolveTheme(name: string | BoardTheme | undefined): BoardTheme {
  if (!name) return BOARD_THEMES[DEFAULT_THEME];
  if (typeof name !== 'string') return name;
  return BOARD_THEMES[name] ?? BOARD_THEMES[DEFAULT_THEME];
}

/** `data:` URI of an 8×8 checkerboard in the theme's colours (a1 is dark). */
export function boardImageUri(theme: BoardTheme): string {
  const cells: string[] = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      // row 0 is rank 8, so a8 (f=0,r=0) is light and a1 (f=0,r=7) is dark
      if ((f + r) % 2 === 0) cells.push(`M${f} ${r}h1v1h-1z`);
    }
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges">` +
    `<rect width="8" height="8" fill="${theme.dark}"/>` +
    `<path fill="${theme.light}" d="${cells.join('')}"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
