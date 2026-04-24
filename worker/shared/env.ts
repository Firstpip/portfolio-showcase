// 워커 env 로더. dotenv/config는 .env만 로드하므로 .env.local을 명시 로드한다.
// 우선순위: 이미 설정된 process.env > .env.local > .env (dotenv 기본 동작과 동일)
//
// 모든 워커 스크립트는 다른 import보다 먼저 이 파일을 import 해야 한다:
//   import "./shared/env.ts";

import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const workerDir = resolve(here, "..");

// .env.local 먼저 (높은 우선순위), 그 다음 .env (fallback).
// dotenv는 기본적으로 이미 set된 키는 덮어쓰지 않으므로 순서가 곧 우선순위다.
config({ path: resolve(workerDir, ".env.local") });
config({ path: resolve(workerDir, ".env") });
