import type { NextConfig } from "next";
import { BASE } from "./lib/base";

const nextConfig: NextConfig = {
  // Всё приложение — под /studio (metaframe.ltd/studio)
  basePath: BASE,
  // Результаты хранятся в R2, оптимизация картинок Next не нужна
  images: { unoptimized: true },
  // Заголовки безопасности: студию нельзя встроить в чужую страницу (кликджекинг), тип файлов не угадывается,
  // адрес страницы не уходит на чужие сайты, браузерные датчики выключены
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        { key: "Strict-Transport-Security", value: "max-age=31536000" },
      ],
    }];
  },
  async redirects() {
    // Корень домена и старые адреса без /studio ведут в студию
    return [
      ...["", "/image", "/video", "/nodes", "/login"].map((p) => ({
        source: p || "/", destination: `${BASE}${p || "/image"}`, basePath: false as const, permanent: false,
      })),
      // Презентация студии: статические файлы в public/presentation, открыта без входа (см. matcher в proxy.ts)
      { source: "/presentation", destination: `${BASE}/presentation/index.html`, basePath: false as const, permanent: false },
      { source: `${BASE}/presentation`, destination: `${BASE}/presentation/index.html`, basePath: false as const, permanent: false },
    ];
  },
};

export default nextConfig;
