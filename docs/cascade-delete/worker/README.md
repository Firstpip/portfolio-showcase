# 캐스케이드 삭제 워커 — 통합 가이드

`poll-delete-jobs.js`는 **`Firstpip/wishket-portfolio-system`** 레포에서 동작한다.
(require가 `./lib/*`, `./delete-wishket-portfolio` 기준이라 그 레포 `scripts/` 안에 있어야 함.)

## 배치

```
wishket-portfolio-system/scripts/poll-delete-jobs.js   ← 이 파일 복사
```

## 선행 패치 (1줄) — deleteWishketPortfolio export

`scripts/delete-wishket-portfolio.js` 마지막의 module.exports에 추가:

```diff
-module.exports = { buildProjectReport, formatCleanupMessage, cascadeFirstpipDelete, FIRSTPIP_BY_TITLE };
+module.exports = { buildProjectReport, formatCleanupMessage, cascadeFirstpipDelete, FIRSTPIP_BY_TITLE, deleteWishketPortfolio };
```

`deleteWishketPortfolio(page, portfolioId, projectTitle)`는 이미 그 파일에 정의돼 있고
반환은 `{ id, status: 'deleted'|'unverified', title }`. 새 로직 추가 없이 노출만 하면 됨.

## env (wishket-portfolio-system/.env)

이미 대부분 존재. 추가로 필요한 것만:

| 키 | 용도 |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | 큐 선점·상태기록(RLS 우회). 이미 fetch-wishket-urls.js가 사용 중 |
| `FIRSTPIP_API_BASE` | 미설정 시 `cfg.firstpip.apiBase` → `https://firstpip.co.kr` |
| `FIRSTPIP_ADMIN_TOKEN` | 홈페이지 카드 삭제(cascadeFirstpipDelete가 쓰는 그 토큰) |
| `NEVER_DELETE_WK_IDS` | (선택) 절대삭제금지 위시켓 id, 쉼표구분 |

## 실행

```bash
# 검증 — 삭제 없이 계획만, 상태 미변경(pending 유지)
node scripts/poll-delete-jobs.js --dry-run

# 실제 — pending 소진 후 종료 (cron/PM2 친화)
node scripts/poll-delete-jobs.js

# 이번 실행 처리 상한
node scripts/poll-delete-jobs.js --max 20
```

PM2(ecosystem.config.js)에 cron_restart로 주기 등록하거나, 기존 일일 정리 잡 뒤에 체이닝.

## 동작 보장 / 안전장치

- **원자적 선점**: `claim_delete_job` RPC가 `FOR UPDATE SKIP LOCKED`로 다중 워커 race-safe.
- **재시도**: 실패 시 `attempts++`, `max_attempts(5)` 미만이면 다음 실행에서 재선점.
- **멱등**: 홈페이지 404=absent로 통과. 위시켓도 이미 없으면 통과 동작.
- **안전 기본값**: 조인키(`wishket_portfolio_id`/`firstpip_slug`) 없으면 자동 삭제 안 하고
  `manual_review` 표시 → 엉뚱한 항목 삭제 방지. 조인키는 `backfill-link-refs.js --apply`로 사전 주입 권장.
- **보호**: `NEVER_DELETE_WK_IDS`의 위시켓 id는 `protected`로 건너뜀.

## 상태 흐름

```
pending → (claim) processing → done            (모든 leg 삭제/absent)
                              → partial         (일부 failed → 재시도 대상)
                              → manual_review   (조인키 없음 — 사람이 매핑/처리)
                              → failed          (예외 — 재시도 대상)
```

## 미결(설계문서 §6/§8 참조)

- 조인키 없는 건의 자동 재해결(위시켓 카드 API 결과물 slug 매칭)은 v2. 현재는 안전하게 manual_review.
- 즉시성 필요 시 폴링 주기 단축 또는 엣지함수→워커 트리거(웹훅) 추가 검토.
