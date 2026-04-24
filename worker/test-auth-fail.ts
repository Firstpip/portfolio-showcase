// verifyAuth() 실패 경로 검증 — 잘못된 ANTHROPIC_API_KEY를 주입해 에러 메시지가
// 사용자 action-guidance(점검 리스트)를 포함하는지 확인.
//
// 실행: npm run test:auth-fail  (내부적으로 invalid API 키 주입)

process.env.ANTHROPIC_API_KEY = "sk-ant-invalid-probe-key";

import { verifyAuth } from "./shared/claude.ts";

const r = await verifyAuth();
console.log("result:", r);
if (r.ok) {
  console.error("✗ 예상치 못한 성공 — invalid API 키가 무시됨");
  process.exit(1);
}
// 실패 메시지에 action guidance(claude login / 리밋 / 네트워크)가 있어야 함.
const hasGuidance = /claude login|사용량|점검하세요/i.test(r.reason);
if (!hasGuidance) {
  console.error("✗ 에러는 났지만 action-guidance 누락:", r.reason);
  process.exit(1);
}
console.log("✓ 실패 시 actionable 에러 메시지 확인");
process.exit(0);
