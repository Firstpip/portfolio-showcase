// Next.js static export runtime.
//
// 계약은 다른 런타임과 동일하다: DEMO_BASE 환경변수로 배포 경로를 받아
// 그 아래에서 정상 동작하는 정적 산출물을 만든다.
//
//   - output: "export"  → 서버 없이 정적 파일만. GitHub Pages 로 그대로 서빙 가능.
//   - basePath/assetPrefix → DEMO_BASE 의 끝 슬래시를 뗀 값 (Next 는 끝 슬래시를 거부한다).
//   - trailingSlash: true → /flow_1 이 flow_1/index.html 로 떨어져 정적 서버에서 404 가 안 난다.
//   - images.unoptimized → 이미지 최적화는 서버가 필요하므로 export 모드에서 필수.
const raw = process.env.DEMO_BASE || "/";
const basePath = raw === "/" ? "" : raw.replace(/\/+$/, "");

/** @type {import('next').NextConfig} */
export default {
  output: "export",
  basePath,
  assetPrefix: basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};
