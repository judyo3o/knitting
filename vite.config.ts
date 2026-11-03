import { defineConfig, loadEnv, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/** 개발 서버에서도 /api/claude를 쓸 수 있게 (선택: .env에 ANTHROPIC_API_KEY, APP_PASSWORD) */
function devApi(): Plugin {
  return {
    name: "dev-api",
    configureServer(server) {
      server.middlewares.use("/api/claude", async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const { POST } = await server.ssrLoadModule("/api/claude.ts");
        const r: Response = await POST(new Request("http://local/api/claude", { method: "POST", headers: req.headers as any, body: Buffer.concat(chunks) }));
        res.statusCode = r.status;
        res.setHeader("content-type", "application/json");
        res.end(await r.text());
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));
  return {
    // GitHub Pages(저장소 이름 경로)에 올릴 때: BASE_PATH=/knitting/ npm run build
    base: process.env.BASE_PATH || "/",
    build: { target: "es2022", chunkSizeWarningLimit: 2000 },
    plugins: [
      devApi(),
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
          navigateFallbackDenylist: [/^\/api\//],
        },
      }),
    ],
  };
});
