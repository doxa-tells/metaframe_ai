import type { NextConfig } from "next";
import { BASE } from "./lib/base";

const nextConfig: NextConfig = {
  // Всё приложение — под /studio (metaframe.ltd/studio)
  basePath: BASE,
  // Результаты хранятся в R2, оптимизация картинок Next не нужна
  images: { unoptimized: true },
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
