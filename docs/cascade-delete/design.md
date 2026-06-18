# 대시보드발 3-way 캐스케이드 삭제 — 설계문서

> 상태: **라이브 동작 검증 완료 (E2E, 2026-06-17)**
>
> **구현 현황 (2026-06-17)**
> - ✅ 큐 테이블 마이그레이션 — `supabase/migrations/20260617120000_portfolio_delete_jobs.sql` (**라이브 적용됨**, SQL Editor 수동). `claim_delete_job` EXECUTE는 public까지 회수(보안).
> - ✅ 엣지함수 enqueue — `supabase/functions/delete-portfolios/index.ts` (**배포됨**, v19+, 서버사이드 / 대시보드 변경 0)
> - ✅ 워커 — `wishket-portfolio-system/scripts/poll-delete-jobs.js` (PR #2로 머지 `93c670e` + export `deleteWishketPortfolio`). 레퍼런스는 `docs/cascade-delete/worker/`에 동기 유지.
> - ✅ **주기 실행(E)** — `wishket-portfolio-system/scripts/run-portfolio-cleanup.sh`에 큐소비 후행 스텝 내장(`78b0e4e`). 기존 정기정리 launchd(평일 12·18시)에 자동 합류 → launchctl 변경 0, dev-1은 `git pull`만.
> - ✅ 조인키 **이미 충전됨(99/99)** — `backfill-link-refs.js`로 백필 완료 + 정기정리 잡에 백필 선행 스텝 내장. 워커가 대부분 정상 타겟팅, manual_review는 예외적.
>
> **E2E 검증 (2026-06-17, `260504_pod-pdf-generator`)**: 대시보드 경로(엣지함수 호출) → 큐 적재 → 워커 소비로
> **4면(위시켓 296186/296188 · 홈페이지 2카드 · showcase 파일 · DB row) 전부 삭제 + job `done`** 확인.
> - 🐛 이 과정에서 **워커 페이지 다이얼로그 핸들러 누락 버그**를 발견·수정(`92a6aff`). 위시켓 `delete_portfolio()`의
>   네이티브 `confirm()`을 수락할 핸들러가 없어 첫 실행이 `partial`(protocolTimeout)이었고, `delete-wishket-portfolio.js`
>   `main()`과 동일한 `page.on('dialog', d=>d.accept())`를 워커에도 등록해 재실행 시 `done`. **재시도 멱등성도 입증**
>   (부분실패 후 재claim → 이미 삭제된 홈페이지도 무에러).
>
> **⚠️ 정정(2026-06-17)**: 이 문서 초안의 "라이브 DB 조인키 0건 / 백필이 0순위 블로커" 서술은 오류였음.
> 근거였던 `dashboard/data.json`은 커밋된 **stale 스냅샷**. 실제 라이브는 99/99 충전 상태(SSOT = wishket-portfolio-system `docs/automation-overview.md`). §6 참조.
> 목표: 퍼스트핍 워크룸 **대시보드에서 프로젝트/포트폴리오를 삭제하면**, 연결된
> **위시켓 등록 포트폴리오**와 **퍼스트핍 홈페이지 카드**까지 함께 삭제되도록 한다.

---

## 1. 배경 / 동기

현재 대시보드 삭제는 **showcase 정적 파일 + 대시보드 DB row**만 제거한다
(`supabase/functions/delete-portfolios`). 같은 데모가 노출되는 다른 두 면(위시켓, 홈페이지)은
그대로 남아 "고아 게시물"이 된다. 사용자는 대시보드 한 번의 삭제로 세 면을 모두 정리하고 싶어 한다.

조사 결과 **매핑과 삭제 기능 자체는 이미 존재**한다. 빠진 것은 *대시보드발 삭제를
위시켓/홈페이지로 전파하는 트리거 경로* 하나다. 이 문서는 그 경로를 **아웃박스 큐**로 설계한다.

---

## 2. 세 시스템 현황 (조사 결과)

| 시스템 | 레포 | 포트폴리오 SSOT | slug 네임스페이스 | 삭제 수단 |
|---|---|---|---|---|
| 워크룸 대시보드 | `Firstpip/portfolio-showcase` | Supabase `wishket_projects.portfolio_links[]` | `YYMMDD_kebab` | `delete-portfolios` 엣지 함수 (showcase 파일 + DB row) |
| 위시켓 계정 | (외부 서비스) | 위시켓 "포트폴리오 관리" 등록 카드 | 위시켓 불변 `id` (예: `300438`) | Puppeteer 자동화 (`wishket-portfolio-system`) |
| 퍼스트핍 홈페이지 | `Firstpip/firstpip` | `backend/data/portfolios.json` (69개) | 한글 제목 slug | `/api/admin/portfolios/:slug` DELETE (`FIRSTPIP_ADMIN_TOKEN`) |

세 시스템은 모두 동일한 데모(`{slug}/portfolio-N`)를 가리키지만 **각자 다른 식별자**를 쓴다.

---

## 3. 이미 존재하는 자산 — 재발명 금지

모든 핵심 조각이 `Firstpip/wishket-portfolio-system`에 이미 있다.

### 3.1 조인키 스키마 (확정됨)

`scripts/backfill-link-refs.js`가 `portfolio_links`의 각 항목에 불변 조인키를 주입한다:

```jsonc
{ "url": "...", "label": "P1" }
  ↓
{ "url": "...", "label": "P1",
  "wishket_portfolio_id": "300438",   // 위시켓 등록 포트폴리오 불변 id
  "firstpip_slug": "럭셔리-앤틱-갤러리-커머스-웹사이트" }  // 홈페이지 카드 slug
```

- `wishket_portfolio_id` — 위시켓 카드 API의 "결과물 URL"(showcase slug)로 매칭. 자동매칭 불가 건은
  스크립트 내 `MANUAL_OVERRIDES`로 검증된 수동 매핑 보유.
- `firstpip_slug` — `data/firstpip-sync.json` + 라이브 홈페이지로 검증.

> ⚠️ **앞서 검토하던 신규 필드 `wishket_portfolio_url`은 폐기.** 이 두 키가 SSOT 스키마다.

### 3.2 삭제 프리미티브 (이미 구현)

`scripts/delete-wishket-portfolio.js`가 3-way 삭제를 이미 수행한다:

- **(A) 위시켓 포트폴리오 삭제** — Puppeteer, `onclick` id가 URL id와 일치하는 버튼만 클릭
- **(B) 대시보드 row + showcase 파일** — `lib/supabase.js`의 `deleteProjectViaFunction(slug)`
  → **대시보드 버튼과 동일한** `delete-portfolios` 엣지 함수 호출
- **(C) 홈페이지 미러** — `cascadeFirstpipDelete()`, `FIRSTPIP_ADMIN_TOKEN`으로 firstpip API 호출,
  `wishket_portfolio_id → firstpip_slug` 매칭

### 3.3 보존해야 할 보호장치 (그대로 승계)

- `NEVER_DELETE` 보호 목록
- 계약/NDA(`current_status='won'`, `nda:true`) 건 → 위시켓·firstpip 모두 삭제 금지
- 개발완료/협의 단계 홈페이지 카드 자동 cascade 금지
- 매칭 불일치/중복 row는 건너뛰고 경고
- 감사 로그(`data/portfolio-cleanup.jsonl`) + 텔레그램 요약

---

## 4. 진짜 공백 — "대시보드 버튼 삭제" 트리거만 비어 있음

기존 자동화(wishket-portfolio-system `docs/automation-overview.md`)는 **삭제 트리거를 이미 여럿 커버**한다.
빠진 건 **대시보드 버튼발 삭제** 하나뿐이다.

| 삭제 트리거 | 위시켓 | 홈페이지 | DB+showcase | 비고 |
|---|---|---|---|---|
| 텔레그램 `폐기 <slug>`→`폐기확정` (ⓒ `purge-project.js`) | ✅ | ✅ | ✅ | 단건 폐기, won/contracted/nda 차단 |
| 정기정리 launchd 평일 12·18시 (ⓑ `delete-wishket-portfolio.js`) | ✅ | ✅ | ✅ | 위시켓 "지원종료/실패" 탭 순회. 선행 백필 내장 |
| 수동 `reconcile.js`(ⓓ) | ✅ | ✅ | — | out-of-band 위시켓 삭제분 정리(파괴적, 수동) |
| **대시보드 삭제 버튼** (ⓔ `delete-portfolios`→큐→`poll-delete-jobs.js`) | ✅ | ✅ | ✅ | **구현·E2E 검증 완료(2026-06-17)** |

> 참고: **생성**(텔레그램 `지원 <slug>` ⓐ)은 데모생성→배포→위시켓등록→홈카드생성(sync-firstpip)
> + 조인키 즉시기록까지 셋 동기화가 이미 완비. 본 설계의 범위는 **삭제의 대시보드 출처**뿐이다.

→ **대시보드 버튼으로 지우면** showcase+row만 빠지고 위시켓·홈페이지엔 고아로 남는다.
특히 "지원종료" 탭에 없는 **활성 프로젝트**를 대시보드에서 지우면 정기정리(ⓑ)도 잡지 못한다. 이 갭을 메운다.

### 구조적 제약

`delete-portfolios`는 Supabase Deno **엣지 함수** → Puppeteer(위시켓 로그인) 실행 불가.
위시켓 삭제는 자격증명 + 브라우저 자동화를 가진 **워커(`wishket-portfolio-system`)만** 가능.
홈페이지 삭제용 `FIRSTPIP_ADMIN_TOKEN`도 워커 쪽에 있음.
→ 대시보드가 인라인으로 위시켓을 지울 수 없으므로 **워커에 위임**해야 한다.

---

## 5. 선택한 아키텍처 — 아웃박스 큐

대시보드는 "삭제 의도"만 Supabase에 기록하고, 위시켓 자격증명을 가진 워커가 폴링·소비한다.
디커플링·재시도·감사에 유리하고, 자격증명을 워커에만 둔다.

### 5.1 시퀀스

```
[대시보드]  사용자가 프로젝트/포트폴리오 삭제
   │
   ├─(1) delete-portfolios 엣지 함수: showcase 파일 + DB row 삭제 (기존 그대로)
   │
   └─(2) portfolio_delete_jobs 에 작업 INSERT (엣지함수가 삭제 직전 조인키 수집)
         { slug, scope, portfolio_path, targets:[{portfolio_path, showcase_url,
           wishket_portfolio_id, firstpip_slug}], status:'pending', requested_by }
                         │
                         ▼
[워커: wishket-portfolio-system/scripts/poll-delete-jobs.js]  주기 폴링
   ├─ claim_delete_job RPC로 원자적 선점 (status→'processing', FOR UPDATE SKIP LOCKED)
   ├─ target별 위시켓 삭제 (deleteWishketPortfolio(page, wishket_portfolio_id))
   ├─ target별 홈페이지 삭제 (firstpip-client.deletePortfolio(firstpip_slug), 404=멱등)
   ├─ NEVER_DELETE_WK_IDS 보호 → protected / 조인키 없음 → manual_review
   └─ status→'done' (일부 failed→'partial' 재시도 / 조인키없음→'manual_review')
```

### 5.2 큐 테이블 스키마 (구현됨)

> 실제 적용본: **`supabase/migrations/20260617120000_portfolio_delete_jobs.sql`** (아래는 요약).
> 초안의 `wishket_ids[]`/`firstpip_slugs[]` 분리 배열은 폐기하고, **target별 1줄**로 묶는
> `targets JSONB`로 구현 — 조인키가 비어도 `showcase_url`로 워커가 재해결 가능하게 함.

```sql
portfolio_delete_jobs (
  id UUID PK, slug TEXT, scope 'project'|'portfolio', portfolio_path TEXT,
  targets JSONB,        -- [{ portfolio_path, showcase_url, wishket_portfolio_id, firstpip_slug }]
  status TEXT,          -- pending|processing|done|partial|skipped|failed|manual_review
  attempts INT, last_error TEXT, result JSONB,
  requested_by UUID, requested_email TEXT, created_at, updated_at
)
-- RLS: authenticated 전체 허용(enqueue/조회), 워커는 service_role 우회.
-- claim_delete_job(max_attempts) SECURITY DEFINER: FOR UPDATE SKIP LOCKED 원자적 선점.
```

### 5.3 보호장치 위치

보호 판단(won/nda/NEVER_DELETE)은 **워커**에서 수행한다(자격증명·최신 위시켓 상태를 워커가 가짐).
대시보드는 의도만 기록하고, 보호 대상이면 워커가 `status='skipped'`로 표시 + 사유 기록.

---

## 6. 조인키 상태 — **이미 충전됨 (블로커 아님)**

캐스케이드는 `wishket_portfolio_id`/`firstpip_slug`가 있어야 타겟팅된다.
SSOT(wishket-portfolio-system `docs/automation-overview.md`, 2026-06-16) 기준 **라이브 DB는 99/99 충전**
완료 상태이며, `backfill-link-refs.js`가 정기정리 잡(ⓑ)의 **선행 스텝으로 내장**되어 신규건도 자동 충전된다.

> **정정**: 이 문서 초안의 "171개 중 0개 / 백필 0순위 블로커"는 오류였다. 근거였던 커밋된
> `dashboard/data.json`이 **stale 스냅샷**이었을 뿐, 라이브는 채워져 있다. 따라서 워커는 대부분
> 정상 타겟팅하며, 백필은 본 설계의 선결 조건이 아니다.

- [x] 라이브 조인키 충전 — 기존 백필로 완료(99/99), 정기정리에 백필 선행 내장
- 조인키가 **없는 예외 건**의 정책: 워커는 *제목 매칭 fallback을 쓰지 않고* `status='manual_review'`로
  안전 보류한다(엉뚱한 위시켓/홈페이지 항목 오삭제 방지 — §5.3, 워커 README). 재해결(위시켓 카드 API
  결과물 slug 매칭)은 v2 후보.

---

## 7. 구현 단계 (방향 확정 후, 승인 기반 진행)

> dashboard UI 변경은 **로컬 프리뷰 → 시각 확인 → 승인 후 push** 원칙 준수.

1. **[portfolio-showcase]** `portfolio_delete_jobs` 마이그레이션 추가 (`supabase/migrations/`)
2. **[portfolio-showcase]** `delete-portfolios` 엣지 함수 또는 대시보드 핸들러(`handleDelete`,
   `handleBatchDelete`, `doDeployDelete`)가 삭제 성공 후 큐에 enqueue
   - 삭제될 링크들의 `wishket_portfolio_id`/`firstpip_slug`를 수집해 작업에 첨부
3. **[wishket-portfolio-system]** 큐 소비 워커 신설(또는 기존 cron에 합류) — `delete-wishket-portfolio.js`의
   (A)(C) 로직을 *작업 단위*로 재사용. (B)는 대시보드가 이미 수행했으므로 생략
4. **[portfolio-showcase]** (선택) 대시보드에 작업 상태 뱃지(pending/done/partial) 표시
5. 엔드투엔드 검증: 테스트 프로젝트 1건으로 dry-run → 실제 1건

---

## 8. 미해결 질문 / 리스크

- **타이밍**: 아웃박스는 준실시간(폴링 간격). 즉시성이 필요하면 폴링 주기를 짧게 or 알림 트리거.
- **부분 실패**: 위시켓 OK인데 홈페이지 실패 등 → `partial` 상태 + 면별 재시도 멱등성 필요.
- **조인키 누락 링크**: §6 정책 미결.
- **stale 스냅샷**: `data.json`은 커밋된 스냅샷 — 라이브 DB와 다를 수 있음. 백필 여부는 라이브로 확인.
- **이중 삭제 경합**: 기존 위시켓발 일일 스크립트와 새 대시보드발 큐가 같은 건을 동시에 처리할 수 있음
  → 멱등 처리(이미 없으면 OK) + 작업 dedup 키(slug+scope) 고려.

---

## 9. 사후 보강 — 보호 가드 & 삭제 복구 (2026-06-18)

**사고**: 대시보드 삭제 경로에 `current_status` 보호장치가 없어, **개발 중(`in_progress`)·계약(`won`) 등
능동 프로젝트**(career-workbook, pod-pdf, daycare-crm[NDA], kiosk 등)가 row·캐스케이드까지 삭제됨.
설계 §3.3/§5.3은 "보호는 워커가" 한다고 적었으나, **워커는 row 삭제 *후*에 도므로 status를 재확인할 수
없다**(원천 row가 이미 없음). 따라서 보호는 **삭제 직전의 엣지함수**에 있어야 한다.

### 9.1 보호 가드 (구현: `delete-portfolios/index.ts`)
- `PROTECTED_STATUSES = {won, contracted, in_progress, maintenance_free, maintenance_paid, delivered, settled}`.
- **풀 삭제 경로**: 삭제 직전 `current_status` 조회 → 보호상태면 **409로 차단**(row/파일/캐스케이드 전부 미실행).
  `force:true`로만 우회. row 부재(absent)는 멱등 허용, 조회 실패는 안전차단.
- **배포만 내림(subpath, 포트폴리오 링크 🗑) 경로**: status 무관하게 **3면(showcase·위시켓·홈페이지)
  캐스케이드를 그대로 수행**한다(=의도된 동작). 🗑는 "데모 1개 게시종료"이지 프로젝트 삭제가 아니므로
  row를 건드리지 않고, row 삭제가 아니기에 보호 대상도 아니다. (능동 프로젝트의 *row 삭제*만 보호 대상 —
  풀 삭제 경로 + DB 트리거가 막음.)
- TODO(대시보드 UI): 409 `blocked` 응답을 사용자에게 노출하고, 확인 다이얼로그 후 `force:true` 전송.

### 9.1b DB 레벨 방어선 (구현: `20260618030000_protect_active_project_deletes.sql`)
앱 가드는 **엣지함수 경유 삭제만** 막는다. 정리 스크립트가 DB를 직접 DELETE하면 우회된다(2026-06-17
사고의 실제 경로). → `wishket_projects`에 **BEFORE DELETE 트리거**를 둬, 어떤 경로의 삭제든 보호상태면
예외로 중단한다.
- 의도적 삭제는 `delete_project_force(slug)` RPC로만(트랜잭션 로컬 `app.allow_protected_delete` 플래그로 우회).
- 엣지함수 `deleteRow(force=true)`는 일반 DELETE 대신 이 RPC를 호출하도록 연동됨.
- **사고 원인 직격**: 어떤 경로(엣지함수/직접 DELETE/ad-hoc)로 in_progress row를 지우려 해도 트리거가 차단.
- ⚠️ 적용: 다른 마이그레이션과 동일하게 **Supabase SQL Editor 수동 실행** 필요(라이브 반영). (`supabase db push`로 적용 완료.)

### 9.1c 삭제 primitive 자체 가드 (구현: wishket-portfolio-system `scripts/lib/supabase.js`)
**#3 사고 추적 결론(2026-06-18)**: 6/17 개발중 4건 삭제는 *스케줄 악성 스크립트가 아니라*, 가드가 호출자
(정기정리/purge)에만 있고 **삭제 primitive `deleteProjectViaFunction` 자체엔 없어서**, 이 함수를 ad-hoc로
직접 호출했을 때 보호가 통째로 우회된 것. (career-workbook의 `chore: delete project` 커밋 = 엣지함수
풀삭제 흔적, actor=null = service_role 직접 호출.)
→ 교훈대로 **primitive 자체에 가드 내장**: `deleteProjectViaFunction(slug, {force})`는 force가 없으면
삭제 직전 `current_status`를 조회해 보호상태면 엣지 호출 전에 `blocked`로 fast-fail. 정기정리의 won 정리는
`force:true`로 통과. **라이브 검증 완료**(in_progress slug, no force → blocked + row 생존).

### 9.1d 삭제 방어 3층 모델 (최종)
| 층 | 위치 | 막는 것 |
|---|---|---|
| ① primitive 가드 | `lib/supabase.js deleteProjectViaFunction` | 라이브러리/ad-hoc 호출이 보호상태 삭제(force 없이) |
| ② 엣지함수 가드 | `delete-portfolios/index.ts` (409) | 엣지함수 경유 보호상태 풀삭제(force 없이) |
| ③ DB 트리거 | `tg_protect_active_project_delete` | **모든 경로**의 보호상태 row DELETE (직접 SQL·worker 포함) |
의도적 삭제만 `force:true` / `delete_project_force(slug)` RPC로 통과. 비보호 상태(applied/lost 등)는 ③ 정책상
삭제 허용이며, 실수 삭제도 `project_audit_log.before`로 100% 복원 가능(§9.2).
> 잔여 주의: portfolio-showcase `worker/test-*.ts`가 service_role로 `wishket_projects`를 id 직접 `.delete()`
> 함(테스트 probe 정리용, 수동 실행). 보호상태는 ③ 트리거가 차단하나, 비보호 실데이터 id는 가능 →
> **테스트 데이터에만 사용**할 것(프로덕션 id 금지).

### 9.2 삭제 복구 — **데이터는 사라지지 않았다**
`project_audit_log`(마이그레이션 `20260427003842_audit_log.sql`)가 `wishket_projects`의 모든 DELETE를
`before`(삭제 당시 **row 전체 JSONB**)로 보존. → 삭제된 모든 row는 **100% 재삽입 복원 가능**.
- 포렌식·복구 스크립트: **`docs/cascade-delete/recover-deleted-rows.js`** (service_role 필요).
  - `--list [--protected]` 삭제 이벤트(시각·actor·status) / `--jobs` 캐스케이드 큐 덤프
  - `--show <slug>` 삭제 전 row / `--restore <slug>` 재삽입 / `--restore-protected --yes` 보호상태 일괄복원
- ⚠️ 위시켓 카드·홈페이지 카드는 audit 대상이 아님 — row 복원 후 재등록(sync-firstpip/위시켓 재업로드) 필요.
- ⚠️ NDA 건(daycare 등)의 **공개 showcase는 재배포 금지** — 복구는 워크룸 row 한정.

---

## 부록 — 관련 파일

**portfolio-showcase**
- `supabase/functions/delete-portfolios/index.ts` — 현재 삭제(파일+row), `deleteSlug`/`deleteSubpath`
- `dashboard/src/app.jsx` — `handleDelete`(단건), `handleBatchDelete`(일괄), `doDeployDelete`(배포만)

**wishket-portfolio-system**
- `scripts/backfill-link-refs.js` — 조인키 주입(`wishket_portfolio_id`, `firstpip_slug`)
- `scripts/delete-wishket-portfolio.js` — 3-way 삭제 + 보호장치 (재사용 대상)
- `scripts/db-vs-wishket.js` — DB↔위시켓 정합성 비교(읽기 전용)
- `scripts/lib/supabase.js` — `deleteProjectViaFunction`, `updatePortfolioLinks`
- `scripts/lib/firstpip-client.js` / `firstpip-mapper.js` / `firstpip-sync.js` — 홈페이지 연동
- `data/firstpip-sync.json` — 제목 → `{ firstpip_slug, contracted }` 매핑

**firstpip**
- `backend/data/portfolios.json` — 홈페이지 포트폴리오(69개), 조인키는 `slug`(한글) + 단발 `demoUrl`
- `frontend/src/views/admin/AdminPortfolioForm.vue` — 관리 CRUD (`demoUrl` 입력 필드 없음)
