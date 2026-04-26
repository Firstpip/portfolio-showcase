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

- **마지막 업데이트**: 2026-04-27 (T4.3 DONE — 수동 수정 워크플로우 문서)
- **완료된 task**: T0.1, T0.2, T1.1, T1.2, T2.1, T2.2, T2.3, T2.4, T3.1, T3.2, T3.3, T3.4, T3.5, T4.1, T4.2, T4.3
- **진행 중 task**: T0.3 (manual-review 대기)
- **다음에 착수 가능**: T5.1 (T4.2 DONE, deploy-demo 워커 모듈)
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
