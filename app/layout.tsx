import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Один шрифт на всю студию: MF Sans — латиница Plus Jakarta Sans + подогнанная кириллица (русский, казахский).
// Собирается скриптом scripts/build-mf-sans.py; лицензии — app/fonts/MFSans-OFL.txt (SIL OFL 1.1).
// Заголовки и текст различаются только насыщенностью (см. конец app/globals.css).
const mf = localFont({
  src: [
    { path: "./fonts/MFSans-300.woff2", weight: "300", style: "normal" },
    { path: "./fonts/MFSans-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/MFSans-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/MFSans-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/MFSans-700.woff2", weight: "700", style: "normal" },
    { path: "./fonts/MFSans-800.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-mf",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MetaFrame AI",
  description: "Генерация фото и видео: Nano Banana, Soul, Seedance, Kling",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={mf.variable}>
      <body>{children}</body>
    </html>
  );
}
