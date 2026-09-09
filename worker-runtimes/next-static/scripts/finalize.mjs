// next build (output:"export") 는 산출물을 out/ 에 쓴다. 다른 런타임과 계약을
// 맞추기 위해 dist/ 로 옮기고, GitHub Pages 용 .nojekyll 을 넣는다.
//
// .nojekyll 이 필요한 이유: Next 정적 산출물은 자산을 `_next/` 에 넣는데,
// GitHub Pages 의 Jekyll 은 `_` 로 시작하는 경로를 통째로 제외한다 (T5.1 에서
// probe slug `__T5_1_PROBE_` 가 404 났던 것과 같은 원인). 사이트 루트에도
// .nojekyll 이 있어야 완전하므로 배포 단계에서 별도로 보장한다.
import { promises as fs } from "node:fs";
import path from "node:path";

const root = process.cwd();
const out = path.join(root, "out");
const dist = path.join(root, "dist");

await fs.rm(dist, { recursive: true, force: true });
await fs.rename(out, dist);
await fs.writeFile(path.join(dist, ".nojekyll"), "");
console.log("[finalize] out/ → dist/ 이동 + .nojekyll 생성 완료");
