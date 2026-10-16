// 24×24 线条图标（stroke = currentColor），地图标签和列表共用；样式沿用 skdmap
const p = (d: string) =>
  `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`

export const ICONS = {
  dining: p('<path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5M17 3c-1.7 1.3-2.5 3.5-2.5 6.5V13H17v8"/>'),
  academic: p('<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2.5 9 2.5 12 0v-5"/>'),
  housing: p('<path d="M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
  sports: p('<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M5.6 5.6c3.4 3.4 3.4 9.4 0 12.8M18.4 5.6c-3.4 3.4-3.4 9.4 0 12.8"/>'),
  service: p('<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/>'),
  gate: p('<path d="M4 21V8l8-5 8 5v13"/><path d="M9 21v-7h6v7"/>'),
  walkway: p('<path d="M3 11a9 7 0 0 1 18 0z"/><path d="M12 11v8a2 2 0 0 1-4 0"/>'),
  transit: p('<rect x="5" y="3" width="14" height="13" rx="3"/><path d="M5 10h14M8 20l-1.5 2M16 20l1.5 2M8.5 13h.01M15.5 13h.01"/>'),
  parking: p('<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M9.5 17V7h3.5a3 3 0 0 1 0 6H9.5"/>'),
  life: p('<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'),
  home: p('<path d="M4 9l8-6 8 6v11H4z"/><path d="M4 14h16"/>'),
  walk: p('<circle cx="13" cy="4" r="2"/><path d="M9 21l2.5-7L14 16v5M7.5 11l2.5-3.5 3.5 1 2.5 3M11.5 14l-1-4"/>'),
  pin: p('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  search: p('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  clock: p('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  entrance: p('<path d="M10 3h9v18h-9"/><path d="M3 12h10M9.5 8.5 13 12l-3.5 3.5"/>'),
  users: p('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c2 .7 3.2 2.6 3.7 5.5"/>'),
  door: p('<path d="M14 3H6v18h8M14 3l5 2v14l-5 2zM11 12h.01"/>'),
  road: p('<path d="M8 3 5 21M16 3l3 18M12 4v2M12 10v3M12 17v3"/>'),
  rain: p('<path d="M7 15a4.5 4.5 0 0 1-.5-9A6 6 0 0 1 18 7.5a3.8 3.8 0 0 1-.5 7.5z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>'),
  swap: p('<path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/>'),
  eye: p('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeClosed: p('<path d="M3 8c2 4 5 6 9 6s7-2 9-6M4 14l2-3M9 18l1-4M15 18l-1-4M20 14l-2-3"/>'),
  plus: p('<path d="M12 5v14M5 12h14"/>'),
  minus: p('<path d="M5 12h14"/>'),
  close: p('<path d="M6 6l12 12M18 6 6 18"/>'),
  chevron: p('<path d="m9 6 6 6-6 6"/>'),
  back: p('<path d="m15 6-6 6 6 6"/>'),
  edit: p('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
  trash: p('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  target: p('<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  lock: p('<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'),
}
export type IconName = keyof typeof ICONS
