# 삭제/Sync 4노드 감사 · 사고복구 · 보호 하드닝 — 작업 기록 (2026-06-18)

> 두 레포(`Firstpip/portfolio-showcase`, `Firstpip/wishket-portfolio-system`)와 firstpip 홈페이지·Supabase·
> dev-1 launchd에 걸친 작업. 포트폴리오 **생성/삭제/sync**가 4개 노드에 끼치는 영향을 전수 감사하고,
> 6/17 데이터 손실 사고를 추적·복구하고, 삭제 보호를 3층으로 하드닝했다.

**4개 노드**: W=위시켓 등록 카드 · H=퍼스트핍 홈페이지 카드 · D=워크룸 DB(`wishket_projects` row+`portfolio_links`) · S=showcase 깃헙배포(`{slug}/portfolio-N`)

---

## 1. 발단 — 사고
'퍼스트핍 워크룸'에서 **개발중(`in_progress`) 프로젝트 4건이 사라짐**:
`260406_daycare-crm`, `260526_kiosk-o2o-platform`, `260330_career-workbook-platform`, `260403_bid-analysis-platform`.

## 2. 사고 추적 (`project_audit_log` 기준)
- **시각**: 2026-06-17 14:16 KST(05:16 UTC), 4건이 8초 내 순차 삭제. **actor=null(service_role)** → 대시보드 버튼(user JWT) 아님.
- **공통 단서**: 4건 모두 6/16에 사용자가 데모를 "배포만 내림"(🗑) 하며 `portfolio_links`가 **0으로 비워진** 상태였음.
- **근본 원인 (#3 확정)**: 스케줄 악성 스크립트가 아니라, **가드가 호출자(정기정리/purge)에만 있고 삭제
  primitive `deleteProjectViaFunction` 자체엔 없어서**, 이 함수를 ad-hoc로 직접 호출했을 때 보호가 통째로
  우회된 것. career-workbook의 `chore: delete project` 커밋 = 엣지함수 풀삭제 흔적.
- **캐스케이드 영향 없음**: 삭제 시 `portfolio_links`가 비어 있어 enqueue 대상이 0 → 워크룸 row만 손실(W·H 무영향).

## 3. 복구 — 데이터는 사라지지 않았다
`project_audit_log.before`에 삭제 당시 **row 전체(JSONB)** 가 보존됨. `project_milestones`는 slug FK
`ON DELETE CASCADE`로 함께 삭제됐으나 역시 audit에 보존.
- 도구: **`docs/cascade-delete/recover-deleted-rows.js`** (service_role 필요). `--list/--show/--restore/--restore-protected`.
- 결과: **4건 + 마일스톤 28개(각 7개) 전부 복원**. `wishket_projects.id`는 GENERATED ALWAYS라 재삽입 시
  id만 제거(슬러그가 자연키, 마일스톤은 slug FK라 무손상).

## 4. 삭제 보호 3층 (핵심 하드닝)
능동 비즈니스 상태(`won, contracted, in_progress, maintenance_free, maintenance_paid, delivered, settled`)는
**어떤 경로로도 `force` 없이 삭제 불가**. 의도적 삭제만 `force:true` / `delete_project_force(slug)` RPC로 통과.

| 층 | 위치 | 막는 것 |
|---|---|---|
| ① primitive 가드 | `wishket .../lib/supabase.js deleteProjectViaFunction` | 라이브러리/ad-hoc 호출 (삭제 직전 status 조회 → fast-fail) |
| ② 엣지함수 가드 | `portfolio-showcase .../delete-portfolios/index.ts` | 엣지 경유 풀삭제 → 409 |
| ③ DB 트리거 | `tg_protect_active_project_delete` (`20260618030000_*.sql`) | **모든 경로**(직접 SQL·worker 포함) BEFORE DELETE 차단 |

- escape hatch: `delete_project_force(p_slug)` SECURITY DEFINER RPC(트랜잭션 로컬 `app.allow_protected_delete` 플래그). 엣지함수 `deleteRow(force=true)` + 대시보드 fallback + 정기정리 won 정리가 이걸 사용.
- 비보호 상태(applied/lost/generated/cancelled/interview/meeting_done)는 정책상 삭제 허용 + audit로 100% 복원 가능.

## 5. 대시보드 동작 (`dashboard/src/app.jsx`)
- **단일 '프로젝트 삭제'**(슬러그 입력 확인) → `force:true`로 4면(W·H·D·S) 전부 삭제. fallback도 force RPC.
  확인 다이얼로그에 위시켓/홈 카드 삭제 + 보호상태 강제삭제 경고 추가.
- **일괄삭제** → 보호상태(`PROTECTED_DELETE_STATUSES`) **전부 제외**(과거 won만 제외 → 확장).
- **포트폴리오 링크 🗑**(subpath) → showcase+위시켓+홈 캐스케이드, **row 유지**(데모 1개 게시종료). 상태무관.

## 6. 정기정리 (`wishket .../delete-wishket-portfolio.js`)
지원종료/계약체결실패 탭 순회 → 화이트리스트(`applied/generated/lost/cancelled`) row만 삭제(deny-by-default).
- ✨ **'계약체결실패' 탭은 `won`(딜 종료)도 정리** — won은 백엔드 보호상태라 `force`로 삭제. 위시켓·row·showcase에 더해
  **firstpip 홈 카드까지** 정리(삭제 전 `firstpip_slug` 캡처 → cascade. row 삭제 후 idMap으로 못 찾는 고아 방지).
  NDA(`nda.json`)만 끝까지 보호.
- 실데이터 양성검증은 보류(현재 계약체결실패 탭에 won 없음). 구성요소(force RPC·엣지)는 실측 완료.

## 7. Sync — C1 제거
- ✨ **일일 `sync-firstpip.js --all` launchd(dev-1, 매일 12:35) 제거**(`co.firstpip.wishket-firstpip-sync`).
  홈 카드 생성은 이미 **업로드 시점**(`upload-wishket.js`의 `syncProject`)이 처리하므로 load-bearing 아니었고,
  순효과로 "직접 삭제한 홈 카드 매일 부활" footgun + PUT 폭풍만 남았음.
- 결과: **홈페이지 직접 삭제가 이제 영구**. 누락은 `audit-consistency.js`(일일)가 감지, 필요 시 수동 `sync-firstpip <slug>`.
- 되돌리기: `bash scripts/setup-firstpip-sync-cron.sh install`.

## 8. 코드 최적화 — 보호집합 단일화
보호상태 집합이 5곳에 하드코딩, 그중 `delete-wishket-portfolio.js`의 `PROTECT_STATUS`가 드리프트(`in_progress`
누락 + 레거시 `maintenance` 포함) → **개발중 홈 카드가 cascade에서 보호 안 되던 갭**.
- `lib/supabase.js`가 `PROTECTED_STATUSES`(정본 7개)를 export → wishket 레포 내 단일 정의. `PROTECT_STATUS`/
  `BACKEND_PROTECTED`는 별칭. **갭 해소**.
- 크로스레포(Deno `index.ts` / SQL 마이그레이션)는 별도 런타임이라 복사본 유지 — 주석으로 동일 집합 불변식 명시.

## 9. 검증 (프로덕션 합성 probe, 비파괴)
**19/19 PASS** — 7개 보호상태 × 직접삭제 차단 + 비보호 삭제 허용 + force RPC 우회 + primitive 가드(blocked/
force/비보호/멱등) + 엣지 409 + 단일화 + 복구 4건 생존(마일스톤 7/7). 엣지케이스: NULL 상태는 CHECK가 거부
(우회 불가), 라이브 상태분포 미분류·NULL 0건. probe row·감사로그 흔적 정리 완료.

---

## 변경/배포 목록

**portfolio-showcase** (`main`)
- `supabase/migrations/20260618030000_protect_active_project_deletes.sql` — 트리거 + force RPC (적용: `supabase db push`)
- `supabase/functions/delete-portfolios/index.ts` — 엣지 가드 + force→RPC (배포: `supabase functions deploy`)
- `dashboard/src/app.jsx` (+ 빌드 `app.js`) — 단일 force / 일괄 제외 / 확인 메시지
- `docs/cascade-delete/recover-deleted-rows.js` — 복구 도구
- `docs/cascade-delete/design.md` §9 — 보호/복구/3층 모델
- 커밋: `ac4a5bc`, `ae68af5`

**wishket-portfolio-system** (`feature` = 트렁크)
- `scripts/delete-wishket-portfolio.js` — 계약체결실패 won 4면 정리 + firstpip 캡처 + 보호집합 별칭
- `scripts/lib/supabase.js` — `deleteProjectViaFunction(force)` + primitive 가드 + `PROTECTED_STATUSES` export
- 커밋: `7d8e813`, `4ef493c`, `2b4a6b5`, `e37bc21`

**인프라**
- Supabase: 마이그레이션 적용 + 엣지함수 배포 + 트리거/RPC 라이브
- dev-1: 코드 pull(`e37bc21`) + C1 launchd 제거

---

## 결정 기록 (안 한 것 + 이유)
- **#4 manual_review/failed 큐 알림** — 보류. 현재 고아 0건·조인키 충전됨이라 신호 없음. 심각도 낮음(고아 카드 ≠ 데이터 손실). 신호 생기면 기존 텔레그램 요약에 한 줄 추가로 최소 구현.
- **Q1 위시켓 직접삭제 자동감지** — 보류. `propagate-delete`가 수동 only. out-of-band 삭제는 드묾.
- **엣지함수 2쿼리→1쿼리(B)** — 보류. cold path에 핵심 함수 재배포 리스크 > 이득.
- **reconcile 7종 통합(D)** — 안 함. 라이브 자동화 대형 리팩토링, 위험.
- **크로스레포 보호집합 정합 테스트** — 안 함. CI 없어 안 도는 테스트는 theater. 주석 불변식으로 관리.
- **service_role 키 rotate** — 사용자 결정으로 안 함.

## 운영 노트
- 의도적 삭제(보호상태)는 `force:true`(엣지/lib) 또는 `delete_project_force(slug)` RPC로만.
- 삭제 복구는 `recover-deleted-rows.js` (audit log 기반, 마일스톤 포함).
- 홈 카드 누락은 `audit-consistency.js` 감지 → `sync-firstpip <slug>` 수동 복구.
- 4노드 전체 생성/삭제/sync 매트릭스는 `design.md` 및 이 문서 참조.
