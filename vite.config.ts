import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(() => {
  // Claude 아티팩트용 빌드: ARTIFACT=1 → 상대 경로, 서비스 워커 없음 (아티팩트에선 막혀 있음)
  if (process.env.ARTIFACT)
    return { base: "./", build: { target: "es2022", outDir: "dist-artifact", chunkSizeWarningLimit: 4000 } };
  return {
    // GitHub Pages(저장소 이름 경로)에 올릴 때: BASE_PATH=/knitting/ npm run build
    base: process.env.BASE_PATH || "/",
    build: { target: "es2022", chunkSizeWarningLimit: 2000 },
    plugins: [
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["icon.svg", "icon-192.png", "icon-512.png"],
        manifest: {
          name: "도안 단수 카운터",
          short_name: "단수 카운터",
          description: "뜨개 도안을 파트별 단으로 나누고 차트 위에 지금 뜨는 단을 표시해요",
          lang: "ko",
          theme_color: "#2D49A6",
          background_color: "#F3F5F2",
          display: "standalone",
          icons: [
            { src: "icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "icon-512.png", sizes: "512x512", type: "image/png" },
            { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,png,mjs,wasm,bcmap,pfb,ttf}"],
          maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        },
      }),
    ],
  };
});
