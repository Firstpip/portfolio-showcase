import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";

// vite-react-ts 와 동일한 계약: DEMO_BASE 로 base path 를 주입받고,
// 산출물 파일명 패턴도 맞춰 배포·검증 로직(T8.5/T8.6)을 그대로 재사용한다.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "DEMO_");
  const base = env.DEMO_BASE || "/";
  return {
    plugins: [vue()],
    base,
    resolve: {
      alias: { "@": path.resolve(__dirname, "src") },
    },
    build: {
      outDir: "dist",
      sourcemap: false,
      target: "es2020",
      assetsInlineLimit: 4096,
      cssCodeSplit: false,
      rollupOptions: {
        output: {
          chunkFileNames: "assets/[name]-[hash].js",
          entryFileNames: "assets/[name]-[hash].js",
          assetFileNames: "assets/[name]-[hash][extname]",
        },
      },
    },
  };
});
