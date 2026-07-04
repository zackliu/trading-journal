export type IconName =
  | 'select'
  | 'rect'
  | 'line'
  | 'arrow'
  | 'hline'
  | 'text'
  | 'draw'
  | 'stamp'
  | 'plus'
  | 'front'
  | 'sendtoback'
  | 'fit'
  | 'lock'
  | 'unlock'
  | 'undo'
  | 'redo'
  | 'save'
  | 'back'
  | 'import'
  | 'trash'
  | 'tag'
  | 'browse'
  | 'view'
  | 'grip'
  | 'stats';

const PATHS: Record<IconName, string> = {
  select: 'M5 3l5 15 2.2-6.3L18.5 9.5z',
  rect: 'M4 6h16v12H4z',
  line: 'M5 19L19 5',
  arrow: 'M5 19L18 6M18 6h-6M18 6v6',
  hline: 'M4 12h16',
  text: 'M6 6h12M12 6v13',
  draw: 'M4 20l4-1L18 9l-3-3L5 16z',
  stamp: 'M8 10a4 4 0 118 0c0 2-2 2.5-2 4h-4c0-1.5-2-2-2-4zM6 18h12v2H6z',
  plus: 'M12 5v14M5 12h14',
  front: 'M12 4l4 4h-3v6h-2V8H8zM4 18h16',
  sendtoback: 'M12 16l-4-4h3V6h2v6h3zM4 20h16',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  lock: 'M7 10V7a5 5 0 0110 0v3M5 10h14v10H5zM12 14v3',
  unlock: 'M7 10V7a5 5 0 019.6-2M5 10h14v10H5zM12 14v3',
  undo: 'M9 8l-4 4 4 4M5 12h9a5 5 0 010 10',
  redo: 'M15 8l4 4-4 4M19 12h-9a5 5 0 000 10',
  save: 'M5 4h11l3 3v13H5zM8 4v6h7V4M8 20v-6h8v6',
  back: 'M15 5l-7 7 7 7',
  import: 'M12 4v11M8 11l4 4 4-4M5 20h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  tag: 'M4 12l8-8h8v8l-8 8zM15 9h.01',
  browse: 'M4 6h6v12H4zM12 7h8M12 12h8M12 17h8',
  view: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 9a3 3 0 100 6 3 3 0 000-6z',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  stats: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
};

export function Icon({ name }: { name: IconName }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
