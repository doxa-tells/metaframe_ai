import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Результаты хранятся в Vercel Blob, оптимизация картинок Next не нужна
  images: { unoptimized: true },
};

export default nextConfig;
