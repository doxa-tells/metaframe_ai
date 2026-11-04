import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Заголовки: Hooskai Chamfered Square (SIL OFL 1.1, см. app/fonts/Hooskai-OFL.txt)
const brand = localFont({
  src: "./fonts/Hooskai-Chamfered-Square.woff2",
  variable: "--font-brand",
  display: "swap",
  weight: "400",
});
// Весь остальной текст: DEC Terminal Modern (лицензия: free for personal use, см. app/fonts)
const body = localFont({
  src: "./fonts/DEC-Terminal-Modern.woff2",
  variable: "--font-body",
  display: "swap",
  weight: "400",
});

export const metadata: Metadata = {
  title: "MetaFrame AI",
  description: "Генерация фото и видео: Nano Banana, Soul, Seedance, Kling",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${brand.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
