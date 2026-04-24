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

- **"실제 동작" 수준**: LocalStorage + 사전 시딩된 샘플 데이터 + 스크립트된 mock (0.8~1.5초 가짜 지연 + 미리 쓴 응답). Supabase 연결 데모 금지.
- **포트폴리오와의 관계**: 기존 `portfolio-1/` 유지, 별도 `portfolio-demo/`로 분리 생성. portfolio-1은 소개용·portfolio-demo는 조작용.
- **구현 스코프**: 공고 내 **모든 업무요소**를 데모에 포함시키되 3티어로 분류.
  - **티어 1 (3~5개)**: 진짜 CRUD·상태 저장·시나리오 완주. 핵심 플로우.
  - **티어 2 (나머지 대부분)**: 화면·컴포넌트·더미데이터까지 구현, 인터랙션은 제한적 (저장 → 성공 토스트만).
  - **티어 3 (구현 보류)**: 데모 홈 체크리스트에 "본 계약 시 구현" 표기만.
- **타협 트리거**: 공고당 사람 보정 공수가 4시간 초과 예상 시 티어 1 플로우를 3개로 강제 축소.
- **UI/UX 기반**: 생성하는 데모는 해당 프로젝트의 `portfolio-1/index.html`에서 추출한 디자인 토큰(컬러·폰트·스페이싱·컴포넌트 스타일)을 승계.
- **실행 환경**: LLM 호출은 **사용자 PC의 로컬 Node 워커**에서 수행. `@anthropic-ai/claude-agent-sdk` + Claude Code Max 구독 OAuth 인증 사용 (`claude login` 필수). Supabase Edge Function은 기존 `delete-portfolios`만 유지; 신규 기능(extract/generate/deploy)은 모두 워커 모듈로 구현.
- **비용 모델**: Claude API per-token 과금 **금지**. Max 구독 정액제로 커버. 사용량 리밋(5시간 롤링) 초과 시 자연 대기 후 재시도.
- **운영 제약**: 데모 생성은 워커 실행 중일 때만 가능. 대시보드는 워커 오프라인 상태를 노출해야 하고, `demo_status`는 큐 상태(`queued`)와 처리 상태(`generating`)를 구분해 표시.

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
- **상태**: `NEEDS_TEST`
- **depends_on**: (없음)
- **requires_test**: manual-review
- **파일**: `worker/shared/extract-tokens.ts`
- **해야 할 일**: portfolio-1 HTML을 받아 `{ primary, secondary, surface, text, radius, fontFamily, spacingScale }` 를 추출하는 함수. 1차는 정규식 + tailwind 클래스 휴리스틱으로 시도, 실패 시 Sonnet에 위임(fallback).
- **review_checklist**:
  - [ ] 기존 4~5개 프로젝트 portfolio-1에 적용 시 컬러값이 실제 사용색과 ≥ 80% 일치
  - [ ] 추출 실패 시 기본 토큰 세트(중립 팔레트)로 graceful fallback

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
- **상태**: `TODO`
- **depends_on**: T2.2, T1.2
- **requires_test**: yes
- **파일**: `dashboard/index.html`
- **해야 할 일**: 추출 결과를 form으로 렌더. 플로우 추가/삭제/티어 변경 가능. 저장 시 `spec_structured` 업데이트.
- **test_spec**:
  - [ ] 추출→편집→저장→새로고침 시 편집 내용 유지
  - [ ] 티어 드래그앤드롭 or 드롭다운 동작
  - [ ] 빈 core_flows 저장 시 경고

#### T2.4 승인 플로우
- **상태**: `TODO`
- **depends_on**: T2.3
- **requires_test**: yes
- **파일**: 대시보드 + DB
- **해야 할 일**: "데모 생성 시작" 버튼은 `spec_approved_at` 세팅 후에만 활성. 승인 시 `demo_status = generating`으로 자동 전이.
- **test_spec**:
  - [ ] 승인 전 "데모 생성" 버튼 비활성
  - [ ] 승인 후 활성 + timestamp 기록
  - [ ] spec 재편집 시 `spec_approved_at` 초기화 (재승인 강제)

---

### Phase 3 — Demo Generation (3-pass)

#### T3.1 티어 분류 & 샘플 데이터 시드 생성
- **상태**: `TODO`
- **depends_on**: T2.4
- **requires_test**: manual-review
- **파일**: `worker/prompts/seed-data.md`, `worker/generate-demo/seed.ts`
- **해야 할 일**: `data_entities`마다 `sample_count`개의 리얼한 한국어 샘플 생성. 이름·전화·주소 등 실제감 있게. (이게 "진짜 같음"의 핵심)
- **review_checklist**:
  - [ ] 이름이 "홍길동1" 같지 않고 자연스러움
  - [ ] 도메인에 맞는 데이터 (병원이면 진료과, 카페면 메뉴명)
  - [ ] 관계형 정합성 (예약의 therapist_id가 실제 therapist 목록에 존재)

#### T3.2 Pass A — 스켈레톤 생성
- **상태**: `TODO`
- **depends_on**: T3.1, T0.3
- **requires_test**: yes
- **파일**: `worker/generate-demo/skeleton.ts` + `worker/prompts/pass-a-skeleton.md`
- **해야 할 일**: `spec_structured` + 디자인 토큰 + portfolio-1 HTML → 단일 HTML의 **뼈대**(Shell, 사이드바/탑바, 라우팅 스위치, 전역 상태 컨텍스트, LocalStorage 초기화 스크립트)만 생성. 각 플로우 자리는 placeholder 주석.
- **test_spec**:
  - [ ] 생성된 HTML을 브라우저에서 열었을 때 콘솔 에러 0
  - [ ] 각 core_flow별 라우트가 URL hash로 접근 가능
  - [ ] 디자인 토큰이 실제 CSS 변수로 반영됨
  - [ ] 파일 크기 < 50KB (placeholder 단계이므로)

#### T3.3 Pass B — 섹션/플로우 생성
- **상태**: `TODO`
- **depends_on**: T3.2
- **requires_test**: yes
- **파일**: `worker/generate-demo/sections.ts` + `worker/prompts/pass-b-section.md`
- **해야 할 일**: 플로우별로 **개별 호출** (병렬 가능). 티어 1은 full interactive + LocalStorage 쓰기, 티어 2는 UI+mock toast, 티어 3은 "준비 중" placeholder 카드. Pass A의 placeholder 자리를 교체하는 patch 포맷으로 반환.
- **test_spec**:
  - [ ] 티어 1 플로우에서 CRUD 왕복 시 LocalStorage 값 변경 확인
  - [ ] 티어 2 플로우의 "저장" 버튼이 성공 토스트 띄움 (실제 저장은 안 함)
  - [ ] 티어 3 카드가 "본 계약 시 구현 예정" 문구 포함
  - [ ] 각 플로우가 spec의 `steps`를 UI로 수행 가능

#### T3.4 Pass C — 통합 & 단일 HTML 빌드
- **상태**: `TODO`
- **depends_on**: T3.3
- **requires_test**: yes
- **파일**: `worker/generate-demo/assemble.ts`
- **해야 할 일**: Pass A 스켈레톤 + Pass B patches → 단일 HTML. 시드 데이터 LocalStorage 초기화 스크립트 inline. 공고 전체 업무요소 체크리스트 섹션을 홈 화면에 렌더(티어 표시 포함). 렌더링 최적화(Babel presets-env preset만 로드).
- **test_spec**:
  - [ ] 최종 HTML 단일 파일로 동작 (외부 파일 의존 0, CDN만 허용)
  - [ ] 파일 크기 < 400KB
  - [ ] 첫 페인트 < 2초 (로컬 기준)
  - [ ] 홈 화면 체크리스트에 공고의 모든 업무요소가 티어와 함께 표시
  - [ ] 브라우저 새로고침 후 LocalStorage 데이터 유지

#### T3.5 샘플 데이터 리얼리티 보강 패스 (선택적)
- **상태**: `TODO`
- **depends_on**: T3.4
- **requires_test**: manual-review
- **해야 할 일**: 생성된 HTML의 더미 텍스트/이미지를 domain-appropriate하게 교체. 리뷰 텍스트, 프로필 썸네일(unsplash URL 등), 뉴스 헤드라인 등.
- **review_checklist**:
  - [ ] "Lorem ipsum" 0건
  - [ ] 이미지 깨짐 0건
  - [ ] 숫자가 현실적 (재고 9999 말고 23 같은)

---

### Phase 4 — Preview & Iteration

#### T4.1 로컬 프리뷰 명령
- **상태**: `TODO`
- **depends_on**: T3.4
- **requires_test**: yes
- **파일**: `package.json`에 스크립트 추가 or 루트에 `preview-demo.sh`
- **해야 할 일**: 생성된 파일을 로컬에서 바로 띄우는 단일 명령. `npx serve {project_slug}/portfolio-demo` 수준이면 충분.
- **test_spec**:
  - [ ] 명령 1개로 브라우저 자동 오픈
  - [ ] 핫 리로드 불필요 (정적이라)

#### T4.2 재생성 UI (전체/부분)
- **상태**: `TODO`
- **depends_on**: T4.1
- **requires_test**: yes
- **파일**: 대시보드 + 워커 라우터에 `regenerate_scope={pass|flow_id}` 컬럼/필드
- **해야 할 일**: 대시보드에서 "전체 재생성" / "특정 플로우만 재생성" 버튼 → DB에 `regenerate_scope` 쓰고 `demo_status='gen_queued'` 세팅. 워커가 scope에 따라 3-pass 전체 또는 Pass B 특정 플로우만 재실행. 사용량 리밋 도달 가능성 UI에 명시.
- **test_spec**:
  - [ ] 특정 플로우만 재생성 시 다른 플로우 코드는 불변
  - [ ] 재생성 중 `demo_status = generating` 반영
  - [ ] 실패 시 이전 HTML 유지 (덮어쓰지 않음)

#### T4.3 수동 수정 워크플로우 문서 (병행 가능)
- **상태**: `TODO`
- **depends_on**: (없음, T3.4 이후 아무 때나)
- **requires_test**: no
- **파일**: `docs/demo-generator/manual-edit-guide.md`
- **해야 할 일**: 생성 결과를 직접 수정할 때의 규칙 — 어떤 섹션은 건드려도 되고 어떤 섹션은 regenerate가 덮어쓰니 피해야 하는지.

---

### Phase 5 — Deploy

#### T5.1 deploy-demo 워커 모듈
- **상태**: `TODO`
- **depends_on**: T4.2
- **requires_test**: yes
- **파일**: `worker/deploy-demo.ts` (`worker/shared/github.ts`의 `writeFiles` 사용)
- **해야 할 일**: Pass C 통합 직후 같은 워커 프로세스 안에서 호출. `{project_slug}/portfolio-demo/index.html` 단일 커밋. 커밋 메시지 자동 생성.
- **test_spec**:
  - [ ] 푸시 후 GitHub Pages URL에서 200 응답 (전파 시간 감안 60초 대기)
  - [ ] 기존 portfolio-1/2/3 건들지 않음
  - [ ] 재배포 시 같은 경로 덮어쓰기 동작

#### T5.2 portfolio_links 자동 갱신
- **상태**: `TODO`
- **depends_on**: T5.1
- **requires_test**: yes
- **파일**: `worker/deploy-demo.ts` 내 DB 업데이트 블록
- **해야 할 일**: 배포 성공 시 `portfolio_links`에 `{url, label: "Demo"}` append (중복 방지), `portfolio_count` 증가, `demo_status = ready`, `demo_generated_at = now()`.
- **test_spec**:
  - [ ] 최초 배포 후 대시보드 "Demo" 링크 노출
  - [ ] 재배포 시 링크 중복 생성 없음

---

### Phase 6 — End-to-End

#### T6.1 기존 프로젝트 1건으로 E2E
- **상태**: `TODO`
- **depends_on**: T5.2
- **requires_test**: manual-review
- **해야 할 일**: `260423_therapy-center-app` 같은 실제 프로젝트로 전 과정 실행. 공고 붙여넣기 → 추출 승인 → 생성 → 프리뷰 → 배포 → 접속.
- **review_checklist**:
  - [ ] 공고의 모든 업무요소가 체크리스트에 있음
  - [ ] 티어 1 플로우 3~5개가 실제로 동작
  - [ ] 전체 소요 시간 (사람 보정 포함) 측정·기록
  - [ ] 생성 토큰 비용 기록
  - [ ] 사용자 최종 승인

---

## 7. 비기능 요건 & 가드레일

- **비용 모델**: Max 구독 정액제. per-token API 과금 없음. 사용량 리밋(5시간 롤링) 도달 시 워커가 자동 대기 후 재시도.
- **시크릿 노출 금지**: `GITHUB_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`는 워커 `.env.local`에만(브라우저/리포에 노출 금지). Claude 인증은 Agent SDK가 `~/.claude/.credentials.json`에서 자동 로드 — 별도 키 관리 불요.
- **RLS**: `spec_raw`에 클라이언트 비밀 정보가 들어갈 수 있으므로 service role만 접근 (워커는 service role 사용).
- **롤백**: 배포 실패 시 이전 `portfolio-demo/index.html` 유지. Git Tree API는 force-push 사용 금지.
- **prompt caching 활성화 확인**: portfolio-1 원문 + 공통 지시문은 캐시 대상. 워커 로그에서 `cache_read_input_tokens` 모니터링.
- **워커 단일 인스턴스**: 동일 project_id에 대해 중복 처리 방지를 위해 상태 전이(`extract_queued → extracting`)를 atomic update로 처리. 여러 인스턴스가 동시에 돌더라도 선점한 쪽만 진행.

---

## 8. 현재 상태 스냅샷

- **마지막 업데이트**: 2026-04-24
- **완료된 task**: T0.1, T0.2, T1.1, T1.2, T2.1, T2.2
- **진행 중 task**: T0.3 (manual-review 대기)
- **다음에 착수 가능**: T2.3 (T2.2, T1.2 모두 DONE), T4.3 (문서, 선행 의존성 없음)
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
