// Набор простых иконок (stroke), без внешних зависимостей
const PATHS: Record<string, string> = {
  image: "M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9.5a1.5 1.5 0 1 0 0-.01",
  video: "M3 6h12v12H3zM15 10l6-3v10l-6-3",
  nodes: "M5 6a2 2 0 1 0 0 .01M19 12a2 2 0 1 0 0 .01M5 18a2 2 0 1 0 0 .01M7 6h4l6 6M7 18h4l6-6",
  chat: "M4 5h16v11H9l-5 4z",
  plus: "M12 5v14M5 12h14",
  x: "M6 6l12 12M18 6L6 18",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13",
  copy: "M8 8h11v11H8zM5 16V5h11",
  send: "M4 12l16-8-6 16-2-7z",
  sparkle: "M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z",
  refresh: "M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5",
  play: "M8 5v14l11-7z",
  upload: "M12 16V4M7 9l5-5 5 5M5 20h14",
  settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 12l2-1-1-3-2 .5-1.5-1.5.5-2-3-1-1 2h-2l-1-2-3 1 .5 2L6 9.5 4 9l-1 3 2 1v1l-2 1 1 3 2-.5 1.5 1.5-.5 2 3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .5 1-3-2-1z",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
  insert: "M5 12h10M11 8l4 4-4 4M19 5v14",
  save: "M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6",
  folder: "M3 6h6l2 2h10v11H3z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1-4 4-6 8-6s7 2 8 6",
  stop: "M7 7h10v10H7z",
  chevron: "M8 10l4 4 4-4",
  left: "M15 5l-7 7 7 7",
  right: "M9 5l7 7-7 7",
  back: "M10 6l-6 6 6 6M4 12h16",
  reuse: "M4 7h12l-3-3M20 17H8l3 3",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  masonry: "M4 4h7v10H4zM13 4h7v6h-7zM4 16h7v4H4zM13 12h7v8h-7z",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  selectall: "M4 4h10v10H4zM10 18h10V8M7 9l2 2 4-4",
  archive: "M3 5h18v4H3zM5 9v11h14V9M10 13h4",
  ratio: "M5 7h14v10H5z",
  check: "M5 12l5 5 9-10",
  pencil: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  gem: "M6 4h12l3 5-9 11L3 9zM3 9h18M9 4l3 16M15 4l-3 16",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  sound: "M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  film: "M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  at: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-4 7.5",
  sliders: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4",
  star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
  library: "M4 7h4l2 2h10v10H4zM4 7V5h6M8 13l2.5 2.5L13 13l3 3",
};

export function Icon({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}
