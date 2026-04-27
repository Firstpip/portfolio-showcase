# worker-runtimes

데모 생성기(Phase 8)가 사용하는 스택별 빌드 runtime 디렉토리.

## 운용 원리

각 runtime 디렉토리는 한 번 `npm install` 해 두는 **공유 빌드 환경**.
워커가 데모를 생성할 때:

1. `worker/generate-demo/build-runtime.ts` 가 해당 runtime을
   `/tmp/demo-build-{slug}-{ts}/` 로 `cp -r` (node_modules 포함, 1~2초).
2. LLM 이 임시 디렉토리의 `src/` + `tailwind.config.cjs` 의 토큰 부분만 채움.
3. `DEMO_BASE=/portfolio-showcase/{slug}/portfolio-demo/ npm run build` 실행.
4. `dist/` 디렉토리 통째로 GitHub Tree API multi-file push.
5. 임시 디렉토리 cleanup.

이 구조 덕분에 **빌드당 npm install 0회** + 워커는 stack runtime 디렉토리만
한 번 셋업하면 됨.

## 셋업 (각 runtime 1회)

```bash
cd worker-runtimes/vite-react-ts
npm install
npm run build  # 동작 확인 (dist/ 생성, 콘솔 에러 0)
```

`node_modules`, `dist`, `.vite` 는 `.gitignore` 됨.

## 현재 등록된 runtime

| 이름 | 스택 | 용도 |
|---|---|---|
| `vite-react-ts` | Vite 5 + React 18 + TS + Tailwind 3 + shadcn/ui + Pretendard | 자유 모드 기본, React strict 공고 |

후속 (Phase 8 후속 task):

| 이름 | 스택 | 용도 |
|---|---|---|
| `vite-vue` | Vite + Vue 3 + TS + Tailwind | Vue strict/preferred 공고 (T8.10) |
| `next-static` | Next.js + static export | Next strict 공고 (T8.10) |

## 새 runtime 추가 시 체크리스트

- [ ] `package.json` (type=module, build script `npm run build` → `dist/` 출력)
- [ ] `vite.config.ts` (또는 동등) 에 `DEMO_BASE` env 로 base path 동적 주입
- [ ] `tailwind.config.cjs` theme.extend 에 토큰 placeholder
- [ ] `src/index.css` 에 Pretendard import + tailwind directives
- [ ] `.gitignore` 로 node_modules/dist 제외
- [ ] `npm install && npm run build` 로 셋업 검증
- [ ] `worker/generate-demo/generate-app.ts` 에 stack 분기 추가
