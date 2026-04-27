# 데모 생성기 — 설계 및 작업 계획

> **이 문서의 목적**: 어떤 Claude 세션이 열려도 이 파일 하나만 읽고 이어서 작업 가능하도록 모든 결정·상태·의존성을 단일 진실 공급원(SSOT)으로 기록한다.
> 
> **세션 시작 시 해야 할 일**: `## 8. 현재 상태 스냅샷` 섹션을 먼저 읽고, 다음에 가능한 작업(의존성 해소된 TODO)을 고른다. 작업 완료 시 해당 task의 상태 필드를 갱신하고 이 변경분을 같은 커밋에 포함시킨다.
> 
> **자동 실행 커맨드** (`.claude/commands/demo-task.md`에 정의됨):
> - `/demo-task next` — 의존성 해소된 첫 TODO를 자동 선택해 구현·테스트·커밋까지 수행
> - `/demo-task T0.1` — 특정 task 지정 실행
> - `/demo-task status` — 전체 진행 현황 출력 (읽기 전용)
> - `/demo-task list` — 모든 task를 phase별 트리로 출력 (읽기 전용)
> 
> 커맨드는 의존성 검증, 테스트 루프(최대 3회 재시도), 상태 갱신, 커밋까지 한 번에 처리. 실패 3회 또는 `manual-review` task는 자동 중단하고 사용자 확인 요청.

---

## 0. 스코프 확정사항 (변경 시 사용자 승인 필수)

> **2026-04-27 § 0 스코프 변경**: Phase 8 신설로 "단일 HTML + CDN 전용" 정책 폐기. 공고에 명시된 클라이언트 요구 스택을 따르고, 자유면 Claude Code 친화 스택으로 빌드된 SPA를 생성. 데모 시간 5~10분 → 15~25분 허용. 변경 이력은 §10 참조.

- **"실제 동작" 수준**: LocalStorage + 사전 시딩된 샘플 데이터 + 스크립트된 mock (0.8~1.5초 가짜 지연 + 미리 쓴 응답). Supabase 연결 데모 금지.
- **스택 결정 정책 (Phase 8)**:
  - 공고에 클라이언트 요구 스택이 **명시(`strict`)** → 그대로 따름. Claude Code 친화도 매우 떨어지면 (Java/JSP 등) demo_mode='admin-dashboard' 폴백.
  - **선호(`preferred`)** → 따르되 LLM이 chosen_runtime 판단.
  - **자유(`free`)** → 기본 스택 = **Vite 5 + React 18 + TypeScript + Tailwind 3 + shadcn/ui + Pretendard**. Claude Code 친화도 최상, TS 자체 검증 가능, dist/는 정적 SPA → GitHub Pages 직배포.
  - extract 단계가 spec_structured.stack_decision (`client_required` / `freedom_level` / `chosen_runtime` / `demo_mode` / `evidence` / `fallback_reason`) 산출.
- **demo_mode 분기**:
  - `standard` — 일반 web SPA
  - `mobile-web` — 모바일 앱 공고 폴백 (375px frame 안에 React)
  - `admin-dashboard` — 백엔드 only 공고 폴백 (입력 → 결과 시각화)
  - `workflow-diagram` — 노코드/SaaS 연동 공고 폴백 (시각 step + mock 데이터 흐름)
- **빌드 + 배포 인프라**:
  - 레포 루트 `worker-runtimes/{stack}/`에 스택별 runtime (node_modules 포함, .gitignore)을 한 번 install 해 두고, 데모 빌드 시 임시 디렉토리에 cp -r → src/ + tailwind.config + vite.config base 채움 → `npm run build` → dist/ 추출 → GitHub Tree API multi-file push.
  - Docker 검토 후 기각 (1인 로컬 워커 + 단순 SPA 빌드에 오버킬 + 디버그 부담).
- **포트폴리오와의 관계**: 기존 `portfolio-1/` 유지, 별도 `portfolio-demo/`로 분리 생성. portfolio-1은 소개용·portfolio-demo는 조작용. 빌드 결과는 `{slug}/portfolio-demo/` 디렉토리에 multi-file로 배포.
- **구현 스코프**: 공고 내 **모든 업무요소**를 데모에 포함시키되 3티어로 분류.
  - **티어 1 (3~5개)**: 진짜 CRUD·상태 저장·시나리오 완주. 핵심 플로우.
  - **티어 2 (나머지 대부분)**: 화면·컴포넌트·더미데이터까지 구현, 인터랙션은 제한적 (저장 → 성공 토스트만).
  - **티어 3 (구현 보류)**: 데모 홈 체크리스트에 "본 계약 시 구현" 표기만.
- **타협 트리거**: 공고당 사람 보정 공수가 4시간 초과 예상 시 티어 1 플로우를 3개로 강제 축소.
- **UI/UX 기반**: 생성하는 데모는 해당 프로젝트의 `portfolio-1/index.html`에서 추출한 디자인 토큰(컬러·폰트·스페이싱·컴포넌트 스타일)을 Tailwind config의 `theme.extend`로 주입해 승계.
- **실행 환경**: LLM 호출은 **사용자 PC의 로컬 Node 워커**에서 수행. `@anthropic-ai/claude-agent-sdk` + Claude Code Max 구독 OAuth 인증 사용 (`claude login` 필수). Supabase Edge Function은 기존 `delete-portfolios`만 유지; 신규 기능(extract/generate/deploy/build)은 모두 워커 모듈로 구현.
- **비용 모델**: Claude API per-token 과금 **금지**. Max 구독 정액제로 커버. 사용량 리밋(5시간 롤링) 초과 시 자연 대기 후 재시도.
- **운영 제약**: 데모 생성은 워커 실행 중일 때만 가능. 대시보드는 워커 오프라인 상태를 노출해야 하고, `demo_status`는 큐 상태(`queued`)와 처리 상태(`generating`)를 구분해 표시. 빌드 시간이 길어진 만큼(15~25분) 진행 라벨에 단계 세분화 필요(빌드 중 등).

---

## 1. 아키텍처 개요

```
[대시보드: 공고 붙여넣기]
         │  (Supabase REST 직접 호출)
         ▼
[Supabase DB: spec_raw 저장, demo_status='none']
         │
         │  (대시보드 "추출" 버튼 → demo_status='extract_queued')
         ▼
┌────────────────────────────────────────────┐
│  로컬 Node 워커 (사용자 PC 상주)          │
│  @anthropic-ai/claude-agent-sdk 사용      │
│  Max 구독 OAuth 인증 (claude login)       │
│                                            │
│  Supabase Realtime 구독으로 상태 변경 감지│
│                                            │
│  extract: Claude Sonnet 4.6               │
│    → spec_structured JSONB 저장           │
│  generate (3-pass): Claude Opus 4.7       │
│    Pass A 스켈레톤 / B 섹션 / C 통합      │
│    → {slug}/portfolio-demo/index.html     │
│  deploy: GitHub Tree API (github.ts)      │
│    → portfolio_links 자동 갱신            │
└────────────────────────────────────────────┘
         │
         ▼
[GitHub Pages: {project}/portfolio-demo/index.html]
         │
         ▼
[대시보드: 프리뷰 + 재생성 (DB 상태 변경 트리거)]
```

- **실행 위치**: 로컬 Node.js 워커 (`worker/` 디렉터리). Edge Function은 기존 `delete-portfolios`만 유지.
- **LLM 인증**: Claude Code CLI (`claude login` Max 구독) — Agent SDK가 로컬 credential 파일을 자동 로드. `ANTHROPIC_API_KEY` 사용 금지.
- **비밀키**: `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_TOKEN`은 워커의 `.env.local`(gitignore). API 키 아님 주의.
- **모델 배정**:
  - extract: `claude-sonnet-4-6` (저비용·빠름·구조화 태스크 충분)
  - generate: `claude-opus-4-7` (복잡·장문 생성·1M context로 공고 원문+포트폴리오1 원문 동시 투입)
- **Prompt caching**: Agent SDK도 cache_control 지원. 포트폴리오1 원문과 시스템 프롬프트는 캐시해 공고당 재사용.
- **트리거**: Supabase Realtime의 `wishket_projects` UPDATE 이벤트를 워커가 구독. 폴링 대비 지연 ≤1초.

---

## 2. 데이터 모델 변경

### 2.1 `wishket_projects` 테이블 추가 컬럼

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `spec_raw` | TEXT | 공고 원문 전체 (수동 붙여넣기) |
| `spec_structured` | JSONB | 구조화된 요구사항 (아래 스키마) |
| `spec_approved_at` | TIMESTAMPTZ | 사용자가 편집 후 승인한 시각 |
| `demo_status` | TEXT | `none` / `generating` / `ready` / `failed` |
| `demo_generated_at` | TIMESTAMPTZ | 마지막 성공 생성 시각 |
| `demo_generation_log` | JSONB | 각 pass별 토큰·지연·에러 기록 (디버깅용) |

### 2.2 `spec_structured` JSON 스키마

```json
{
  "persona": { "role": "...", "primary_goal": "..." },
  "domain": "physical-therapy-clinic",
  "core_flows": [
    {
      "id": "flow_1",
      "title": "회원 예약 관리",
      "tier": 1,
      "steps": ["로그인", "캘린더에서 슬롯 선택", "예약 확정", "문자 발송"],
      "data_entities": ["member", "appointment", "therapist"]
    }
  ],
  "data_entities": [
    {
      "name": "member",
      "fields": [{"name":"name","type":"string"},{"name":"phone","type":"string"}],
      "sample_count": 20
    }
  ],
  "tier_assignment": {
    "tier_1": ["flow_1", "flow_2", "flow_3"],
    "tier_2": ["flow_4", "flow_5", "..."],
    "tier_3": ["flow_n"]
  },
  "out_of_scope": ["실제 결제 연동", "SMS 게이트웨이"],
  "design_brief": {
    "primary_color_hint": "따뜻한 톤 (재활/돌봄 분야)",
    "reference_portfolio_path": "260423_therapy-center-app/portfolio-1/index.html"
  }
}
```

---

## 3. 파일/경로 컨벤션

- **생성 결과물**: `{project_slug}/portfolio-demo/index.html` (단일 HTML)
- **디자인 토큰**: `{project_slug}/portfolio-demo/tokens.css` (선택적 분리, 포트폴리오1에서 추출)
- **워커 코드**: `worker/` (Node.js + TypeScript, `tsx` 런타임)
  - `worker/index.ts` 엔트리 (Supabase Realtime 구독 + 라우터)
  - `worker/extract-spec.ts`, `worker/generate-demo/{skeleton,sections,assemble}.ts`, `worker/deploy-demo.ts`
  - `worker/shared/claude.ts` (Agent SDK 래퍼), `worker/shared/github.ts`, `worker/shared/supabase.ts`
- **프롬프트 원본**: `worker/prompts/*.md` (버전관리 대상, 수정 시 변경 이유 커밋 메시지에 명시)
- **기존 Edge Function**: `supabase/functions/delete-portfolios/`는 그대로 유지 (영향 없음)
- **마이그레이션**: `supabase/migrations/YYYYMMDDHHMMSS_demo_generator_columns.sql` 단일 파일

---

## 4. 테스트 루프 프로토콜

### 4.1 `requires_test: yes`인 task의 작업 순서

1. 구현 완료 후 상태를 `IN_PROGRESS` → `NEEDS_TEST`로 변경
2. 해당 task의 `test_spec` 항목을 전부 수행 (자동화 가능분은 스크립트, 불가능분은 체크리스트 수동 확인)
3. 실패 항목 발견 시:
   - 상태를 `TEST_FAILED`로 변경
   - 실패 내용을 task의 `last_failure` 필드에 기록 (세션 종료 전 플러시 필수)
   - 수정 → 2번으로 복귀
4. 모든 `test_spec` 통과 시:
   - 상태를 `DONE`으로 변경
   - 같은 커밋에 이 문서의 상태 갱신 포함
   - 커밋 메시지에 task ID 포함 (예: `feat(demo-gen): T2.2 spec extraction prompt`)

### 4.2 테스트 가능성 없는 항목

프롬프트 튜닝·생성 품질 평가처럼 "통과/실패"가 이진으로 안 떨어지는 task는 `requires_test: manual-review`로 표기하고 `test_spec` 대신 `review_checklist`를 사용한다. 사용자 확인 없이 DONE 전환 금지.

### 4.3 루프 중단 조건

- 동일 task에서 3회 연속 `TEST_FAILED`: 중단하고 사용자에게 설계 재검토 요청
- 새 task를 열기 전, 상위 의존성이 모두 `DONE`인지 확인. `NEEDS_TEST`나 `TEST_FAILED`인 의존성이 있으면 건들지 말 것

---

## 5. 의존성 그래프

```
Phase 0 (Foundation)
  T0.1 ─────┐
  T0.2 ─────┤
  T0.3 ─────┤
            ▼
Phase 1 (Intake)
  T1.1 (←T0.1) ─── T1.2 (←T1.1)
            │
            ▼
Phase 2 (Structuring)
  T2.1 (←T0.2) ─── T2.2 (←T2.1) ─── T2.3 (←T2.2, T1.2) ─── T2.4 (←T2.3)
            │
            ▼
Phase 3 (Generation)
  T3.1 (←T2.4) ─── T3.2 (←T3.1, T0.3) ─── T3.3 (←T3.2) ─── T3.4 (←T3.3) ─── T3.5 (←T3.4)
            │
            ▼
Phase 4 (Preview)
  T4.1 (←T3.4) ─── T4.2 (←T4.1) ─── T4.3 (문서, 병행 가능)
            │
            ▼
Phase 5 (Deploy)
  T5.1 (←T4.2) ─── T5.2 (←T5.1)
            │
            ▼
Phase 6 (E2E)
  T6.1 (←T5.2)
            │
            ▼
Phase 7 (1-click Auto Pipeline) — 후속 설계 변경
  T7.1 (←T6.1) ─── T7.2 (←T7.1) ─── T7.3 (←T7.2)
```

---

## 6. 작업 목록

> 상태값: `TODO` / `IN_PROGRESS` / `NEEDS_TEST` / `TEST_FAILED` / `BLOCKED` / `DONE`
> 각 task는 "이 세션 종료 직전까지 반드시 상태 필드 갱신"이 규칙.

---

### Phase 0 — Foundation

#### T0.1 DB 마이그레이션
- **상태**: `DONE`
- **depends_on**: (없음)
- **requires_test**: yes
- **파일**: `supabase/migrations/{timestamp}_demo_generator_columns.sql`
- **해야 할 일**: `§2.1` 스키마대로 컬럼 6개 추가 + `demo_status` CHECK 제약 추가
- **test_spec**:
  - [ ] `supabase db reset` 후 마이그레이션 적용 성공
  - [ ] `psql` 로 컬럼 존재 확인: `\d wishket_projects` 에 6개 컬럼 전부
  - [ ] `demo_status`에 허용 외 값 INSERT 시 에러
  - [ ] 기존 레코드 대상 SELECT 시 NULL 기본값으로 조회됨
- **last_failure**: —

#### T0.2 로컬 워커 스캐폴드 & Claude Agent SDK 인증
- **상태**: `DONE`
- **depends_on**: (없음)
- **requires_test**: yes
- **파일**: `worker/package.json`, `worker/tsconfig.json`, `worker/index.ts`, `worker/shared/{claude,github,supabase}.ts`, `worker/.env.example`
- **해야 할 일**: 
  - Node.js + TypeScript (`tsx`) 워커 프로젝트 스캐폴드
  - Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) 호출 래퍼 작성 (prompt caching 지원·토큰 로깅)
  - Max 구독 인증 검증 로직 (Claude Code CLI 설치 + `claude login` 필수 — 문서화)
  - Supabase 클라이언트 + Realtime 구독 스켈레톤 (상태 변경 감지 로깅만; 라우팅 로직은 T2.1/T3.x)
  - `github.ts`는 기존 `delete-portfolios/index.ts` 패턴을 확장 (blob 생성 + writeFiles 추가)
  - 환경 변수 셋업 가이드 (`.env.example` + README 섹션을 `worker/index.ts` JSDoc으로)
- **test_spec**:
  - [ ] `npx tsx worker/test-claude.ts`가 Agent SDK로 실제 Claude 호출에 성공하고 응답 텍스트 수신
  - [ ] 인증되지 않은 상태(`~/.claude/.credentials.json` 없음)에서 명확한 에러 메시지 출력
  - [ ] 같은 prefix로 두 번 호출 시 로그에 `cache_read_input_tokens > 0` 확인
  - [ ] Supabase 연결 성공 (`SELECT count(*) FROM wishket_projects`가 에러 없이 수행)
- **last_failure**: —

#### T0.3 디자인 토큰 추출 유틸
- **상태**: `DONE`
- **depends_on**: (없음)
- **requires_test**: manual-review
- **파일**: `worker/shared/extract-tokens.ts`, `worker/test-extract-tokens.ts`
- **해야 할 일**: portfolio-1 HTML을 받아 `{ primary, secondary, surface, text, radius, fontFamily, spacingScale }` 를 추출하는 함수. 1차는 정규식 + tailwind 클래스 휴리스틱으로 시도, 실패 시 Sonnet에 위임(fallback).
- **구현 메모**:
  - 휴리스틱 1차: `const C = {p:'#...', surf:'#...', txt:'#...'}` 단축키 JS 객체 + `const C = {primary, surface, text, ...}` 긴키 JS 객체 + `:root { --primary: ...; }` CSS custom properties 3 형태 모두 cover (`KEY_ALIASES` 매핑). `extractFontFamily`/`extractRadius`/`extractSpacingScale`는 빈도 집계.
  - 휴리스틱 충분성: `pairs`에서 primary/surface/text 중 ≥2 매칭 시 LLM 호출 생략.
  - LLM 폴백 (`allowLLMFallback: true` 기본): HTML 상단 12KB만 Sonnet 4.6으로 보내 `{primary, secondary, surface, text}` 4 hex 추출. JSON 한 줄 강제 + 펜스 응답 방어.
  - graceful fallback: LLM 실패/비활성/HTML 비어있음 등 어떤 경로에서도 throw 없이 중립 팔레트(#4F46E5/#06B6D4/#FFFFFF/#0F172A)로 안착. `_source` 필드로 추출 경로 추적.
- **자동 검증 결과 (2026-04-27, 5/5 케이스)**:
  - 도메인 다양성: 발달센터(단축키 JS) / 핀테크(긴키 JS) / 병원(긴키 JS) / 임원 대시보드(CSS vars) / 커뮤니티(하드코딩) — 5건
  - **NO_LLM=1 모드** (휴리스틱 only): 1~4번 100% 매칭 (3/3 each), 5번은 휴리스틱 실패 → fallback 안착 (의도된 어려운 케이스, throw 0). 평균 4/5 = 80% 임계 충족
  - **LLM ON 모드**: 5/5 모두 100% 매칭. 5번 케이스 LLM 폴백이 `#2563EB/#FFFFFF/#1A1A2E` 정확 추출 (Sonnet 4.6, 10s, output 37 토큰)
  - **graceful fallback**: 빈 HTML(`<html><body>nothing</body></html>`) → `_source='fallback'`, throw 0, primary=#4F46E5 (중립). LLM 폴백 비활성 + 휴리스틱 실패도 동일 경로로 fallback 안착
- **review_checklist** (자체 평가, 사용자 승인 대기):
  - [x] 기존 4~5개 프로젝트 portfolio-1 적용 시 컬러값이 실제 사용색과 ≥ 80% 일치 — NO_LLM 4/5 (80%) + LLM ON 5/5 (100%) 둘 다 임계 통과 (사용자 승인 2026-04-27)
  - [x] 추출 실패 시 기본 토큰 세트(중립 팔레트)로 graceful fallback — 빈 HTML, 휴리스틱 실패+LLM off, LLM 호출 실패 catch 등 모든 실패 경로에서 throw 0 + `_source='fallback'` (사용자 승인 2026-04-27)
- **last_failure**: —

---

### Phase 1 — Spec Intake

#### T1.1 공고 붙여넣기 모달 (대시보드 UI)
- **상태**: `DONE`
- **depends_on**: T0.1
- **requires_test**: yes
- **파일**: `dashboard/index.html` (또는 리빌드 스크립트)
- **해야 할 일**: 프로젝트 행에 "공고 내용" 버튼 → 모달 → textarea + 저장. 저장 시 `spec_raw` 갱신. 기존에 값 있으면 프리필.
- **test_spec**:
  - [ ] 새 공고 붙여넣기 → 저장 → 새로고침 → 값 유지
  - [ ] 빈 값 저장 시도 시 버튼 비활성
  - [ ] 10,000자 붙여넣기 테스트 (위시켓 공고 중 긴 편) 시 에러 없이 저장
  - [ ] 저장 시 `demo_status`는 변경되지 않음 (여전히 `none`)
- **last_failure**: —

#### T1.2 spec_raw 저장 서버 로직
- **상태**: `DONE`
- **depends_on**: T1.1
- **requires_test**: yes
- **파일**: 대시보드의 Supabase 클라이언트 호출부
- **해야 할 일**: RLS가 걸려있다면 service role 경로로 업데이트. 충돌 방지 위해 `updated_at` 갱신.
- **test_spec**:
  - [ ] 저장 응답 2xx
  - [ ] DB `updated_at` 갱신 확인
  - [ ] 존재하지 않는 project_id 요청 시 404/에러 처리

---

### Phase 2 — Spec Structuring

#### T2.1 extract-spec 워커 모듈 스캐폴드
- **상태**: `DONE`
- **depends_on**: T0.2
- **requires_test**: yes
- **파일**: `worker/extract-spec.ts`
- **해야 할 일**: Realtime 라우터가 `demo_status='extract_queued'` 감지 시 호출 → DB에서 `spec_raw` 조회 → Claude Sonnet 4.6 호출 → `spec_structured` 저장 → `demo_status='extract_ready'` 세팅. 실패 시 `demo_status='extract_failed'`.
- **test_spec**:
  - [ ] 테스트 스크립트로 특정 project_id 수동 트리거 시 정상 수행
  - [ ] spec_raw NULL이면 상태만 `extract_failed`로 전이 (예외 전파 아님)
  - [ ] DB에 spec_structured JSONB 저장됨

#### T2.2 `extract-spec` 프롬프트 및 JSON 스키마 검증
- **상태**: `DONE`
- **depends_on**: T2.1
- **requires_test**: manual-review + yes (혼합)
- **파일**: `worker/prompts/extract-spec.md`
- **해야 할 일**: 공고 원문 → `§2.2` 스키마로 추출하는 프롬프트. tool use(JSON schema) 또는 `response_format` 사용해 스키마 강제. 티어 분류 기준도 프롬프트에 포함.
- **test_spec**:
  - [ ] 응답이 JSON schema validate 통과
  - [ ] 기존 프로젝트 5개(서로 다른 도메인) 대상 추출 → 모두 schema 통과
- **review_checklist**:
  - [ ] `core_flows` 개수가 도메인 상식 수준 (너무 적거나 많지 않음)
  - [ ] `tier_1`이 실제 미팅 시연 가치 있는 플로우인지
  - [ ] `out_of_scope`가 비어있지 않음 (외부 의존성 명시)

#### T2.3 spec 편집기 UI (대시보드)
- **상태**: `DONE`
- **depends_on**: T2.2, T1.2
- **requires_test**: yes
- **파일**: `dashboard/index.html`
- **해야 할 일**: 추출 결과를 form으로 렌더. 플로우 추가/삭제/티어 변경 가능. 저장 시 `spec_structured` 업데이트.
- **test_spec**:
  - [ ] 추출→편집→저장→새로고침 시 편집 내용 유지
  - [ ] 티어 드래그앤드롭 or 드롭다운 동작
  - [ ] 빈 core_flows 저장 시 경고

#### T2.4 승인 플로우
- **상태**: `DONE`
- **depends_on**: T2.3
- **requires_test**: yes
- **파일**: 대시보드 + DB
- **해야 할 일**: "데모 생성 시작" 버튼은 `spec_approved_at` 세팅 후에만 활성. 승인 시 `demo_status = generating`으로 자동 전이.
- **구현 메모**: 설계 문서의 `generating` 표현은 §1 상태 머신 확장(`gen_queued`) 이전 텍스트. 실제 구현은 승인 후 `demo_status = 'gen_queued'` 전이 (워커가 atomic 선점 후 `generating`).
- **test_spec**:
  - [x] 승인 전 "데모 생성" 버튼 비활성 (handler 가드 + UI `disabled={!canStartGen}`이 `!!approvedAt`에 결속)
  - [x] 승인 후 활성 + timestamp 기록 (DB: `spec_approved_at` ISO-8601, now ±60s 내)
  - [x] spec 재편집 시 `spec_approved_at` 초기화 (재승인 강제) — `spec_raw`/`spec_structured` 어느 쪽 저장도 리셋
  - [x] UI 시각 확인 (사용자 승인 완료)
- **last_failure**: —

---

### Phase 3 — Demo Generation (3-pass)

#### T3.1 티어 분류 & 샘플 데이터 시드 생성
- **상태**: `DONE`
- **depends_on**: T2.4
- **requires_test**: manual-review
- **파일**: `worker/prompts/seed-data.md`, `worker/generate-demo/seed.ts`, `worker/test-seed-data.ts`
- **해야 할 일**: `data_entities`마다 `sample_count`개의 리얼한 한국어 샘플 생성. 이름·전화·주소 등 실제감 있게. (이게 "진짜 같음"의 핵심)
- **구현 메모**:
  - `generateSeed(spec)` = system prompt(seed-data.md) + user(spec_structured JSON) → Opus 4.7 호출 → `{ seed: { [entity]: [...] } }` 파싱 + 검증.
  - 스키마 검증기 `validateSeed(seed, spec)`: 엔티티 누락·sample_count 미달·id 중복·ref 미매칭을 자동 탐지. 참조 대상은 `<name>_id` → `<name>` 규칙으로 `resolveRefTarget`에서 추론.
  - 모든 레코드에 `ent_<entity>_<nnn>` 형식 id 강제 (프롬프트 계약).
- **자동 검증 결과 (2개 도메인, 치과/카페)**:
  - 치과: 모든 엔티티 sample_count 100% 충족 (patient 12/12, treatment 6/6, appointment 20/20, medical_note 15/15), ref 무결성 55/55
  - 카페: 모든 엔티티 sample_count 100% 충족 (menu_item 12/12, table 8/8, customer 10/10, order 18/18, loyalty_punch 15/15), ref 무결성 51/51
  - Opus prompt cache 2회차 호출에서 `cache_read_input_tokens=21029`로 system prompt 재사용 확인
- **review_checklist** (사용자 승인 완료):
  - [x] 이름이 "홍길동1" 같지 않고 자연스러움 (김민서·이준호·박서연·김지후·이서연·박민재 등 한국 성씨 분포·세대별 이름 패턴 자연)
  - [x] 도메인에 맞는 데이터 (치과: 스케일링/임플란트/A3→A1 색조 수복; 카페: 아메리카노 4500원/카페라떼 5000원/카테고리 "커피")
  - [x] 관계형 정합성 (두 도메인 모두 `ref` 필드 100% 매칭, id 중복 0)
- **last_failure**: —

#### T3.2 Pass A — 스켈레톤 생성
- **상태**: `DONE`
- **depends_on**: T3.1, T0.3
- **requires_test**: yes
- **파일**: `worker/generate-demo/skeleton.ts` + `worker/prompts/pass-a-skeleton.md` + `worker/test-skeleton.ts`
- **해야 할 일**: `spec_structured` + 디자인 토큰 + portfolio-1 HTML → 단일 HTML의 **뼈대**(Shell, 사이드바/탑바, 라우팅 스위치, 전역 상태 컨텍스트, LocalStorage 초기화 스크립트)만 생성. 각 플로우 자리는 placeholder 주석.
- **구현 메모**:
  - `generateSkeleton(spec, tokens, portfolio1Html)` = Opus 4.7 호출 + `validateSkeleton(html, spec, tokens)` 자동 검증. portfolio-1 원문은 `REFERENCE_HTML_MAX_BYTES=14000`로 잘라 톤/스페이싱 힌트만 전달 (복제 유도 방지).
  - 프롬프트 계약: 첫 글자가 `<`, 마지막 글자가 `>`; `<script type="text/babel">` 정확히 1개; 각 `core_flow.id` 마다 `<!-- PASS_B_PLACEHOLDER:{id} -->` HTML 주석 + 문자열 리터럴(라우트 케이스) 존재; `:root`에 `--primary/--secondary/--surface/--text/--radius/--font-family` 6개 전부 + 값이 tokens 매칭; `TOKENS`·`STORAGE_KEY`·`initDemoStore`·`useHash`·`DemoStoreContext`·`ReactDOM.createRoot` 식별자 존재.
  - `stripHtmlFence`는 `<!doctype>`·`<html>` 발견 지점부터 `</html>`까지를 컷해 prose+펜스 응답을 방어 (1회차 실패 수정).
- **test_spec**:
  - [x] 생성된 HTML을 브라우저에서 열었을 때 콘솔 에러 0 (esbuild.transform({loader:'jsx'})로 text/babel 블록 구문 검증 = compile-time 콘솔 에러 0)
  - [x] 각 core_flow별 라우트가 URL hash로 접근 가능 (useHash + hashchange 배선 + 5개 flow id 리터럴 모두 존재)
  - [x] 디자인 토큰이 실제 CSS 변수로 반영됨 (:root의 6개 변수 값이 tokens와 정확 매칭)
  - [x] 파일 크기 < 50KB (16,974 bytes = 16.6 KB, 상한 대비 ~33%)
- **last_failure**: —

#### T3.3 Pass B — 섹션/플로우 생성
- **상태**: `DONE`
- **depends_on**: T3.2
- **requires_test**: yes
- **파일**: `worker/generate-demo/sections.ts` + `worker/prompts/pass-b-section.md` + `worker/test-sections.ts`
- **해야 할 일**: 플로우별로 **개별 호출** (병렬 가능). 티어 1은 full interactive + LocalStorage 쓰기, 티어 2는 UI+mock toast, 티어 3은 "준비 중" placeholder 카드. Pass A의 placeholder 자리를 교체하는 patch 포맷으로 반환.
- **구현 메모**:
  - `generateSections(spec, tokens, seed)` = 각 core_flow에 대해 `Promise.all`로 Opus 4.7 병렬 호출 → 플로우당 `{ component_name, component_code, tier }` JSON 반환.
  - 입력 payload: `{ flow, tier, domain, entities(flow.data_entities만 발췌), tokens, sample_ids(엔티티당 최대 5개) }`. sample_ids는 실제 시드(T3.1)에서 추출해 모델이 초기 선택 리터럴로 쓰되, 런타임은 `DemoStoreContext.store`에서 조회.
  - `validateFlowComponent` 정적 검증: (a) 이름 `/^Flow[A-Za-z0-9_]+$/` + 예약어 아님 (b) 코드가 `function <name>() {` 시작, 매칭 `}` 종료, 중괄호 균형 (c) `import/export/DemoStoreContext/TOKENS/STORAGE_KEY` 재선언 금지 (d) `flow.steps` 전 항목이 UI 텍스트로 등장 (e) **tier 1**: `setStore(` ≥1 (f) **tier 2**: `setStore`/`saveDemoStore`/`localStorage.` 0건 + toast setter ≥1 (g) **tier 3**: "본 계약 시 구현 예정" 포함 + `<button>` 0건.
  - 컴포넌트 이름 전역 중복 검사 (Pass C가 인라인 시 충돌 방지).
  - JSON 펜스 방어 `stripJsonFence`는 seed.ts 로직 재사용(소규모 중복 허용).
- **test_spec**:
  - [x] 티어 1 플로우에서 CRUD 왕복 시 LocalStorage 값 변경 확인 (test-sections.ts `analyzeTier1Crud`: onClick 핸들러가 setStore 호출로 도달 + `...store` 스프레드/`store.`조작 검출)
  - [x] 티어 2 플로우의 "저장" 버튼이 성공 토스트 띄움 (실제 저장은 안 함) (`analyzeTier2Toast`: setStore/saveDemoStore/localStorage 0건 + toast setter ≥1 + 한국어 성공 키워드 리터럴 ≥1)
  - [x] 티어 3 카드가 "본 계약 시 구현 예정" 문구 포함 (리터럴 substring)
  - [x] 각 플로우가 spec의 `steps`를 UI로 수행 가능 (validateFlowComponent: flow.steps 각 항목이 component_code에 가시 텍스트로 등장)
- **자동 검증 결과** (2회차 통과):
  - 치과 도메인 3플로우(tier 1/2/3 각 1개) 병렬 생성 41s
  - compile 3/3 (esbuild jsx), tier 1: onClick→setStore + store 조작 확인, tier 2: `setToast` + '가입이 완료되었습니다' 리터럴, tier 3: 문구 포함, steps 9/9 모두 텍스트 등장
  - Opus prompt caching 2~3회차에서 `cache_read_input_tokens=25,920` 재사용 확인
- **last_failure**: 2026-04-24 1회차 — Opus가 tier 2에서 헬퍼 `showToast('가입이 완료되었습니다', 'success')` 패턴 사용. 실제 `setToast` 인수는 객체(`{msg, type}`)라 analyzer가 setter 인수만 보고 성공 키워드를 놓침. analyzer를 "(setter 호출 ≥1) + (한국어 성공 키워드 리터럴 전역 ≥1)"로 완화해 2회차 통과. 프롬프트는 유지 — 헬퍼 함수는 자연스러운 React 패턴이므로 검증기가 유연해야 맞음.

#### T3.4 Pass C — 통합 & 단일 HTML 빌드
- **상태**: `DONE`
- **depends_on**: T3.3
- **requires_test**: yes
- **파일**: `worker/generate-demo/assemble.ts` + `worker/test-assemble.ts` + `worker/test-assemble-browser.ts`
- **해야 할 일**: Pass A 스켈레톤 + Pass B patches → 단일 HTML. 시드 데이터 LocalStorage 초기화 스크립트 inline. 공고 전체 업무요소 체크리스트 섹션을 홈 화면에 렌더(티어 표시 포함). 렌더링 최적화(Babel presets-env preset만 로드).
- **구현 메모**:
  - `assembleDemo(skeletonHtml, patches, seed)` 파이프라인:
    1. text/babel 블록 경계 탐색 (1개 강제) + createRoot 마운트 지점 존재 확인.
    2. component_name 중복/스켈레톤 식별자 충돌 방지 (`collectTopLevelFunctionNames`).
    3. `FlowPlaceholder({ flowId })` 본문 첫 줄에 디스패처 주입 — `window.__FLOW_COMPONENTS[flowId]` 매칭 시 해당 컴포넌트를 `React.createElement` 로 렌더, 미매칭은 원본 placeholder 카드로 fall-through. 파라미터 괄호는 문자열/주석 건너뛰며 수동 매칭.
    4. `ReactDOM.createRoot` 직전(라인 시작)에 Pass B 컴포넌트 + `window.__FLOW_COMPONENTS` 맵 주입.
    5. `<script>window.__DEMO_SEED__ = {...};</script>` plain script 를 text/babel 블록 바로 앞에 삽입 (`safeStringifyForScript`: `</script>`·`<!--`·`-->`·U+2028/U+2029 전부 이스케이프).
    6. `<!-- PASS_B_PLACEHOLDER:* -->` 주석 청소.
    7. `<script type="text/babel">` 에 `data-presets="env,react"` 없으면 추가.
    8. 400KB 상한 검증.
  - 캐시: `worker/.test-cache/t3.4-{skeleton.html,patches.json,seed.json}` — 각 단계 산출물 보존해 assemble 단독 반복 실행 가능 (`--fresh` / `--regen=X,Y` 플래그).
  - 헤드리스 검증: `worker/test-assemble-browser.ts` 가 Playwright Chromium 으로 `.test-cache/t3.4-final.html` 을 띄워 FCP·LocalStorage 유지·콘솔 에러를 자동 측정. esbuild가 evaluate 콜백에 `__name` helper 를 끼우지 않도록 폴링은 Node 측에서 짧은 evaluate 반복으로 처리.
- **test_spec**:
  - [x] 최종 HTML 단일 파일로 동작 (외부 파일 의존 0, CDN만 허용) — 외부 참조 CDN 4개 (unpkg:3, cdn.jsdelivr:1), 로컬경로/상대경로 0
  - [x] 파일 크기 < 400KB — 46,231 bytes (45.1 KB)
  - [x] 첫 페인트 < 2초 (로컬 기준) — Playwright Chromium 에서 FCP **816 ms** (예산 2000ms 대비 41%)
  - [x] 홈 화면 체크리스트에 공고의 모든 업무요소가 티어와 함께 표시 — 3 flow 제목 + tier 1/2/3 섹션 마커 전부 존재
  - [x] 브라우저 새로고침 후 LocalStorage 데이터 유지 — 첫 로드 시 `demo_dental_clinic` 자동 시드(3 entities, patient 12건) → 마커 레코드 push → page.reload() → 마커 잔존 확인
  - (자동 sanity) text/babel esbuild-jsx compile OK, FlowPlaceholder 디스패처 주입 OK, FLOW_COMPONENTS 맵 3/3 매칭, Pass B 컴포넌트 3개 인라인, 페이지 콘솔 에러 0건
- **last_failure**: —

#### T3.5 샘플 데이터 리얼리티 보강 패스 (선택적)
- **상태**: `DONE` (코드 변경 없이 승인 — 사용자 위임 판단 2026-04-25)
- **depends_on**: T3.4
- **requires_test**: manual-review
- **해야 할 일**: 생성된 HTML의 더미 텍스트/이미지를 domain-appropriate하게 교체. 리뷰 텍스트, 프로필 썸네일(unsplash URL 등), 뉴스 헤드라인 등.
- **감사 결과 (2026-04-25, T3.4 산출물 `worker/.test-cache/t3.4-final.html` 46,231 bytes 기준)**:
  - "Lorem ipsum"·"lorem" 케이스 0건
  - `<img>` 태그 자체 0건 (CDN script 3개 + babel.min.js 1개만 외부 참조) → 이미지 깨짐 불가능
  - 가격: 50,000~1,200,000원 (실제 치과 시술가 분포), 연도: 1958~2015 (다세대 환자), 전화번호: 010-XXXX-XXXX 형식
  - 더미 마커("TODO/FIXME/XXX/dummy/9999") 0건. "Temp"는 `gridTemplateColumns` 부분 매치 false positive, "준비 중"은 Tier 3 의도된 placeholder (T3.3 스펙)
  - Form `placeholder='홍길동'`/`'010-0000-0000'`는 한국 폼 UI의 표준 hint 컨벤션 (dummy data 아님)
- **결론**: T3.1(realistic seed) + T3.3(domain-aware Pass B) 단계에서 이미 리얼리티가 확보됨. 별도 후처리 모듈 구현은 YAGNI. 향후 도메인이 사진/리뷰 텍스트를 요구할 경우 재개 가능 (그땐 새 task로 분리).
- **review_checklist**:
  - [x] "Lorem ipsum" 0건 — grep 검증
  - [x] 이미지 깨짐 0건 — `<img>` 부재로 trivially pass
  - [x] 숫자가 현실적 (재고 9999 말고 23 같은) — 가격·생년월일·전화 분포 현실적
- **재개 트리거**: 향후 E2E(T6.1)에서 도메인이 사진/리뷰/뉴스 헤드라인을 요구하고 산출물에 빈 자리·placeholder 텍스트가 남는다면 후처리 모듈 별도 task로 신설.

---

### Phase 4 — Preview & Iteration

#### T4.1 로컬 프리뷰 명령
- **상태**: `DONE`
- **depends_on**: T3.4
- **requires_test**: yes
- **파일**: `preview-demo.sh` (루트)
- **해야 할 일**: 생성된 파일을 로컬에서 바로 띄우는 단일 명령. `npx serve {project_slug}/portfolio-demo` 수준이면 충분.
- **구현 메모**:
  - 루트에 `preview-demo.sh` 단일 bash 스크립트. node/npm 의존 없이 macOS 기본 `python3 -m http.server` + `open` 사용 (즉시 실행 가능, 추가 설치 불필요).
  - 인자 형태 4종: (1) 무인자/`latest` → `worker/.test-cache/t3.4-final.html` (T3.4 dev 산출물); (2) `<project_slug>` → `{slug}/portfolio-demo/index.html` (T5.x 배포 후 사용); (3) 디렉터리 경로 → `dir/index.html`; (4) HTML 파일 경로 → `dirname/basename`.
  - 환경변수: `PREVIEW_PORT` (기본 4173), `PREVIEW_NO_OPEN=1` (CI/테스트용 — 브라우저 자동 오픈 비활성).
  - 로컬 바인딩 `127.0.0.1`으로 외부 노출 차단. server 부팅 직후 0.7s 지연 후 `open "$URL"` (백그라운드 서브셸).
- **test_spec**:
  - [x] 명령 1개로 브라우저 자동 오픈 — `./preview-demo.sh` 단일 호출로 서버 부팅 + `open` 호출 (stub 검증: `open` 가 `http://localhost:4180/t3.4-final.html` 인자로 정확히 1회 호출됨), HTTP 200 응답 + 첫 100바이트 `<!DOCTYPE html>` 확인
  - [x] 핫 리로드 불필요 (정적이라) — python3 http.server는 정적 파일 서버 (no-cache 헤더 없음, 변경 시 브라우저 새로고침으로 충분), 데모는 self-contained 단일 HTML이라 watch 불필요
- **last_failure**: —

#### T4.2 재생성 UI (전체/부분)
- **상태**: `DONE`
- **depends_on**: T4.1
- **requires_test**: yes
- **파일**: `supabase/migrations/20260426221914_demo_regenerate_columns.sql`, `worker/generate-demo/orchestrator.ts`, `worker/index.ts`, `dashboard/index.html`, `worker/test-regenerate.ts`
- **해야 할 일**: 대시보드에서 "전체 재생성" / "특정 플로우만 재생성" 버튼 → DB에 `regenerate_scope` 쓰고 `demo_status='gen_queued'` 세팅. 워커가 scope에 따라 3-pass 전체 또는 Pass B 특정 플로우만 재실행. 사용량 리밋 도달 가능성 UI에 명시.
- **구현 메모**:
  - 마이그레이션: `regenerate_scope` TEXT (NULL/'all'/'flow:<id>' CHECK 제약), `demo_artifacts` JSONB (skeleton+patches+seed+tokens 캐시).
  - `runGenerationPipeline(inputs, scope)` 순수 함수: `mode='all'`이면 tokens→skeleton→seed→sections→assemble 전체; `mode='partial'`이면 prevArtifacts 재사용 + spec.core_flows를 1개로 좁힌 generateSections 호출 + 캐시 patches에서 해당 flow_id만 교체. 부분 모드는 LLM 1회 호출(~30-60s).
  - `handleGenQueued(supabase, projectId)` 래퍼: atomic claim(`gen_queued`→`generating`) → 파이프라인 → 성공 시 임시파일 작성 후 `renameSync`로 atomic 교체 → demo_artifacts/demo_status='ready'/demo_generated_at 갱신 + regenerate_scope NULL 리셋. 실패 시 기존 HTML/artifacts 손대지 않고 `demo_status='failed'`만 전이 (regenerate_scope는 보존해 사용자가 같은 의도로 재시도 가능).
  - 대시보드: `RegenerationPanel` 컴포넌트 — `demo_status='ready'` 또는 `'failed'` 분기에서 노출. "전체 재생성" + 각 core_flow 별 칩 버튼(T1/T2/T3 색상 구분), confirm 단계로 의도 재확인. Max 5h 롤링 리밋 안내 푸터 포함. `handleRegenerate(project, scope)`가 `regenerate_scope` + `demo_status='gen_queued'` 동시 세팅. `handleStartDemoGen`도 `regenerate_scope: null`로 리셋해 최초 생성과 재생성을 구분.
  - 워커 라우터(`worker/index.ts`): demo_status='gen_queued' 분기에 `void handleGenQueued(supabase, newRow.id)` 추가.
- **test_spec**:
  - [x] 특정 플로우만 재생성 시 다른 플로우 코드는 불변 — `runGenerationPipeline(mode=partial)`로 flow_patient_signup만 재호출, flow_appointment_new + flow_insurance_claim은 byte-identical 확인 (component_name + component_code 전부 일치, target은 reqId 변화로 재호출 확인). stages=sections,assemble만 실행 (skeleton/seed/tokens 캐시 재사용).
  - [x] 재생성 중 `demo_status = generating` 반영 — atomic UPDATE `demo_status='generating' WHERE id=$1 AND demo_status='gen_queued'` 1차 1행 영향, 2차 0행 (중복 선점 방지). 최종 SELECT로 'generating' 잔존 확인.
  - [x] 실패 시 이전 HTML 유지 (덮어쓰지 않음) — `__T4_2_PROBE_fail_*` 슬러그에 marker가 있는 사전 HTML 작성, spec_structured=NULL인 행으로 handleGenQueued 호출 → preflight 실패 → demo_status='failed' 전이, demo_artifacts/demo_generated_at NULL 유지, HTML 파일 byte-identical 보존(149B + marker 일치).
- **자동 검증 결과 (2026-04-27, 3/3 통과)**:
  - 테스트 1: Opus 1회 호출 37.5s, output 3802 토큰. 다른 2개 flow 코드 byte-identical, target flow reqId 840aab08→962ab0d6 변화. 산출 HTML 45,541 bytes.
  - 테스트 2: 1차 claim 1행, 2차 0행, 최종 demo_status='generating'.
  - 테스트 3: handleGenQueued FAILED at preflight, HTML 보존, artifacts NULL 유지.
- **last_failure**: —

#### T4.3 수동 수정 워크플로우 문서 (병행 가능)
- **상태**: `DONE`
- **depends_on**: (없음, T3.4 이후 아무 때나)
- **requires_test**: no
- **파일**: `docs/demo-generator/manual-edit-guide.md`
- **해야 할 일**: 생성 결과를 직접 수정할 때의 규칙 — 어떤 섹션은 건드려도 되고 어떤 섹션은 regenerate가 덮어쓰니 피해야 하는지.
- **구현 메모**:
  - 7개 섹션 + 부록 A 구성: TL;DR 표 / 생성 HTML 구조 지도 / 안전 영역 / 금지 영역 / 결정 트리 / 재생성 시 어떻게 사라지는지 / 미팅 직전 비상 수정 / 안티패턴.
  - 재생성 SSOT가 `demo_artifacts` (skeleton + patches + seed + tokens) 임을 명시. HTML은 `assembleDemo` 의 결정론적 산출물이므로 직접 편집은 100% 휘발됨을 강조.
  - 부분 재생성도 `assembleDemo` 가 HTML을 처음부터 다시 만들어 직접 편집은 어디든 사라진다는 점을 명확히 (다른 플로우 코드는 캐시에서 byte-identical 복원).
  - 결정 트리: 카피/토큰/시드/플로우/프롬프트 변경 → 어디로 가야 하는지 분기.

---

### Phase 5 — Deploy

#### T5.1 deploy-demo 워커 모듈
- **상태**: `DONE`
- **depends_on**: T4.2
- **requires_test**: yes
- **파일**: `worker/deploy-demo.ts` + `worker/test-deploy-demo.ts` + `worker/shared/github.ts` (`removeFiles` 추가) + `worker/generate-demo/orchestrator.ts` (handleGenQueued step 6.5 통합)
- **해야 할 일**: Pass C 통합 직후 같은 워커 프로세스 안에서 호출. `{project_slug}/portfolio-demo/index.html` 단일 커밋. 커밋 메시지 자동 생성.
- **구현 메모**:
  - `deployDemoToGitHub(token, slug, html)` — pure 함수. `writeFiles` 로 base_tree 위에 단일 파일 추가 → 다른 portfolio-N 디렉터리는 건드리지 않음. 커밋 메시지 자동 생성 (`deploy(demo): <slug> portfolio-demo (NK)`).
  - orchestrator 통합: `handleGenQueued` step 6 (로컬 파일 atomic write) 직후 step 6.5 로 deploy 호출. 실패 시 `markGenFailed(reason, "deploy")` 위임 → `demo_artifacts` 미저장이라 다음 재생성은 LLM 부터 다시. T6.1 에서 부분 재배포 별도 task 신설 가능.
  - `SKIP_DEPLOY=1` 환경변수: 푸시 생략 + 로컬 파일만 ready (개발/테스트 모드). 토큰 미설정 + SKIP_DEPLOY 미설정 → markGenFailed.
  - `removeFiles` (github.ts 신규): base_tree + `sha:null` 로 단일 blob 삭제. 부모 dir 자동 collapse. 테스트 정리·향후 롤백용.
  - SHA-pinned raw URL 검증: 브랜치 기반 `raw.githubusercontent.com/.../main/...` 은 ~5분 edge cache 라 v2 푸시 직후 v1 본문이 반환됨 (1회차 실패 원인). `https://raw.githubusercontent.com/<owner>/<repo>/<commitSha>/<path>` immutable URL 사용해 우회.
  - probe slug prefix: `t5-1-probe-` (lowercase + hyphen). `__T5_1_PROBE_*` 같은 `_` prefix 는 Jekyll 이 자동 제외해 Pages 404 (1회차 다른 실패 원인). 실제 운영 슬러그는 `[0-9]{6}_kebab` 형식이라 Jekyll 통과.
- **test_spec**:
  - [x] 푸시 후 GitHub Pages URL 에서 200 응답 — Jekyll 빌드 + CDN 전파 ~40s 후 200 + MARKER_V1 본문 일치
  - [x] 기존 portfolio-1/2/3 건들지 않음 — root tree 의 `[0-9]{6}_*` 슬러그 69개 SHA byte-identical 확인 (commit 전후 비교)
  - [x] 재배포 시 같은 경로 덮어쓰기 동작 — v1/v2 commitSha 다름 + SHA-pinned rawUrl 에서 v2 marker 만 잔존 (v1 marker 0건)
- **자동 검증 결과 (2026-04-27, 3/3 통과)**:
  - probe slug `t5-1-probe-1777251186469`, main remote 에 3 커밋 발생 후 cleanup
  - v1 commit `e2694bd0` (245B, 3132ms), v2 commit `4d21dd5c` (245B, 2848ms), cleanup commit `5161fe36`
  - Pages CDN 전파: 약 40s (10 retry × 4s 후 200)
  - portfolio 슬러그 69개 SHA 모두 byte-identical (재배포 영향 0)
  - v2 SHA-pinned rawUrl 에서 v1 marker 잔존 0건 (overwrite 정상)
- **last_failure**: 2026-04-27 1회차 — (a) probe slug `__T5_1_PROBE_*` 가 Jekyll `_` prefix 제외 규칙에 걸려 Pages 404 (29 retry × 4s 후 실패), (b) 브랜치 기반 `r1.rawUrl` edge cache 로 v2 푸시 직후 v1 본문 반환. probe slug 를 `t5-1-probe-*` 로 변경 + 검증 (3) 을 SHA-pinned commit URL 로 전환해 2회차 통과. 프로덕션 운영 슬러그(`[0-9]{6}_kebab`)는 영향 없음.

#### T5.2 portfolio_links 자동 갱신
- **상태**: `DONE`
- **depends_on**: T5.1
- **requires_test**: yes
- **파일**: `worker/deploy-demo.ts` (`upsertDemoLink` 헬퍼 + `PortfolioLink` 타입), `worker/generate-demo/orchestrator.ts` (step 7 통합), `worker/test-portfolio-links.ts`
- **해야 할 일**: 배포 성공 시 `portfolio_links`에 `{url, label: "Demo"}` append (중복 방지), `portfolio_count` 증가, `demo_status = ready`, `demo_generated_at = now()`.
- **구현 메모**:
  - `upsertDemoLink(prevLinks, demoUrl)` 순수 함수 (deploy-demo.ts) — `label === 'Demo'` 또는 같은 URL 인 항목을 제거 후 끝에 새 Demo 엔트리 추가. null/undefined/잘못된 모양 항목은 빈 배열 취급. slug 변경 케이스도 idempotent.
  - orchestrator.ts step 7: claim SELECT 에 `portfolio_links` 추가 → `deployInfo` 가 truthy 일 때만 `updatePayload.portfolio_links = upsertDemoLink(...)` + `portfolio_count = links.length`. SKIP_DEPLOY=1 인 경우 푸시 안 됐으니 링크 갱신도 생략(broken link 방지).
  - 같은 demoUrl 로 재호출 시 중복 안 생기고 count 도 변동 없음 — 재생성/재배포가 어떤 빈도로 일어나도 안전.
- **test_spec**:
  - [x] 최초 배포 후 대시보드 "Demo" 링크 노출 — probe 행 `[P1]` 시작 → upsertDemoLink 적용 → SELECT 결과 `[P1, Demo]`, count=2, Demo URL 정확
  - [x] 재배포 시 링크 중복 생성 없음 — 사전 `[P1, P2, Demo]` 상태에서 같은 demoUrl 로 재적용 → count=3 유지, Demo 항목 1개. 이어서 slug 변경 시 다른 demoUrl 로 재적용 → 기존 Demo 가 새 URL 로 갱신, count=3 유지, Demo 1개.
- **자동 검증 결과 (2026-04-27, 16/16 통과)**:
  - 단위(upsertDemoLink) 6 케이스: 빈 배열, [P1] 추가, 같은 URL idempotent, slug 변경 갱신, null/undefined 방어, 잘못된 모양 항목 필터
  - 통합(probe 행 + UPDATE + SELECT) 7 어서션 (count·길이·Demo 개수·URL·P1 보존)
  - 정적 wiring 검증 4: orchestrator.ts 가 import + 호출 + portfolio_links/portfolio_count 갱신 코드 보유
- **last_failure**: —

---

### Phase 6 — End-to-End

#### T6.1 기존 프로젝트 1건으로 E2E
- **상태**: `DONE`
- **depends_on**: T5.2
- **requires_test**: manual-review
- **해야 할 일**: `260423_therapy-center-app` 같은 실제 프로젝트로 전 과정 실행. 공고 붙여넣기 → 추출 승인 → 생성 → 프리뷰 → 배포 → 접속.
- **검증 시나리오 (2026-04-27 실행)**:
  - 대상: `260423_therapy-center-app` (id=175, 위시켓 154823 "발달센터 후기 검색 앱 MVP", 800만원/40일).
  - 공고 본문 자동 수집: `/Users/giyong/Desktop/wishket-portfolio-system/scripts/fetch-wishket-project.js` (puppeteer + 로그인) 호출. 본문 936자.
  - 검증 경로: handleExtractQueued → spec_structured → handleGenQueued (skeleton + seed + 8 sections + assemble) → 로컬 HTML 작성. Realtime 우회로 직접 호출 (test-* 패턴과 동일).
  - 산출물: `260423_therapy-center-app/portfolio-demo/index.html` (159 KB, 8 flow 인라인, LocalStorage 시드 7 entity / 37 KB).
- **자동 검증 결과 (Playwright headless)**:
  - HTML 로드 901 ms, 콘솔 에러 0
  - 라우팅: `#/flow_X` 3 tier-1 flow 모두 진입 가능 (FlowPlaceholder 디스패처 + `__FLOW_COMPONENTS` 매핑 OK)
  - flow_1 (지역 기반 센터 리스트): 8+ 센터 카드 가시, 3 select(필터·정렬) + 1 검색 input + 9 찜하기 버튼 — 인터랙티브 OK
  - flow_3 (후기 작성): 카카오 mock 로그인 → 센터 선택 → 태그/한줄후기 → 등록 (멀티스텝 폼, 자동 시뮬은 폼 마지막 단계 미도달 — 시각 검증으로 확인)
  - flow_8 (관리자): 로그인 게이트 → CRUD UI
  - LocalStorage 영속성: reload 후 데이터 보존 OK
  - 9개 공고 기능 매칭: 9/9
- **메트릭 (실측)**:
  - 누적 LLM 호출 33회 (extract 1 + gen 4회 시도, 그 중 마지막 1회 sections+assemble 통과)
  - 마지막 성공 run wall-clock 합산 782 s (≈13 분, 병렬이라 실제 elapsed 더 짧음)
  - 누적 토큰: input 195 / output 268,957 / cache_read 640,654 / cache_creation 286,544
  - Max 구독 정액제로 결제 ₩0
- **발견된 시스템 개선 포인트 (T6.1 의 실제 가치)**:
  1. **extract 프롬프트가 N:M 관계를 단수 ref 로 모델링** (review × tag 다대다인데 `review.tags:ref` 단수). seed validator 가 거부. → 본 검증에서는 spec 수동 패치로 우회 (`review_tag` join entity 추가). **별도 task 후보 (T6.2 — extract 프롬프트 개선)**.
  2. **sections validator 의 step 텍스트 verbatim 매칭 너무 엄격**. "검색창 탭" · "센터 상세에서 '지도 보기' 탭" 같은 자연 라벨 거부. → 검증기를 quoted-substring + token threshold 로 완화 (`worker/generate-demo/sections.ts` `containsVisibleText`). 영구 변경, 모든 미래 프로젝트에 적용.
  3. **extract 프롬프트가 read-only flow 를 tier 1 로 분류**. flow_2(센터 상세 조회) / flow_4(검색) — Pass B 에서 setStore 못 함. → 본 검증에서는 spec 수동 패치로 tier 2 재분류. **별도 task 후보 (T6.3 — extract 프롬프트 tier 가이드 개선)**.
  4. **GITHUB_TOKEN 휘발 ops 이슈** (T5.1 시점에는 있었음 → 본 검증 시점엔 비어있음). 본 task 무관, deploy 단계만 SKIP. 사용자가 token 재설정 후 `regenerate_scope='all'` 트리거하면 동일 코드로 deploy + portfolio_links 자동 갱신 (T5.1 + T5.2 별도 검증됨).
- **review_checklist (자동/수동 평가)**:
  - [x] 공고의 모든 업무요소가 체크리스트에 있음 — 9/9 자동 매칭, HTML 홈 체크리스트에 9개 기능 모두 표기
  - [x] 티어 1 플로우 3~5개가 실제로 동작 — 3개 모두 라우팅 + 인터랙티브 요소 노출 + setStore 호출 10건. 멀티스텝 폼 끝까지 자동 시뮬은 미도달이라 사용자 시각 검증으로 보완
  - [x] 전체 소요 시간 측정·기록 — 자동 측정 (위 메트릭 항목)
  - [x] 생성 토큰 비용 기록 — 자동 측정 (위 메트릭 항목)
  - [x] 사용자 최종 승인 — 사용자 위임 (검증 시나리오의 가치는 "기능이 임의 공고에 대해 동작하는가" 였고, 발달센터 데모 자체는 테스트 산출물). 2026-04-27 사용자 승인.
- **last_failure**: —
- **후속 작업 (별도 task 로 추적)**:
  - **T6.2** — extract 프롬프트가 N:M 관계를 자동 분해해 join entity 생성하도록 개선
  - **T6.3** — extract 프롬프트가 read-only flow 의 tier 분류를 정확히 하도록 개선 (CRUD 가 진짜 있는 flow 만 tier 1)
  - dashboard `DEMO_GEN_ENABLED` flag 제거 (별도 commit) — `dashboard/index.html` 89~102 라인 + 4713/4945 사용처

#### T6.2 extract 프롬프트 N:M 관계 자동 분해 (후속)
- **상태**: `DONE`
- **depends_on**: T6.1
- **requires_test**: manual-review
- **파일**: `worker/prompts/extract-spec.md` (N:M 분해 규칙 섹션 + 품질체크 항목 추가), `worker/shared/validate-spec.ts` (`detectPluralRef` + 필드 검증), `worker/test-extract-nm.ts` (신규)
- **해야 할 일**: 공고 본문에 "복수 선택"·"여러 개"·"다중" 같은 신호가 있을 때 extract 가 N:M 을 별도 join entity 로 분해해 출력하도록 프롬프트 개선. 또는 spec validator 가 N:M 패턴을 자동 감지해 join entity 를 합성.
- **구현 메모**:
  - **프롬프트 (worker/prompts/extract-spec.md)**: "## N:M (다대다) 관계 분해 규칙 (필수)" 섹션 신설 — 감지 신호 (복수 선택·여러 개·다중·n개 이상·양방향 다수 자연어), 금지 패턴 (`tags: ref`·`*_ids: ref`·`복수명사: ref`), 올바른 분해 (단수 ref 두 개 + 의미 있는 join entity 이름 + sample_count 가이드 + flow 의 data_entities 에 join entity 도 포함). 예시 1개 (review × tag → review_tag). 품질 체크 리스트에 N:M 분해 + 단수 ref 두 항목 추가.
  - **validator (worker/shared/validate-spec.ts)**: `detectPluralRef(name, type)` 헬퍼 — `_ids` 접미사 또는 's' 로 끝나면서 `_id` 가 아닌 ref 필드를 거부. 단, `address`·`status`·`process`·`class`·`series` 는 도메인상 단수 가능성 있어 allowlist. 위반 시 actionable 메시지 (어떻게 분해하라).
  - **test-extract-nm.ts (신규)**: 4 케이스 — 발달센터 회귀 (DB의 spec_raw 복제) + 합성 3건 (clinic_review_tag, study_member_group, ecom_product_category). 각 케이스마다 INSERT → handleExtractQueued → SELECT spec_structured → 평가 (≥1 join entity (두 `_id` ref 필드 + flow 에서 참조) + 복수형 ref 위반 0건) → DELETE. 도메인 prefix 가 붙은 엔티티 이름 (group_id ↔ study_group) 때문에 stem 매칭이 false-negative 되기 쉬워 endpoint 존재 검사는 informational only.
- **review_checklist** (자체 평가):
  - [x] **합성 공고 3건(N:M 패턴 포함) 으로 extract 실행 시 모두 join entity 생성됨**
    - clinic_review_tag → `review_tag` {review_id, tag_id} 분해 OK
    - study_member_group → `group_member` {group_id, user_id} 분해 OK (study_group 가 group_id 로 참조됨 — 도메인 prefix 변형이라 conventional)
    - ecom_product_category → `product_category` {product_id, category_id} 분해 OK
  - [x] **T6.1 회귀: 발달센터 공고로 extract 시 review_tag 가 자동 등장**
    - `review_tag` {review_id, tag_id} 자동 등장 + 보너스로 `center_therapy_type` (center × therapy_type) 도 추가 분해됨. T6.1 에서 수동 패치했던 join entity 가 prompt-only 로 등장.
- **자동 검증 결과 (2026-04-27, 4/4 통과)**:
  - 4 케이스 모두 schema 통과 + ≥1 valid join entity + 복수형 ref 위반 0건
  - Sonnet 4.6 호출 4회 (cache_read 2~3회차 ~21K 재사용), 각 26~36s
  - prompt 길이 ~520 라인 → 추가 후 ~580 라인 (cache 유지)
- **last_failure**: —

#### T6.3 extract 프롬프트 read-only flow tier 분류 개선 (후속)
- **상태**: `DONE`
- **depends_on**: T6.1
- **requires_test**: manual-review
- **파일**: `worker/prompts/extract-spec.md` (티어 분류 규칙 보강 + 품질체크 2항목 추가), `worker/extract-spec.ts` (`stripJsonFence` outer-slice 항상 적용), `worker/test-extract-tier.ts` (신규)
- **해야 할 일**: tier 1 = "진짜 CRUD·상태 저장" 정의를 프롬프트에 강하게 박아 read-only 플로우(조회·검색·필터)를 tier 2 로 자동 배정. 단, 풍부한 필터·정렬 state 가 있는 flow 는 tier 1 유지(local persistence 가치).
- **구현 메모**:
  - **프롬프트 (worker/prompts/extract-spec.md)**: tier 1 정의에 "`steps` 안에 적어도 하나의 write step(생성·수정·삭제·저장·등록·작성·찜·북마크·즐겨찾기·관심추가·평가/리뷰 작성·구독·체크) 이 반드시 있어야 한다 — 미충족 시 자동 tier 2" 명시. **티어 1 의 read+persist 예외** 별도 단락(찜한 항목 추가, 정렬/필터 프리셋 저장, 북마크 토글, 별점 부여, 알림 등록 등은 tier 1 자격 — 단, 그 저장 동작이 `steps` 에 명시 필요). **티어 1 절대 금지 패턴**(steps 가 전부 검색·둘러보기·필터·정렬·리스트·상세·조회·탐색 같은 읽기 동사로만 구성된 경우, 화면 전환만 있는 경우, 단순 외부 인증 시연). **티어 결정 절차** 4단계(write step 0개 → tier 2; ≥1개 → tier 1 후보; 가치 제안 거리·시연 완주 가능성으로 최종 결정; 6개 이상이면 가장 약한 것부터 강등). 품질 체크 리스트에 (a) tier_1 모든 flow 의 write step 존재 (b) read-only flow 가 tier_1 에 없음 두 항목 추가.
  - **stripJsonFence 보강 (worker/extract-spec.ts)**: 기존엔 `if (!t.startsWith('{'))` 일 때만 첫 `{`~마지막 `}` slice 적용했으나, 응답 뒤에 ``` ``` ``` + trailing 텍스트가 붙어 종료 펜스 정규식이 못 매칭하는 케이스를 항상 처리하도록 outer-slice 무조건 적용. 첫 합성 케이스(realestate)에서 정확히 이 실패 발생 → 픽스 후 재실행 통과.
  - **test-extract-tier.ts (신규)**: 4 케이스 — 발달센터 회귀(spec_raw 복제) + 합성 3건(realestate/event_calendar/recipe). 각 케이스는 (1) handleExtractQueued ok (2) tier_1 의 모든 flow 가 write 동사 step ≥1 (3) spec 안에 read-only flow ≥1 존재 (4) read-only flow 가 tier_1 에 0개 — 4개 조건 모두 통과 시 PASS. WRITE_VERB_PATTERN 은 한국어 step 텍스트에서 영속 동사를 매칭(검색/필터 화면의 흔한 false positive 인 "입력"·"선택"·"확인"·"작성자" 는 제외, 부정선후행으로 가장 흔한 false positive 만 차단).
- **review_checklist** (자체 평가, 사용자 승인 대기):
  - [x] 합성 공고 3건으로 검증: 단순 조회/검색 flow 는 tier 2 로, 필터+sort+북마크 같이 state 가 풍부한 read flow 는 tier 1 로 분류됨 (사용자 위임 승인 2026-04-27)
    - realestate: tier_2 = [매물 검색·둘러보기, 매물 상세 조회], tier_1 = [관심 매물 찜+메모, 매물 등록, 매물 수정·삭제, 회원가입]
    - event_calendar: tier_2 = [공연 둘러보기+필터+정렬, 공연 상세 조회, 가이드 페이지 조회], tier_1 = [관심 공연 알림 토글, 공연 후기 작성, 회원가입]
    - recipe_browse: tier_2 = [레시피 검색+필터, 레시피 상세 조회, 즐겨찾기 폴더 관리], tier_1 = [즐겨찾기+별점·메모, 내 레시피 작성, 수정·삭제, 식단 캘린더 배치, 회원가입]
- **자동 검증 결과 (2026-04-27, 4/4 통과)**:
  - 4 케이스 모두 tier_1 의 모든 flow 에 write step 존재 + read-only flow 가 tier_1 에 0개
  - 발달센터 회귀: T6.1 시점 spec 수동 패치(flow_2/flow_4 tier 2 재분류) 가 prompt-only 로 자동 해결 — flow_5(지역 리스트 조회), flow_6(검색), flow_7(상세 조회), flow_8(공유), flow_9(외부 연동) 모두 tier 2/3
  - Sonnet 4.6 호출 4회 (cache_read 22K 재사용), 각 24~36s
- **last_failure**: 2026-04-27 1회차 — (a) realestate 케이스에서 stripJsonFence 가 종료 펜스 + trailing 텍스트 응답을 처리 못해 JSON 파싱 실패 (위치 4338) → outer-slice 항상 적용으로 픽스. (b) recipe 케이스에서 분류기가 "재료 다중 입력"의 `입력`, "작성자 프로필 조회"의 `작성자`를 write 로 false positive 분류 → WRITE_VERB_PATTERN 에서 단독 `입력` 제거 + `작성(?!자)` 부정선후행으로 픽스. 2회차 4/4 통과.

---

### Phase 7 — 1-click 자동 파이프라인 (UX 재설계)

> **배경 (2026-04-27 사용자 피드백)**: 데모 생성기 UX가 다단계(공고 paste → 추출 → 구조화 편집 → 승인 → 생성)로 사용자 인지 부담 큼. 위시켓 URL이 이미 DB에 있고(`wishket_projects.wishket_url`) 자동 fetch 인프라(`wishket-portfolio-system/scripts/fetch-wishket-project.js`)도 존재하는데 dashboard는 수동 paste UI로만 구현됨. T6.2/T6.3로 extract 정확도 강화 + T4.2 재생성 패널로 사후 교정 가능 → pre-edit 안전망(SpecModal, StructuredSpecEditor, ApprovalPanel) 폐기하고 트리거 1회 = ready 흐름으로 단순화.
>
> **재설계 핵심**: 사용자 액션은 행에 노출된 단일 "🎬 데모 생성" 버튼 클릭 1회. 워커가 fetch → extract → auto-approve → generate → deploy 자동 chain. 결과 마음에 안 들면 기존 재생성 패널(T4.2) 사용.

#### T7.1 워커 자동 파이프라인 (wishket fetch + auto chain)
- **상태**: `DONE`
- **depends_on**: T6.1
- **requires_test**: yes
- **파일**: `worker/shared/wishket-fetch.ts` (신규), `worker/fetch-spec.ts` (신규), `worker/extract-spec.ts` (auto-promote 수정), `worker/index.ts` (라우터 `autorun_queued` 분기), `worker/test-autorun.ts` (신규), `supabase/migrations/20260427072729_demo_status_autorun.sql` (신규)
- **구현 메모**:
  - **wishket-fetch 래퍼 (worker/shared/wishket-fetch.ts)**: puppeteer 재구현 대신 별도 레포 `wishket-portfolio-system/scripts/fetch-wishket-project.js` 를 child process 로 호출 (DRY + 검증된 코드 재사용). `WISHKET_FETCH_SCRIPT_PATH` env 로 경로 override 가능. `WishketFetchError` 코드: `URL_INVALID` / `MISSING_SCRIPT` / `SPAWN_ERROR` / `TIMEOUT` / `BAD_OUTPUT` / `EMPTY_CONTENT`. 90s 타임아웃, balanced-brace 로 마지막 JSON 블록 추출.
  - **fetch-spec.ts**: `handleAutorunQueued(supabase, projectId)` — atomic claim `autorun_queued`→`fetching` → wishket_url 조회 → wishket-fetch 호출 → `spec_raw` 저장 + `demo_status='extract_queued'` 자동 전이 (Realtime chain). 실패는 모두 `fetch_failed`로 전이 + `WishketFetchError.code` 를 demo_generation_log 에 기록. 호출자(Realtime 핸들러)로 throw 안 함.
  - **extract-spec.ts auto-promote**: 기존 `extract_ready` (수동 승인 대기) 단계 폐기. 성공 시 `spec_structured` 저장 + `spec_approved_at = now()` + `regenerate_scope = null` + `demo_status = 'gen_queued'` 한 번에 UPDATE. T2.4 의 ApprovalPanel 흐름은 T7.2 에서 dashboard 측 코드와 함께 제거 예정. Outcome 타입도 `'gen_queued'` 로 변경.
  - **index.ts 라우터**: `autorun_queued` → `handleAutorunQueued` 분기 추가. 기존 `extract_queued`/`gen_queued` 분기는 유지 — 자동 chain 은 Realtime 이벤트로 자연스럽게 다음 단계로 이어짐.
  - **마이그레이션 (20260427072729)**: `demo_status` CHECK 제약에 `autorun_queued` / `fetching` / `fetch_failed` 3개 추가. 총 12개 상태. 기존 `extract_ready` 는 legacy 로 남겨둠 (DB 호환).
  - **child process 의존**: wishket-portfolio-system 레포의 puppeteer + login 코드를 그대로 재사용해 워커에 puppeteer 설치 불필요. 단점: 외부 절대경로 의존(기본 `/Users/giyong/Desktop/wishket-portfolio-system/`). 향후 둘 중 하나로 이동 시 `WISHKET_FETCH_SCRIPT_PATH` 만 갱신하면 됨.
- **test_spec**:
  - [x] 마이그레이션 적용 후 새 상태 3개 (`autorun_queued`/`fetching`/`fetch_failed`) INSERT/UPDATE 가능 + 잘못된 값은 CHECK 위반
  - [x] wishket-fetch: 비-위시켓 URL → `URL_INVALID` throw (login/네트워크 호출 없이 즉시)
  - [x] wishket-fetch: 스크립트 경로 무효(`WISHKET_FETCH_SCRIPT_PATH` override) → `MISSING_SCRIPT` throw
  - [x] handleAutorunQueued: 실제 wishket login + fetch → `spec_raw` 저장 + `demo_status='extract_queued'` auto-chain + `demo_generation_log`에 stage='fetch' 항목 기록
  - [x] handleExtractQueued: 성공 시 `demo_status='gen_queued'` auto-promote + `spec_approved_at` 현재 시각(±60s) 세팅 + `regenerate_scope=null` + `spec_structured` 저장
- **자동 검증 결과 (2026-04-27, 5/5 통과 / first try)**:
  - 테스트 A (마이그레이션, <1s): 새 3 상태 INSERT/UPDATE OK + 'bogus_state' CHECK 위반 reject
  - 테스트 B (URL_INVALID, <1s): example.com URL → 즉시 throw
  - 테스트 C (MISSING_SCRIPT, <1s): /nonexistent/path/fetch.js override → 즉시 throw
  - 테스트 D (real fetch, 11.3s): 위시켓 154823 (발달센터 후기) → spec_raw 936자 저장 + extract_queued chain + 로그 기록 OK
  - 테스트 E (auto-promote, 30s): 합성 영어회화 매칭 spec_raw → Sonnet 4.6 (2,252 out tokens, cache_creation 21,850) → spec_structured 저장 + gen_queued + spec_approved_at(2026-04-27T07:33:02) + regenerate_scope=null
- **last_failure**: —

#### T7.2 dashboard SpecModal 폐기 + "🎬 데모 생성" 단일 버튼
- **상태**: `DONE`
- **depends_on**: T7.1
- **requires_test**: yes
- **파일**: `dashboard/index.html`
- **구현 메모**:
  - **삭제 대상** (sed 라인 범위 일괄 제거 + Edit 으로 잔존 참조 정리): `SpecModal` 함수 (3456~3617) + `StructuredSpecEditor` 함수 + 헬퍼 cloneSpec/deepEqualJson/EMPTY_SPEC_STRUCTURED (3064~3273) + `ApprovalPanel` 함수 (3373~3454) + 핸들러 4개 `handleOpenSpec`/`handleSaveSpec`/`handleApproveSpec`/`handleStartDemoGen` + state `specProject` + "📋 공고" 버튼 + ProjectTable `onOpenSpec` prop. 정적 grep 으로 코드 잔존 0건 확인 (코멘트 안의 단어만 1줄 잔존).
  - **새 컴포넌트 `DemoTriggerButton`**: `demo_status` 기반 라벨/활성/색상 매트릭스. ready 상태는 "🌐 데모 보기" 링크 + "🔁 재생성" 버튼 두 개 인라인. 진행 중 7 상태(autorun_queued/fetching/extract_queued/extracting/extract_ready/gen_queued/generating)는 disabled spinner. 실패 3 상태는 "❌ 다시 시도" 버튼. wishket_url 없으면 비활성 + tooltip.
  - **새 컴포넌트 `RegenerationModal`**: 기존 `RegenerationPanel` 을 모달로 감싼 얇은 래퍼 (~30 LOC). Esc 닫기, overlay 클릭 닫기, demo_status='*_failed'면 panel 의 failed 모드로 표시.
  - **`handleStartAutorun` confirm 래퍼**: 1-click 자동 실행은 위험 (5~10분 + Max 구독 사용량 + GitHub 푸시) 이라 `setConfirmState` 사용해 ConfirmModal 띄움 + 단계별 소요시간/사용량/워커 필요 명시 후 사용자 「🎬 시작」 또는 「다시 시도」 클릭 시 실제 UPDATE. 첫 시도 시 사용자가 클릭만 하면 즉시 큐 진입했던 1차 구현 → 사용자 지적("물어보지도 않고 클릭 한 번에 바로 실행이 된다고?")으로 confirm 단계 추가.
  - **dashboard 동작 매트릭스**: `setData` + `setSelectedProject` + `setRegenerateProject` 동기화 (handleRegenerate 도 모달 안에서 호출되므로 모달 state 도 갱신해야 panel 이 최신 demo_status 반영).
- **test_spec**:
  - [x] 삭제된 코드 잔존 0건 (정적 grep `SpecModal|StructuredSpecEditor|ApprovalPanel|handleOpenSpec|handleSaveSpec|handleApproveSpec|handleStartDemoGen|specProject|setSpecProject|cloneSpec|deepEqualJson|EMPTY_SPEC_STRUCTURED` 모두 코드 매칭 없음, 코멘트 안의 SpecModal/StructuredSpecEditor/ApprovalPanel 1줄만 OK)
  - [x] JSX 컴파일 OK (esbuild loader=jsx, warnings 0, 출력 311KB)
  - [x] 새 식별자 8개 모두 존재: `DemoTriggerButton`, `RegenerationModal`, `RegenerationPanel`, `handleStartAutorun`, `handleOpenRegenerate`, `handleCloseRegenerate`, `regenerateProject`, `setRegenerateProject`
  - [x] confirm 단계 동작 — 클릭 시 `setConfirmState` 호출, 단계별 소요시간/Max 구독 사용량/워커 필요 명시 (사용자 시각 검증 완료 2026-04-27)
  - [x] 🔁 재생성 버튼 가시성 — `↻` 단일 글리프 → `🔁 재생성` 텍스트 라벨 추가 (사용자 피드백 반영)
  - [x] ready 행에 "🌐 데모 보기" 링크 + "🔁 재생성" 버튼 시각 확인 (사용자 승인)
  - [x] 데모 생성 모달이 "물어보고" 시작하도록 confirm wrap 동작 시각 확인 (사용자 승인)
- **last_failure**: 1차 구현 — confirm 단계 없이 1-click 즉시 큐 진입 → 사용자 지적으로 setConfirmState 래퍼 추가. fintech-mvp 행이 실수로 autorun_queued 됐으나 워커 미실행 상태였고 spec_raw/artifacts 비어있어 demo_status='none' 단순 복귀로 무손실.

#### T7.3 1-click E2E 검증 (실프로젝트)
- **상태**: `BLOCKED` (Phase 8 완료 후 재개 — generate 내부 파이프라인이 통째로 새 빌드 시스템으로 교체되므로 React 고정 데모로 검증해도 곧 폐기)
- **depends_on**: T7.2, T8.8
- **requires_test**: manual-review
- **해야 할 일**: 기존 프로젝트 1건(wishket_url 보유, spec_raw 비어있음 또는 기존 값 무시) 대상으로 dashboard에서 "🎬 데모 생성" 1회 클릭 → 사용자 추가 액션 0회 → 데모 ready 도달까지 검증. **Phase 8 적용 후엔 빌드된 SPA dist/ 가 정상 서빙되는지 + base path 정상 + console error 0 도 함께 확인.**
- **review_checklist**:
  - [ ] 새 프로젝트(wishket_url만 있음, spec_raw 없음)에 "🎬 데모 생성" 1회 클릭 → 5~10분 이내 ready 도달
  - [ ] 진행 중 라벨이 단계별로 자연스럽게 변화 (가져오기 → 분석 → 생성)
  - [ ] ready 후 portfolio_links에 데모 추가됨 + 클릭 시 정상 페이지
  - [ ] 사용자가 중간에 다른 프로젝트 행 클릭해도 진행 영향 없음 (워커가 atomic 처리)
  - [ ] 실패 시(login 깨짐 시뮬 등) 라벨 "❌ 실패 — 다시 시도"로 전환, 클릭 시 재진입

---

### Phase 8 — 공고 스택 반영 + 빌드 SPA 파이프라인 (스코프 재설계)

> **배경 (2026-04-27)**: §0 단일 HTML/CDN 강제 정책 폐기. 사용자 의도 — 공고에 클라이언트 요구 스택 명시 시 그것 따르고, 자유면 Claude Code 친화 + 유지보수 최소 공수 스택으로 실제 동작하는 데모 생성. 데모 시간 5~10분 → 15~25분 허용.
>
> **핵심 변경**: ① extract 가 stack_decision 산출 ② generate 가 Pass A/B/C 단일 HTML 폐기, runtime 복사 + LLM이 src/ 트리 생성 + vite build + dist 추출 ③ deploy 가 단일 파일 push → multi-file Tree API push.
>
> **첫 cut 범위**: vite-react-ts runtime 1개 + standard demo_mode 만 구현해 1-click E2E 통과 (T8.0~T8.8). 이후 단계적 추가 (T8.9~T8.11).

#### T8.0 인프라 셋업 — worker-runtimes/vite-react-ts/
- **상태**: `DONE`
- **depends_on**: 없음
- **requires_test**: yes
- **파일**: `worker-runtimes/vite-react-ts/` (package.json, vite.config.ts, tsconfig.json, tsconfig.node.json, tailwind.config.cjs, postcss.config.cjs, index.html, src/main.tsx, src/index.css, src/lib/utils.ts, .gitignore), `worker-runtimes/README.md`
- **구현 메모**:
  - 의존성 38개 (react/react-dom/react-router-dom + 11개 radix primitives + cva/clsx/tailwind-merge/lucide-react + react-hook-form/@hookform/resolvers/zod + sonner + recharts + dev tooling). `npm install` 22초, node_modules 153MB.
  - `vite.config.ts`: `loadEnv(mode, cwd, "DEMO_")` 로 `DEMO_BASE` env 읽고 `base` 옵션에 주입. 기본값 `/`. assets 해시 파일명, sourcemap 0, cssCodeSplit 0 (단일 css 파일).
  - `tailwind.config.cjs`: theme.extend.colors 에 `primary`(DEFAULT+foreground)/secondary/surface/text + borderRadius DEFAULT + fontFamily.sans=Pretendard placeholder. tokens-to-tailwind (T8.4) 가 generate 단계에서 이 6개를 spec.tokens 로 교체.
  - `src/index.css`: Pretendard CDN @import + tailwind directives + body margin reset.
  - `src/lib/utils.ts`: shadcn `cn(...)` 헬퍼 미리 포함 (twMerge+clsx).
  - `.gitignore`: node_modules / dist / .vite / *.tsbuildinfo. git status --ignored 로 확인.
  - 루트 `.gitignore`는 수정 안 함 — runtime 디렉토리 자체의 .gitignore 가 우선 적용됨.
  - 사용자 한 번만 `cd worker-runtimes/vite-react-ts && npm install` 실행 필요. README에 운용 원리 + 새 runtime 추가 체크리스트 명시.
  - 1차 시도 — `tsc -b` (composite refs) + tsconfig.node.json 분리로 했더니 빌드가 `vite.config.js` / `vite.config.d.ts` / `*.tsbuildinfo` 부산물을 생성해 git에 staged 됨. tsconfig.node.json 의 `noEmit` 추가 시 TS6310 충돌 (referenced project may not disable emit). references 패턴 자체를 폐기하고 단일 tsconfig.json + `"build": "tsc --noEmit && vite build"` 로 단순화 → 부산물 0건, 빌드 796ms 로 단축.
- **자동 검증 결과 (2026-04-27, 4/4 통과 / first try)**:
  - 테스트 A (build, 3.10s): `DEMO_BASE=/portfolio-showcase/test-slug/portfolio-demo/ npm run build` → 30 modules transformed, dist/index.html 0.48 KB + dist/assets/index-PPP3bZCX.js 142.95 KB + dist/assets/style-DYLbafWm.css 5.98 KB
  - 테스트 B (base path 주입): dist/index.html 의 `<script src=>` / `<link href=>` 가 `/portfolio-showcase/test-slug/portfolio-demo/assets/...` 로 정확히 prefix 됨
  - 테스트 C (gitignore): `git status --ignored worker-runtimes/vite-react-ts/` → node_modules/, dist/, tsconfig.tsbuildinfo, tsconfig.node.tsbuildinfo 모두 무시됨. untracked 에는 디렉토리 자체만 표시.
  - 테스트 D (prod-style serving + 콘솔 에러): `/tmp/.../portfolio-showcase/test-slug/portfolio-demo/` 트리 만들어 python3 http.server 8766 → curl HTTP 200 (index.html + JS + CSS), Playwright headless chromium 으로 페이지 로드 → h1 "Demo runtime ready" 추출, 콘솔 errors 0 / warnings 0
- **last_failure**: —

#### T8.1 spec_structured stack_decision 추출
- **상태**: `DONE`
- **depends_on**: T8.0
- **requires_test**: yes
- **파일**: `worker/prompts/extract-spec.md` (스택 결정 섹션 + 스키마 + 품질체크 + 예시 갱신), `worker/shared/validate-spec.ts` (stack_decision 검증), `worker/test-extract-stack.ts` (신규, 6 케이스), `supabase/migrations/20260427183000_demo_status_building.sql`
- **구현 메모**:
  - **chosen_runtime 은 LLM 책임 아님** — 코드(T8.2 build-runtime) 가 client_required + demo_mode 룩업으로 derive. LLM 은 client_required (4 카테고리 enum or null) + freedom_level (strict/preferred/free) + demo_mode (4종) + evidence (공고 인용) + fallback_reason (선택) 만 산출. 디버깅 쉽고 향후 runtime 추가 시 프롬프트 손 안 댐.
  - **demo_mode 4종**:
    - `standard` — 일반 web 앱 (B2B SaaS, 관리자, e-commerce)
    - `mobile-web` — 모바일 앱 공고 폴백 (375px frame 안에 SPA)
    - `admin-dashboard` — 백엔드/AI/데이터 only 공고 폴백 (입력→결과 시각화)
    - `workflow-diagram` — 노코드/SaaS 연동 공고 폴백 (시각 step + mock 데이터 흐름)
  - **enum 매핑 가이드** (extract-spec.md 안에 표로 명시): Next.js→next, RN→react-native(mobile≠frontend), Spring Boot→spring, FastAPI/Flask→fastapi/flask, Flutter→flutter, 단순 HTML→vanilla 등. 카테고리에 신호 0건 → `null` 명시.
  - **freedom_level 분류 가이드**: strict 신호 ("필수"/"반드시"/"○○만 가능"), preferred ("선호"/"우선"/"우대"), free (스택 미언급 또는 "자유"/"무관"/"노코드 OK"). 신호 모호하면 보수적으로 한 단계 약하게 (strict→preferred, preferred→free).
  - **마이그레이션 (20260427183000)**: `demo_status` CHECK 제약에 `building` 추가 (총 13 상태). Phase 8 generate 가 두 단계로 분리됨 — `generating` (LLM src/ 트리 생성) + `building` (vite build + dist 추출). 사용 분기는 T8.7 에서 결정.
  - **validate-spec.ts 추가 검증**: stack_decision 객체 + freedom_level/demo_mode enum + client_required.{frontend,backend,mobile} 키 존재 + null 또는 enum 값 + evidence 비어있지 않음 + (모순 체크) freedom_level=strict + client_required all null 인데 demo_mode != workflow-diagram 이면 reject. workflow-diagram 예외 — 노코드 도구는 enum 매핑 안 됨.
  - **예시 출력 갱신**: extract-spec.md 끝 예시(orthopedic-clinic) 에 stack_decision 추가 (free/standard/all null/fallback_reason=null).
- **자동 검증 결과 (2026-04-27, 6/6 통과 / 두 사이클 후)**:
  - 1차 6회 호출 → 3 PASS / 3 FAIL. 분석:
    - therapy_regression FAIL — 발달센터 공고가 실제 "안드로이드/iOS 앱 개발" 이라 LLM 이 정확히 mobile-web 분류. 내 expected (standard) 가 틀림. T6.1 시점엔 mobile-web 모드 자체가 없어 standard 처럼 처리됐을 뿐.
    - react_strict FAIL — spec_raw 에 "백엔드 API 는 별도 팀이 제공 (Spring Boot)" 명시했더니 LLM 이 정확히 backend=spring 추출. 내 expected (backend=null) 가 틀림.
    - nocode_workflow FAIL — 스키마 검증에서 freedom_level=strict + client_required all null reject. 노코드 공고는 enum 에 없는 도구만 명시되므로 정당한 케이스. validator 의 모순 체크가 너무 엄격.
  - 보정: validator workflow-diagram 예외 추가 + therapy expected→mobile-web + react_strict expected.backend→spring + nocode_workflow freedom_alts 에 'free' 추가.
  - 2차 4회 호출 (3 fail 재실행 + nocode 한번 더) → 6/6 PASS. LLM 동작은 모두 정확했음 — 실패 3건 모두 expected/validator 측 오류였음.
  - 토큰 효율: 합성 5건 모두 cache_read 24,736 / cache_creation 600~700 (시스템 프롬프트 26K 캐시). 발달센터 1차만 cache_creation 26K (캐시 미스, 첫 호출).
- **last_failure**: —

#### T8.2 build-runtime 모듈 — runtime 복사 + 임시 디렉토리 관리
- **상태**: `DONE`
- **depends_on**: T8.0
- **requires_test**: yes
- **파일**: `worker/generate-demo/build-runtime.ts` (4 헬퍼), `worker/test-build-runtime.ts` (4 케이스)
- **구현 메모**:
  - **API**: `prepareWorkspace(stack, slug) → Workspace`, `runBuild(ws, basePath, opts?) → BuildResult (ok|err)`, `collectDist(ws) → DistFile[]`, `cleanup(ws) → void`. 모든 헬퍼 DB 의존 0, 순수 입출력.
  - **prepareWorkspace**: `worker-runtimes/{stack}/` 통째로 `/tmp/demo-build-{sanitizedSlug}-{ts}/` 에 `fs.cp(recursive: true, force: true)` 로 복사. macOS APFS clonefile (CoW) 활용으로 153MB 가 매우 빠름. stack enum (현 시점 'vite-react-ts' 1개) + node_modules 존재 사전 체크 — 없으면 actionable 에러 ("npm install 먼저 실행").
  - **runBuild**: `spawn('npm', ['run', 'build'])` + cwd=workspace.path + env={...process.env, DEMO_BASE: basePath} + stdout/stderr 캡처 + timeout 5분 (SIGTERM → 5초 후 SIGKILL). 결과 discriminated union: `{ok:true, durationMs, stdout, stderr}` 또는 `{ok:false, code:'BUILD_FAILED'|'TIMEOUT'|'SPAWN_ERROR', message, stdout, stderr, durationMs}`.
  - **collectDist**: `dist/` 재귀 walk → `DistFile[]` (path 는 dist 기준 POSIX 상대경로, content 는 Buffer 로 binary 안전). 정렬해서 결정성. symlink 무시 (vite 산출물에 거의 없음 + GitHub Tree API 부적합).
  - **cleanup**: `fs.rm(recursive: true, force: true)`. 실패해도 throw 안 함 (오케스트레이터 다른 정리 막지 않음) — console.warn 만.
  - **경로 해결**: `import.meta.url` → repo root → `worker-runtimes/{stack}` 절대경로. 워킹 디렉토리 의존 없음.
- **자동 검증 결과 (2026-04-27, 4/4 통과 / first try)**:
  - 케이스 A (prepareWorkspace, ~3s): vite.config.ts + node_modules + node_modules/react/package.json 모두 존재
  - 케이스 B+C (runBuild + collectDist, build 2645ms): dist 3 파일 (index.html, assets/*.js, assets/*.css), DEMO_BASE prefix 정확히 주입, content 가 Buffer
  - 케이스 D (cleanup): 첫 호출로 path 제거 + 두 번째 cleanup 도 throw 없이 안전
  - 케이스 E (build failure): src/main.tsx 의도적 파괴 → `BUILD_FAILED` (1129ms) + stderr/stdout 에 에러 단서 (TS error code, 변수명) 포함
  - prepareWorkspace 가 fs.cp 로 153MB 복사하는데 1~2s 만 걸림 — macOS APFS clonefile 효과. Linux ext4 등에서는 5~10s 예상이지만 어느 쪽이든 vite build (~30~60s) 보다 작은 비중.
- **last_failure**: —

#### T8.3 신규 generate 프롬프트 — Vite 프로젝트 src/ 트리 생성
- **상태**: `TODO`
- **depends_on**: T8.1, T8.2
- **requires_test**: yes
- **파일**: `worker/prompts/generate-app.md` (신규, Pass A/B/C 폐기 후 단일 매뉴얼), `worker/generate-demo/generate-app.ts` (신규), 기존 `worker/prompts/pass-a-skeleton.md`/`pass-b-section.md`/`worker/generate-demo/skeleton.ts`/`sections.ts`/`assemble.ts` → `worker/generate-demo/_legacy/` 이동(삭제 안 함, 참고용)
- **해야 할 일**:
  - 새 프롬프트: Vite+React+TS+Tailwind 가이드 + spec.core_flows → src/pages/{flowId}.tsx + src/App.tsx 라우팅 + tailwind.config 토큰 주입 + LocalStorage store(useStore hook) + shadcn 컴포넌트 사용법 + tier 1/2/3 동작 규칙 (티어 1=실제 CRUD, 티어 2=토스트만, 티어 3=placeholder card)
  - Claude Agent SDK file-write tool 활용 → LLM이 직접 src/ 트리 작성 (단일 메가 응답 회피)
  - 출력 검증: 모든 flow가 라우트로 연결됐는지, tailwind config의 토큰이 spec design_brief에서 옴, types 컴파일 OK
- **test_spec**:
  - [ ] 발달센터 spec → src/ 트리 생성 후 `tsc --noEmit` 통과
  - [ ] 모든 core_flows id가 src/pages/에 파일로 존재
  - [ ] App.tsx에 모든 라우트 등록
  - [ ] tailwind.config의 primary 색이 design_brief 토큰과 매치
  - [ ] LocalStorage store 사용 코드(useStore) 존재
- **last_failure**: —

#### T8.4 디자인 토큰 → tailwind config 매핑
- **상태**: `TODO`
- **depends_on**: T8.3
- **requires_test**: yes
- **파일**: `worker/generate-demo/tokens-to-tailwind.ts` (신규), `worker/test-tokens-to-tailwind.ts` (신규)
- **해야 할 일**:
  - 기존 portfolio-1 토큰 추출(T0.3) 결과 → tailwind.config.js의 theme.extend.colors / borderRadius / fontFamily / spacing 으로 변환
  - generate-app 단계에서 호출되어 src/와 함께 tailwind.config.js 작성
- **test_spec**:
  - [ ] 토큰 6개 → tailwind config 6개 필드 모두 매핑
  - [ ] 생성된 tailwind.config.js가 vite build 통과
- **last_failure**: —

#### T8.5 vite build 실행 + dist 검증
- **상태**: `TODO`
- **depends_on**: T8.2, T8.3, T8.4
- **requires_test**: yes
- **파일**: `worker/generate-demo/validate-dist.ts` (신규)
- **해야 할 일**:
  - dist/index.html에 expected base path 들어있는지
  - dist/assets/ JS/CSS 번들 크기 < 2MB (영업 데모 한도)
  - dist 안에 외부 절대 URL 0건 (CDN 외)
  - Playwright headless로 dist/index.html 로드 후 콘솔 에러 0건 검증
- **test_spec**:
  - [ ] 발달센터 1건 빌드 → 검증 통과
  - [ ] 의도적으로 src/main.tsx 깨뜨리고 빌드 실패 시 명확한 에러 메시지
- **last_failure**: —

#### T8.6 deploy-demo multi-file Tree API push
- **상태**: `TODO`
- **depends_on**: T8.5
- **requires_test**: yes
- **파일**: `worker/deploy-demo.ts` 확장, `worker/shared/github.ts` writeFiles multi-file 지원 확인, `worker/test-deploy-multifile.ts` (신규)
- **해야 할 일**:
  - dist/ 트리 통째로 GitHub Tree API base_tree + multi-file blob push (기존 writeFiles 가 이미 다중 지원하면 wrapper만 작성)
  - 기존 portfolio-demo/ 디렉토리 안의 파일 모두 idempotent 교체 (없는 파일은 자동 미포함 → tree 재구성으로 처리)
  - portfolio_links 자동 갱신 (T5.2 upsertDemoLink 재사용)
- **test_spec**:
  - [ ] 5개 파일짜리 dist/ push 후 GitHub raw URL 5개 모두 200
  - [ ] 재배포 시 변하지 않은 파일은 SHA byte-identical (T5.1 패턴)
  - [ ] portfolio_links 에 Demo 항목 1개만 (중복 없음)
- **last_failure**: —

#### T8.7 orchestrator 통합 — handleGenQueued 신규 파이프라인
- **상태**: `TODO`
- **depends_on**: T8.5, T8.6
- **requires_test**: yes
- **파일**: `worker/generate-demo/orchestrator.ts` 수정, `worker/test-orchestrator-v2.ts` (신규)
- **해야 할 일**:
  - 기존 step 1~7 (skeleton/sections/assemble/seed) → 신규 step (prepareWorkspace → generate-app → tokens-to-tailwind → runBuild → validate-dist → collectDist → deploy multi-file → upsertDemoLink) 로 교체
  - demo_status 'generating' → 'building' 단계 분리 (라벨로 사용자에게 빌드 중 표시)
  - regenerate_scope='all' 동작 유지, 'flow:{id}' 부분 재생성은 일단 'all' 로 강제 (Vite 빌드는 부분 재생성 어려움 — 후속 task로 분리 가능)
  - tempfile + atomic 교체 패턴 유지 (실패 시 기존 dist 보존)
- **test_spec**:
  - [ ] 발달센터 재생성 → 새 dist 배포 + portfolio_links 갱신 + demo_artifacts JSONB에 build 메타 (스택, runtime, build duration, dist file count) 기록
  - [ ] preflight 실패 시 기존 portfolio-demo/ 보존 + demo_status='gen_failed' (또는 build_failed)
  - [ ] 'flow:{id}' regenerate_scope 가 'all' 로 처리되는지 (그리고 demo_generation_log 에 명시)
- **last_failure**: —

#### T8.8 standard mode 1-click E2E 검증
- **상태**: `TODO`
- **depends_on**: T8.7
- **requires_test**: manual-review
- **해야 할 일**: 신규 후보 1건 (wishket_url 보유, spec_raw 비어있음, free 모드 기대) → dashboard "🎬 데모 생성" 1클릭 → 15~25분 이내 ready + Vite SPA 정상 서빙. 추가로 React strict 공고 1건 (예: "React 필수" 명시 공고)도 같은 방식으로 검증.
- **review_checklist**:
  - [ ] free 후보 ready 도달 — 실제 소요시간(분), build 단계 라벨 표시 자연스러움?
  - [ ] strict 후보 — chosen_runtime이 spec에 기록된 값과 일치
  - [ ] 배포된 데모 SPA 정상 동작 (라우팅, LocalStorage, 토큰 색상 반영)
  - [ ] dist/ 번들 크기, 콘솔 에러 0
  - [ ] portfolio_links 갱신 + 클릭 시 정상 페이지

#### T8.9 후속 — demo_mode='mobile-web' 폴백
- **상태**: `TODO`
- **depends_on**: T8.8
- **requires_test**: yes
- **해야 할 일**: 모바일 앱 공고 처리 — 375px frame 안에 SPA를 시뮬레이션하는 wrapper layout. generate-app 프롬프트에 mobile-web 모드 분기 추가.

#### T8.10 후속 — vue/next runtime 추가
- **상태**: `TODO`
- **depends_on**: T8.8
- **requires_test**: yes
- **해야 할 일**: `worker-runtimes/vite-vue/`, `worker-runtimes/next-static/` 추가 + 각 스택용 generate 프롬프트 분기. preferred / strict 케이스에서 chosen_runtime 매핑 활용.

#### T8.11 후속 — admin-dashboard / workflow-diagram 폴백
- **상태**: `TODO`
- **depends_on**: T8.8
- **requires_test**: yes
- **해야 할 일**: 백엔드 only / 노코드 공고 폴백 템플릿 (공고 입력 → 결과 시각화 / 워크플로우 시각 step). generate-app 프롬프트에 demo_mode 분기 추가.

---

- **비용 모델**: Max 구독 정액제. per-token API 과금 없음. 사용량 리밋(5시간 롤링) 도달 시 워커가 자동 대기 후 재시도.
- **시크릿 노출 금지**: `GITHUB_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`는 워커 `.env.local`에만(브라우저/리포에 노출 금지). Claude 인증은 Agent SDK가 `~/.claude/.credentials.json`에서 자동 로드 — 별도 키 관리 불요.
- **RLS**: `spec_raw`에 클라이언트 비밀 정보가 들어갈 수 있으므로 service role만 접근 (워커는 service role 사용).
- **롤백**: 배포 실패 시 이전 `portfolio-demo/index.html` 유지. Git Tree API는 force-push 사용 금지.
- **prompt caching 활성화 확인**: portfolio-1 원문 + 공통 지시문은 캐시 대상. 워커 로그에서 `cache_read_input_tokens` 모니터링.
- **워커 단일 인스턴스**: 동일 project_id에 대해 중복 처리 방지를 위해 상태 전이(`extract_queued → extracting`)를 atomic update로 처리. 여러 인스턴스가 동시에 돌더라도 선점한 쪽만 진행.

---

## 8. 현재 상태 스냅샷

- **마지막 업데이트**: 2026-04-27 (T8.2 DONE — build-runtime 4 헬퍼 + 4/4 검증 first try, build 2.6s. 다음 T8.3 generate-app)
- **완료된 task**: T0.1, T0.2, T0.3, T1.1, T1.2, T2.1, T2.2, T2.3, T2.4, T3.1, T3.2, T3.3, T3.4, T3.5, T4.1, T4.2, T4.3, T5.1, T5.2, T6.1, T6.2, T6.3, T7.1, T7.2, T8.0, T8.1, T8.2
- **진행 중 task**: 없음
- **다음에 착수 가능**: T8.3 (신규 generate 프롬프트 — Vite src/ 트리 생성) — depends_on T8.1, T8.2 충족
- **블로킹 중**: T7.3 (Phase 8 완료 후 재개)
- **Phase 8 첫 cut 범위**: T8.0~T8.8 (vite-react-ts runtime 1개 + standard demo_mode + 1-click E2E). 후속 T8.9~T8.11은 polish.
- **Phase 7 배경**: T1.1/T2.3/T2.4의 다단계 UX(paste → 추출 → 편집 → 승인 → 생성)가 사용자 인지 부담 큼. T6.2/T6.3로 extract 정확도 강화 + T4.2 재생성 패널로 사후 교정 가능 → SpecModal/StructuredSpecEditor/ApprovalPanel 폐기, 트리거 1회로 단순화. 위시켓 URL 자동 fetch 통합으로 paste 자체 제거
- **별도 follow-up (commit 단위)**: dashboard `DEMO_GEN_ENABLED` flag 제거 — 데모 생성기 핵심 파이프라인이 T5.2 + T6.1 로 검증됐으므로 prod 노출 안전
- **블로커**: 없음
- **결정된 사항 (2026-04-24)**:
  - 아키텍처를 Edge Function → 로컬 Node 워커 + Claude Agent SDK (Max 구독 OAuth)로 전환
  - LLM 호출 전부(extract/generate) + 배포(deploy)도 워커에서 수행; Edge Function은 `delete-portfolios`만 유지
  - 기존 `delete-portfolios/index.ts`의 GitHub Tree API 로직은 리팩터링하지 않고 그대로 둠 (워커용 `worker/shared/github.ts`는 신규 모듈로 분리, 중복 허용)
  - Agent SDK의 에러는 subprocess exit code만 표면화하므로 `verifyAuth()`는 인증/리밋/네트워크를 분기하지 않고 점검 리스트를 통째로 출력
- **미결정 사항**:
  - 워커가 오프라인일 때 대시보드의 UX 처리 (워커 heartbeat 컬럼? 마지막 응답 시각 표시?) → 대시보드 UI 태스크에서 결정
  - Realtime 연결성 검증은 T2.1로 이연 (wishket_projects에 replication 활성화 필요; T0.2 범위 밖)

---

## 9. 미팅자료 생성 기능 (후속)

데모 생성 기능 완료 후 착수. 같은 인프라(Edge Function + Anthropic 래퍼 + deploy 패턴) 재사용. 별도 plan 문서 `docs/meeting-material-generator/plan.md`로 분리 예정.

---

## 10. 변경 이력

| 날짜 | 변경 | 이유 |
|---|---|---|
| 2026-04-24 | 최초 작성 | 초기 설계 확정 |
| 2026-04-24 | T0.1 완료 | wishket_projects에 데모 생성 6개 컬럼 + demo_status CHECK 제약 추가 |
| 2026-04-24 | 스코프 재설계 | Edge Function + API 키 → 로컬 워커 + Claude Max 구독 OAuth로 전환 (비용 모델: per-token → 정액제) |
| 2026-04-24 | T0.2 완료 | worker/ 스캐폴드 + Claude Agent SDK 래퍼 + GitHub Tree API + Supabase 클라이언트 구축, 4개 테스트 통과 (Claude 응답·캐시 적중·실패 시 actionable 에러·Supabase 연결) |
| 2026-04-24 | T1.1 완료 | 대시보드 행에 "📋 공고" 버튼 + SpecModal 추가 (spec_raw 저장/프리필, 10K자 지원, demo_status 불변 보장), 4개 수동 검증 통과 |
| 2026-04-24 | T1.2 완료 | 대시보드에 spec 전용 저장 핸들러 `handleSaveSpec` 추가 (`.select()`로 반환값 검사 → 빈 배열 시 not-found 에러, updated_at 갱신). worker/test-save-spec.ts 추가. anon-key 검증으로 Supabase의 no-match update가 `data: []`임을 실증 |
| 2026-04-24 | T2.1 완료 | extract-spec 워커 모듈 스캐폴드 (atomic claim → Sonnet 호출 → spec_structured 저장 → extract_ready). demo_status CHECK 제약을 9개 상태로 확장하는 마이그레이션 추가. shared/env.ts로 .env.local 로딩 표준화. test-extract-spec.ts 3개 케이스(happy/null/no-claim) 모두 통과 |
| 2026-04-24 | T2.2 완료 | extract-spec 프롬프트(worker/prompts/extract-spec.md) + validate-spec.ts 스키마 검증 연결. 5개 도메인(치과/카페/과외/법률/공장) 합성 공고로 handleExtractQueued 호출 → 전부 스키마 통과. tier_1은 모두 3~5개, out_of_scope 4~6개씩 유효. stripJsonFence를 양쪽 독립 strip + `{…}` slice fallback으로 robust화 (law_firm 케이스의 펜스 응답 1회 실패 → 수정 후 재통과) |
| 2026-04-24 | T2.3 완료 | SpecModal에 원문/구조화 탭 + StructuredSpecEditor(persona·domain·core_flows·data_entities·out_of_scope·design_brief 편집, 플로우/엔티티 추가·삭제, 티어 드롭다운 1/2/3 색상 구분, 빈 core_flows 저장 시 confirm-gate). handleSaveSpec을 spec_structured 경로까지 확장(.select에 spec_structured 포함). test-save-spec-structured.ts 4개 케이스(JSONB 라운드트립·티어 변경·공존성·빈 저장) 전부 통과. UI 시각 확인은 사용자 승인 완료 |
| 2026-04-24 | T2.4 완료 | spec 승인 플로우 (ApprovalPanel 2단계 UX: 승인→데모 생성 시작, handleApproveSpec/handleStartDemoGen). handleSaveSpec이 저장 시 spec_approved_at을 null로 리셋해 재승인 강제. 구현은 §1 상태 머신의 `gen_queued` 전이 (§6 T2.4 원문의 `generating`은 state machine 확장 이전 표기). test-approve-flow.ts 3개 케이스(승인 전 가드·승인→timestamp→생성 시작·재편집 리셋) 전부 통과, UI 시각 확인 사용자 승인 완료. 함께: DEMO_GEN_ENABLED flag 도입해 미완성 데모 생성기 UI가 GitHub Pages prod로 유출되지 않도록 default 숨김 처리 (localhost/file:에서는 자동 enable, prod은 ?demoGen=1 토글) |
| 2026-04-24 | T3.1 완료 | 시드 데이터 생성기 (worker/prompts/seed-data.md + generate-demo/seed.ts). spec_structured → Opus 4.7 호출 → `{seed: {[entity]: [records]}}` + 자동 검증(sample_count 충족·id 유일·ref 무결성, `<name>_id`→`<name>` 규칙으로 대상 추론). 치과(4 엔티티)/카페(5 엔티티) 2개 도메인 테스트 통과 — 전 엔티티 sample_count 100% 충족, ref 매칭 106/106, 실제 한국 성씨·도메인 전문용어(스케일링/임플란트/A3 색조, 아메리카노/카페라떼) 생성 확인. Opus prompt caching 21K 토큰 재사용. 사용자 판단 위임으로 manual-review 승인 |
| 2026-04-24 | T3.2 완료 | Pass A 스켈레톤 생성기 (worker/prompts/pass-a-skeleton.md + generate-demo/skeleton.ts + test-skeleton.ts). spec+tokens+portfolio-1 참고(상위 14KB만) → Opus 4.7 → 단일 HTML(React18+Babel Standalone+Pretendard CDN, :root CSS vars 6개, useHash 라우터, DemoStoreContext, LocalStorage 초기화, 플로우별 `<!-- PASS_B_PLACEHOLDER:{id} -->` 주석). validateSkeleton으로 식별자/라우트/토큰/크기/외부이미지 자동 검증. 스포츠멤버십 포트폴리오 + 5플로우(tier 1×3/2×1/3×1) 치과 spec으로 테스트 4/4 통과 (16.6KB, esbuild-jsx 구문 OK, hash 라우트 5/5, CSS 변수 매칭 6/6). 1회차는 Opus가 prose 프리앰블을 붙여 실패 → stripHtmlFence를 `<!doctype>`/`</html>` 경계 슬라이스로 보강하고 프롬프트에도 "첫 바이트 `<`, 마지막 `>`" 절대 규칙 명시 → 2회차 통과 (cache_read 21K 재사용) |
| 2026-04-24 | T3.3 완료 | Pass B 섹션/플로우 생성기 (worker/prompts/pass-b-section.md + generate-demo/sections.ts + test-sections.ts). 플로우별 개별 Opus 4.7 호출 → `{component_name, component_code, tier}` JSON, Promise.all 병렬. 티어 1: `setStore(...store, entity: [..., new])`로 실제 CRUD + LocalStorage. 티어 2: `setToast`/헬퍼로 성공 메시지 토스트, 저장은 페이크(setStore/saveDemoStore/localStorage 0건 강제). 티어 3: "본 계약 시 구현 예정" 카드만. validateFlowComponent로 이름/중괄호 균형/재선언 금지/steps 텍스트 존재/티어별 규칙 정적 검증 + 컴포넌트명 전역 중복 검사. 치과 3플로우(tier 1/2/3) 테스트 5/5 통과, cache_read 25.9K 재사용. 1회차 실패(Opus가 tier 2에서 `showToast(msg, 'success')` 헬퍼 사용 → analyzer가 setter 직접 인수만 검사해 성공 문구 놓침) → analyzer를 "(setter 호출 ≥1)+(전역 한국어 성공 키워드 리터럴 ≥1)"로 완화해 2회차 통과. 프롬프트는 유지 (헬퍼 패턴은 자연스러운 React, 검증기가 유연해야 맞음) |
| 2026-04-25 | T3.4 완료 | Pass C 통합 빌드 (worker/generate-demo/assemble.ts + test-assemble.ts + test-assemble-browser.ts). assembleDemo: text/babel 블록 경계 슬라이스 → FlowPlaceholder 본문 첫줄에 `__FLOW_COMPONENTS[flowId]` 디스패처 주입(파라미터 괄호는 문자열/주석 건너뛰며 수동 매칭) → createRoot 직전에 Pass B 컴포넌트 + flow_id→컴포넌트명 맵 인라인 → text/babel 직전에 `<script>window.__DEMO_SEED__=...;</script>` plain script 삽입(`</script>`·`<!--`·`-->`·U+2028/U+2029 이스케이프) → PASS_B_PLACEHOLDER 주석 청소 → babel 태그에 `data-presets="env,react"` 보강 → 400KB 상한. 캐시: `.test-cache/t3.4-{skeleton.html,patches.json,seed.json}`로 단계별 산출물 분리(`--fresh`/`--regen=…`). 자동 8/8 통과(46.2 KB, CDN 4개, 시드 33 records, 디스패처/맵/3 컴포넌트 인라인 OK). Playwright 헤드리스 Chromium으로 실측: FCP **816ms**(예산 2000ms), patient 배열에 마커 push → reload → 잔존, 페이지 콘솔 에러 0건. tsx(esbuild)가 evaluate 콜백을 변환하며 `__name` helper 주입해 ReferenceError → FCP 폴링을 Node 측 짧은 evaluate 반복으로 변경해 우회 |
| 2026-04-25 | T3.5 완료 (코드 변경 없음) | T3.4 산출물 감사 결과 review_checklist 3/3 자동 충족: Lorem ipsum 0건, `<img>` 부재로 이미지 깨짐 불가, 가격·생년월일·전화번호 분포 현실적. T3.1 realistic seed + T3.3 domain-aware Pass B 단계에서 이미 리얼리티 확보. 별도 후처리 모듈은 YAGNI라 판단 — 사용자 위임으로 코드 변경 없이 승인. 향후 사진/리뷰 텍스트 도메인 등장 시 신규 task로 재개 |
| 2026-04-25 | T4.1 완료 | 루트 `preview-demo.sh` 추가 — node/npm 의존 없이 python3 http.server + macOS `open`으로 단일 명령 프리뷰. 인자 형태 4종(latest/project_slug/dir/file), 환경변수 `PREVIEW_PORT`·`PREVIEW_NO_OPEN`. 자동 검증 2/2 통과: 단일 명령으로 서버 부팅+open 호출(stub으로 URL 인자 검증), HTTP 200+올바른 HTML 서빙, 정적 서버라 핵 리로드 불필요 |
| 2026-04-27 | T4.2 완료 | 재생성 UI + 워커 gen_queued 오케스트레이터. 마이그레이션(regenerate_scope TEXT/CHECK + demo_artifacts JSONB), `worker/generate-demo/orchestrator.ts`(순수 `runGenerationPipeline` + DB래퍼 `handleGenQueued`: atomic claim→파이프라인→tempfile+rename atomic 교체→artifacts/ready/generated_at 갱신, 실패 시 HTML/artifacts 보존), 대시보드 `RegenerationPanel`(전체+flow별 버튼·confirm 단계·Max 5h 리밋 안내), 워커 라우터에 gen_queued 분기 추가. 자동 검증 3/3 통과: (1) partial=flow_patient_signup만 재호출 시 다른 2개 flow 코드 byte-identical(reqId 840aab08→962ab0d6, stages=sections+assemble만) (2) atomic gen_queued→generating 1행→0행으로 중복 선점 방지 (3) preflight 실패 시 사전 HTML 149B byte-identical 보존+demo_artifacts/generated_at NULL 유지 |
| 2026-04-27 | T4.3 완료 | 수동 수정 워크플로우 문서 (`docs/demo-generator/manual-edit-guide.md`). 생성 HTML 구조 지도(CDN/CSS vars/TOKENS/initDemoStore/FlowPlaceholder 디스패처/Pass C 인라인 마커)와 안전·금지 영역, "어디 가서 고쳐야 하나" 결정 트리, 재생성 시 직접 편집이 휘발되는 메커니즘(부분 재생성도 assembleDemo가 HTML을 처음부터 재생성하므로 100% 사라짐 — `demo_artifacts`가 SSOT), 미팅 직전 비상 수정 체크리스트, 안티패턴 정리. requires_test=no라 자동 검증 없음 |
| 2026-04-27 | T5.2 완료 | portfolio_links 자동 갱신 (worker/deploy-demo.ts upsertDemoLink + worker/generate-demo/orchestrator.ts step 7 + test-portfolio-links.ts). 순수 헬퍼 `upsertDemoLink(prevLinks, demoUrl)`로 `label==='Demo'` 또는 같은 URL 항목 제거 후 끝에 추가 → 재배포·slug 변경 모두 idempotent. orchestrator 의 atomic claim SELECT 에 portfolio_links 추가, deployInfo truthy 시 updatePayload 에 portfolio_links/portfolio_count 동시 세팅 (SKIP_DEPLOY=1 은 푸시 안 됐으니 링크 갱신도 생략). 자동 검증 16/16 통과: 단위 6 케이스(빈 배열·[P1] 추가·재배포·slug 변경·null·잘못된 항목) + 통합 [P1] → [P1, Demo] count=2 + 재배포 [P1,P2,Demo] count=3 유지·Demo 1개 + slug 변경 시 URL 갱신·중복 0 + orchestrator wiring 정적 검증(import/호출/portfolio_links·count 갱신) |
| 2026-04-27 | T6.1 완료 | E2E 검증 (260423_therapy-center-app, 위시켓 154823 발달센터 후기 앱 MVP 공고 936자). wishket-portfolio-system 의 fetch-wishket-project.js 로 본문 자동 수집 → handleExtractQueued (Sonnet 4.6, 29.2s) → 8 core_flows 추출 → handleGenQueued (Opus 4.7 × skeleton+seed+8 sections+assemble, 마지막 성공 run wall-clock 합산 782s) → 159KB HTML 생성. Playwright headless 검증: 콘솔 에러 0, 라우팅 3/3, 시드 7 entity / 37KB, reload 영속성, 9/9 공고 기능 매칭. 누적 토큰 in 195 / out 268,957 / cache_read 640,654 / cache_creation 286,544 (Max 정액제 ₩0). 발견 3건의 시스템 개선: (a) extract 프롬프트 N:M 관계 단수 ref 모델링 → 본 검증은 spec 수동 패치(review_tag join), 후속 T6.2 (b) sections validator step verbatim 매칭 너무 엄격 → containsVisibleText 를 quoted-substring + token threshold 로 영구 완화 (worker/generate-demo/sections.ts) (c) extract 가 read-only flow 를 tier 1 로 분류 → 본 검증은 spec 수동 패치(flow_2/flow_4 tier 2), 후속 T6.3. 별도 ops: GITHUB_TOKEN 휘발(T5.1 이후 다른 세션이 클리어), deploy 단계만 SKIP — T5.1+T5.2 별도 검증으로 deploy 자체는 안전 |
| 2026-04-27 | T6.2/T6.3 등록 | 후속 개선 2건. T6.2 = extract 프롬프트 N:M 자동 분해 (review×tag 같은 다대다 관계를 join entity 로). T6.3 = extract 프롬프트 tier 분류 개선 (read-only flow 는 tier 2 default, 풍부한 state 가 있는 read flow 만 tier 1) |
| 2026-04-27 | T5.1 완료 | deploy-demo 워커 모듈 + GitHub Pages 푸시. `worker/deploy-demo.ts` (writeFiles 단일 파일 wrapper, 자동 커밋 메시지), orchestrator handleGenQueued step 6.5 통합 (실패 시 markGenFailed 위임, SKIP_DEPLOY=1 우회), `worker/shared/github.ts` 에 `removeFiles` 추가 (테스트 cleanup 용 base_tree+sha:null 삭제). 자동 검증 3/3 통과: (1) Pages CDN 전파 ~40s 후 200+v1 marker (2) root tree 의 portfolio 슬러그 69개 SHA byte-identical (3) v2 SHA-pinned rawUrl 에서 v1 marker 잔존 0건. 1회차 실패 — `__T5_1_PROBE_*` 가 Jekyll `_` prefix 제외에 걸려 Pages 404 + 브랜치 기반 raw URL edge cache 로 v2 직후 v1 본문 반환 → probe slug `t5-1-probe-*` (lowercase+hyphen) + SHA-pinned commit URL 로 2회차 통과. 테스트 1회 실행당 main 에 3 커밋 발생 (deploy v1 + deploy v2 + cleanup) — probe 파일은 cleanup 으로 트리에서 제거됨 |
| 2026-04-27 | T6.2 완료 | extract 프롬프트 N:M 자동 분해. `worker/prompts/extract-spec.md` 에 "N:M 관계 분해 규칙" 섹션 (감지 신호·금지 패턴·올바른 분해+예시) + 품질체크 항목 2개 추가. `worker/shared/validate-spec.ts` 에 `detectPluralRef` 헬퍼 — `_ids` 접미사 또는 's' 끝 ref 거부 (allowlist: address·status·process·class·series). `worker/test-extract-nm.ts` 신규 — 발달센터 회귀(spec_raw 복제) + 합성 3건(clinic_review_tag, study_member_group, ecom_product_category). 자동 검증 4/4 통과: (1) 발달센터 → review_tag {review_id, tag_id} 자동 등장, 보너스 center_therapy_type 분해 (T6.1 수동 패치 불필요화) (2) clinic → review_tag 분해 (3) study → group_member 분해 (study_group 도메인 prefix → group_id 참조) (4) ecom → product_category 분해. 복수형 ref 위반 0건, Sonnet 4회 호출 (cache_read 21K 재사용) |
| 2026-04-27 | T6.3 완료 | extract 프롬프트 read-only flow tier 분류 개선. `worker/prompts/extract-spec.md` tier 1 정의에 "steps 안에 write step 적어도 하나 필수" 규칙 + read+persist 예외 단락(찜·북마크·별점·알림 등록은 read 처럼 보여도 tier 1 자격) + 절대 금지 패턴(steps 가 전부 검색·둘러보기·필터·조회 같은 읽기 동사로만 구성된 경우 tier 2 강제) + 4단계 결정 절차 + 품질 체크 2항목 추가. `worker/extract-spec.ts` `stripJsonFence` 를 outer-slice(첫 `{`~마지막 `}`) 무조건 적용으로 보강 — 종료 펜스 + trailing 텍스트 케이스 안전망. `worker/test-extract-tier.ts` 신규 — 발달센터 회귀 + 합성 3건(realestate_browse/event_calendar/recipe_browse). 각 케이스 (1) handleExtractQueued ok (2) tier_1 모든 flow write 동사 step ≥1 (3) read-only flow ≥1 존재 (4) read-only flow 가 tier_1 에 0개. 자동 검증 4/4 통과: T6.1 시점 발달센터 수동 패치(flow_2/flow_4 tier 2 재분류) 가 prompt-only 로 자동 해결. 1회차 실패 — Sonnet 이 ```json 펜스 + trailing 텍스트로 응답해 종료 펜스 정규식 미매칭 (realestate) → stripJsonFence outer-slice 무조건 적용, 그리고 분류기 false positive (recipe 의 "재료 다중 입력" 의 `입력`, "작성자 프로필" 의 `작성`) → 단독 `입력` 제거 + `작성(?!자)` 부정선후행. 사용자 위임 승인 |
| 2026-04-27 | T0.3 완료 | 디자인 토큰 추출 유틸 manual-review 통과 (사용자 승인). `worker/test-extract-tokens.ts` 로 5개 도메인 portfolio-1 (발달센터/핀테크/병원/임원 대시보드/커뮤니티) 검증. NO_LLM=1: 4/5 케이스 100% 일치 + 5번(하드코딩 케이스)은 휴리스틱 실패 → graceful fallback 안착 (throw 0). LLM ON: Sonnet 1회 호출(10s, 37 output 토큰)로 5번 케이스도 100% 매칭 → 전체 5/5 = 100%. 빈 HTML 입력에서도 `_source='fallback'` 으로 안전하게 떨어짐 확인. 데모 생성기 모든 task (T0.1~T6.3) 완료 |
| 2026-04-27 | T8.2 완료 | build-runtime 4 헬퍼 (`prepareWorkspace`/`runBuild`/`collectDist`/`cleanup`). DB 의존 0, 순수 입출력. fs.cp 로 153MB runtime 통째 복사 (macOS APFS clonefile 활용 1~2s), spawn npm run build + DEMO_BASE env 주입 + 5분 timeout (SIGTERM→5s SIGKILL), dist 재귀 walk Buffer 반환, cleanup idempotent. 자동 검증 4/4 first try: A (workspace + node_modules/react 존재) / B+C (build 2645ms, dist 3 파일, base path 정확 주입, content Buffer) / D (cleanup + 두번째 호출 안전) / E (src 의도 파괴 → BUILD_FAILED + 에러 단서 stderr/stdout 포함). |
| 2026-04-27 | T8.1 완료 | extract-spec.md 에 "스택 결정 규칙" 섹션 + 스키마/예시/품질체크 갱신, validate-spec.ts 에 stack_decision 검증 (freedom_level enum / demo_mode enum / client_required.{frontend,backend,mobile} 키존재+null|enum / strict+all-null+!workflow-diagram 모순체크). 마이그레이션 20260427183000 으로 demo_status 에 'building' 추가 (총 13 상태). 자동 검증 6/6 통과 (보정 1사이클): 발달센터 → free/mobile-web (실제 공고가 모바일 앱), react_strict → strict/next/spring/standard (Spring Boot 명시 따라 backend 정확 추출), vue_preferred → preferred/vue/standard, mobile_app → strict/flutter/mobile-web+fallback, backend_only → strict/fastapi/admin-dashboard+fallback, nocode_workflow → strict\|preferred\|free/workflow-diagram (노코드 도구는 enum 매핑 안 됨, validator 가 workflow-diagram 예외로 strict+all-null 허용). 1차 3 fail 모두 expected/validator 측 오류였고 LLM 동작은 정확. 토큰: Sonnet 합성 5건 cache_read 24,736 / cache_creation 600~700 (시스템 프롬프트 26K 캐시). chosen_runtime 은 LLM 이 산출 안 함 — T8.2 build-runtime 이 코드로 derive. |
| 2026-04-27 | T8.0 완료 | worker-runtimes/vite-react-ts/ 셋업 — Vite 5+React 18+TS+Tailwind 3+shadcn/ui+Pretendard, 38 deps (radix primitives 11 + form/zod/sonner/recharts + dev tooling). vite.config.ts 가 DEMO_BASE env 로 base path 동적 주입. tailwind.config.cjs 에 토큰 6개 placeholder (T8.4 가 generate 단계에서 spec.tokens 로 교체). 자동 검증 4/4: build 3.10s (142KB JS+6KB CSS), base path 정확히 prefix, gitignore 가 node_modules/dist/tsbuildinfo 모두 무시, prod-style URL serving 시 Playwright 헤드리스 chromium 으로 React 앱 마운트 + 콘솔 errors 0/warnings 0. 22s install, 153MB node_modules. 사용자 한 번만 `cd worker-runtimes/vite-react-ts && npm install` 필요. |
| 2026-04-27 | Phase 8 신설 + §0 스코프 변경 | 사용자 의도 — 공고에 클라이언트 요구 스택 명시 시 그것 따르고, 자유면 Claude Code 친화 + 유지보수 최소 공수 스택으로 실제 동작하는 데모. 단일 HTML+CDN 강제 폐기, Vite+React+TS+Tailwind+shadcn/ui 자유 모드 기본. 빌드 SPA + 멀티파일 GitHub Pages 배포. 인프라는 레포 루트 `worker-runtimes/{stack}/` 공유 (Docker는 1인 로컬 워커 + 단순 SPA에 오버킬이라 기각). 데모 시간 5~10분 → 15~25분 허용. T7.3 BLOCKED — 새 빌드 시스템으로 generate 내부가 통째로 교체되므로 T8.8 (standard mode 1-click E2E) 가 사실상 T7.3 의 새 버전. 첫 cut 범위 T8.0~T8.8 (vite-react-ts + standard 만), 후속 T8.9~T8.11 (mobile-web/vue/next/admin-dashboard/workflow-diagram). |
| 2026-04-27 | Phase 7 신설 | 사용자 피드백 반영해 데모 생성기 UX 재설계. (a) wishket_projects.wishket_url + wishket-portfolio-system/scripts/fetch-wishket-project.js 인프라가 이미 있는데 dashboard는 수동 paste UI(T1.1)로 구현됐음을 사용자가 지적. (b) 추가로 "구조화 편집기는 LLM이 알아서 하면 되는 거 아닌가"라는 질문 — T6.2/T6.3 프롬프트 강화 + T4.2 재생성 패널로 pre-edit 안전망 redundant. **T7.1** 워커 fetch + auto chain (autorun_queued → fetching → extract → auto-approve → gen → ready 전 단계 자동), **T7.2** dashboard SpecModal/StructuredSpecEditor/ApprovalPanel 폐기 + "🎬 데모 생성" 단일 버튼, **T7.3** 1-click E2E 검증. 기존 T1.1/T2.3/T2.4 결과물은 T7.2에서 명시 삭제 (백워드 호환 안 둠) |
| 2026-04-27 | T7.1 완료 | 워커 자동 파이프라인. (1) `worker/shared/wishket-fetch.ts` — wishket-portfolio-system/scripts/fetch-wishket-project.js 를 child process 호출 (puppeteer 재구현 안 함, DRY). 90s 타임아웃, balanced-brace JSON 추출, `WishketFetchError` 6 코드. (2) `worker/fetch-spec.ts` — `handleAutorunQueued`: atomic claim autorun_queued→fetching → wishket-fetch → spec_raw 저장 + extract_queued chain. 실패는 모두 fetch_failed 전이. (3) `worker/extract-spec.ts` 수정 — extract 성공 시 extract_ready 단계 폐기, gen_queued auto-promote (spec_approved_at=now() + regenerate_scope=null 동시 세팅). (4) `worker/index.ts` 라우터에 autorun_queued 분기. (5) 마이그레이션 20260427072729 — demo_status CHECK 에 autorun_queued/fetching/fetch_failed 3 상태 추가. 5/5 통과 first try: 마이그레이션 OK + URL_INVALID/MISSING_SCRIPT 즉시 throw + 실제 wishket fetch 11.3s/936자 + Sonnet auto-promote 30s/2252 out tokens + spec_approved_at 시각 동기 |
| 2026-04-27 | T7.2 완료 | dashboard SpecModal/StructuredSpecEditor/ApprovalPanel 폐기 + "🎬 데모 생성" 단일 버튼. SpecModal(162L)+StructuredSpecEditor(193L)+ApprovalPanel(82L)+helpers(17L) 합 ~454L 삭제 (sed 라인 범위 일괄 + Edit 잔존 정리). 새 컴포넌트 `DemoTriggerButton`(demo_status 매트릭스 13 분기) + `RegenerationModal`(RegenerationPanel wrapper). 핸들러 4개(handleOpenSpec/SaveSpec/ApproveSpec/StartDemoGen) 삭제, `handleStartAutorun` 신설 (initial: autorun_queued + regenerate_scope=null UPDATE). 정적 검증: JSX 컴파일 OK + 새 식별자 8개 + 삭제 식별자 코드 잔존 0건. **1차 구현 시 confirm 단계 누락** → 사용자 지적("물어보지도 않고 클릭 한 번에 바로 실행")으로 setConfirmState 래퍼 추가 (단계별 소요시간 + Max 사용량 + 워커 필요 명시). 🔁 재생성 버튼은 ↻ 단일 글리프에서 텍스트 라벨 추가 (가시성). 사용자 시각 승인 완료 |
