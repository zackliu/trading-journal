export type IconName =
  | 'select'
  | 'rect'
  | 'line'
  | 'arrow'
  | 'hline'
  | 'text'
  | 'draw'
  | 'mm'
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
  | 'stats'
  | 'gauge'
  | 'sortdesc'
  | 'sortasc'
  | 'pencil'
  | 'link'
  | 'unlink'
  | 'settings'
  | 'folder';

const PATHS: Record<IconName, string> = {
  select: 'M5 3l5 15 2.2-6.3L18.5 9.5z',
  rect: 'M4 6h16v12H4z',
  line: 'M5 19L19 5',
  arrow: 'M5 19L18 6M18 6h-6M18 6v6',
  hline: 'M4 12h16',
  text: 'M6 6h12M12 6v13',
  draw: 'M4 20l4-1L18 9l-3-3L5 16z',
  mm: 'M5 6h14M5 12h9M5 18h14',
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
  gauge: 'M4 15a8 8 0 0116 0M12 15l3.5-3.5',
  sortdesc: 'M4 7h9M4 12h6M4 17h3M17 6v11M14 14l3 3 3-3',
  sortasc: 'M4 7h3M4 12h6M4 17h9M17 18V7M14 10l3-3 3 3',
  pencil: 'M5 19h3L18 9l-3-3L5 16zM14 6l3 3',
  link: 'M9.5 14.5l5-5M7.7 16.3l-1.4 1.4a3.5 3.5 0 01-5-5l3-3a3.5 3.5 0 015 0M16.3 7.7l1.4-1.4a3.5 3.5 0 015 5l-3 3a3.5 3.5 0 01-5 0',
  unlink: 'M9.5 14.5l5-5M4 4l16 16M6.3 17.7a3.5 3.5 0 01-5-5l2-2M17.7 6.3a3.5 3.5 0 015 5l-2 2',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.34 1.88l.06.06-1.8 3.12-.09-.03a1.7 1.7 0 00-1.8.22l-.47.27a1.7 1.7 0 00-.83 1.69V22h-3.6v-.09a1.7 1.7 0 00-.83-1.69l-.47-.27a1.7 1.7 0 00-1.8-.22l-.09.03-1.8-3.12.06-.06A1.7 1.7 0 006.6 15v-.55a1.7 1.7 0 00-.97-1.57l-.08-.03V9.24l.08-.03a1.7 1.7 0 00.97-1.57v-.55a1.7 1.7 0 00-.34-1.88l-.06-.06L8 2.03l.09.03a1.7 1.7 0 001.8-.22l.47-.27A1.7 1.7 0 0011.19 0h3.6a1.7 1.7 0 00.83 1.57l.47.27a1.7 1.7 0 001.8.22l.09-.03 1.8 3.12-.06.06a1.7 1.7 0 00-.34 1.88v.55a1.7 1.7 0 00.97 1.57l.08.03v3.61l-.08.03a1.7 1.7 0 00-.97 1.57z',
  folder: 'M3 7a1 1 0 011-1h5l2 2h9a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1z',
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
