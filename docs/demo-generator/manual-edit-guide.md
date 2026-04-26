# 데모 수동 수정 가이드

> 생성된 `{slug}/portfolio-demo/index.html` 을 직접 손보고 싶을 때 어떤 영역을 만져도 되고, 어떤 영역은 다음 재생성에서 덮어쓰여 사라지는지 정리한 문서. 미팅 직전 5분짜리 카피 수정·색상 미세조정에 한해서만 권장. 본질적 수정은 항상 SSOT(spec / 프롬프트 / 워커 코드)에서 하고 재생성한다.

## TL;DR

| 만지고 싶은 것 | 어디서 고치나 | 만지면 안 되는 것 |
|---|---|---|
| 데모의 카피 한 줄, 가격 숫자, 토스트 문구 | 직접 HTML — Pass B 컴포넌트 함수 본문의 JSX 텍스트만 | `function Flow*` 함수의 **이름**·시그니처·`window.__FLOW_COMPONENTS` 맵 |
| 색·폰트·라운드 살짝 | `<style>:root { --primary: ... }` 의 변수값만 | `TOKENS` JS 객체와 mismatch 나는 값 (정합성 깨짐) |
| 시드 데이터 한두 건 | 직접 HTML — `window.__DEMO_SEED__ = {...}` 객체 안 값 | 엔티티 키 추가/삭제·`<entity>_id` 참조 무결성 |
| 플로우 추가/삭제, 티어 변경 | **대시보드 spec 편집기 → 재생성** (직접 HTML 수정 금지) | 라우팅 switch / `FlowPlaceholder` 디스패처 |
| 새 컴포넌트·새 화면 | 프롬프트(`worker/prompts/pass-b-section.md`) 또는 워커 코드 | 직접 HTML 추가 (재생성 시 사라짐) |

**규칙 1**: 다음 재생성을 한 번이라도 돌릴 거면, HTML 직접 편집은 일회성 비상수단이다. 재생성은 파일 전체를 통째로 갈아끼운다 (`renameSync` atomic 교체, `worker/generate-demo/orchestrator.ts`).

**규칙 2**: "전체 재생성"과 "특정 플로우만 재생성" 둘 다 결국 `assembleDemo` 를 다시 돌려 HTML을 새로 쓴다. 부분 재생성도 이 파일은 통째로 새 파일이다 — 다른 플로우 컴포넌트의 *코드*는 캐시(`demo_artifacts.patches`)에서 byte-identical 로 가져오지만, 그 코드를 박은 *HTML* 자체는 새로 만들어진다.

---

## 1. 생성된 HTML의 구조 지도

`{slug}/portfolio-demo/index.html` 한 파일 안에 다음이 들어있다 (위→아래 순서):

```
<!doctype html>
<html>
<head>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/.../pretendard...">     # CDN
  <script src="https://unpkg.com/react@18/...">                                  # CDN
  <script src="https://unpkg.com/react-dom@18/...">                              # CDN
  <script src="https://unpkg.com/@babel/standalone/...">                         # CDN
  <style>
    :root {
      --primary: #...;                  # ← 디자인 토큰 (스킨)
      --secondary: #...;
      --surface: #...;
      --text: #...;
      --radius: ...px;
      --font-family: ...;
    }
    /* (스켈레톤 기본 스타일들) */
  </style>
</head>
<body>
  <div id="root"></div>

  <!-- ⬇ Pass C 가 babel 블록 직전에 삽입한 시드 주입 스크립트 -->
  <script>window.__DEMO_SEED__ = { /* 모든 엔티티의 sample 레코드 */ };</script>

  <script type="text/babel" data-presets="env,react">
    const TOKENS = { /* :root 값과 동일한 JS 미러 */ };
    const STORAGE_KEY = 'demo_<domain>';

    function initDemoStore() { /* localStorage 비어있으면 __DEMO_SEED__ 로 시드 */ }
    function saveDemoStore(s) { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }
    const DemoStoreContext = React.createContext(null);

    function useHash() { /* hashchange 라우터 */ }

    function FlowPlaceholder({ flowId }) {
      // ⬇ Pass C 가 본문 첫줄에 디스패처 주입
      if (window.__FLOW_COMPONENTS && window.__FLOW_COMPONENTS[flowId]) {
        return React.createElement(window.__FLOW_COMPONENTS[flowId]);
      }
      // (원본 placeholder 카드 fall-through)
    }

    function App() { /* 사이드바 + 라우팅 switch (case 'flow_xxx': ...) */ }

    // ---- Pass C: injected flow components (T3.4) ----
    function FlowMemberSignup() { /* Pass B 가 만든 티어 1/2/3 컴포넌트 */ }
    function FlowAppointment() { /* ... */ }
    function FlowInsuranceClaim() { /* ... */ }

    window.__FLOW_COMPONENTS = {
      "flow_member_signup": FlowMemberSignup,
      "flow_appointment": FlowAppointment,
      "flow_insurance_claim": FlowInsuranceClaim,
    };
    // ---- end Pass C injection ----

    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  </script>
</body>
</html>
```

이 구조의 출처:
- **CDN·`<style>:root`·`TOKENS`·`initDemoStore`·`useHash`·`FlowPlaceholder`·`App`·`createRoot`**: Pass A 스켈레톤 (`worker/generate-demo/skeleton.ts` + `worker/prompts/pass-a-skeleton.md`)
- **`function FlowXxx() {...}` 본문들**: Pass B 섹션 (`worker/generate-demo/sections.ts` + `worker/prompts/pass-b-section.md`) — 플로우당 1회 LLM 호출
- **`window.__DEMO_SEED__` 객체**: 시드 (`worker/generate-demo/seed.ts` + `worker/prompts/seed-data.md`)
- **`window.__FLOW_COMPONENTS` 맵, `FlowPlaceholder` 디스패처, 시드 주입 스크립트 위치**: Pass C assemble (`worker/generate-demo/assemble.ts`)

---

## 2. 직접 편집해도 안전한 영역 (재생성에서도 자연 보존되는 영역은 없음)

> 모든 직접 편집은 다음 재생성에서 사라진다는 전제하에 읽을 것. "안전" = "지금 당장 깨지지 않음"이지 "재생성에 살아남는다"가 아니다.

### 2.1 Pass B 컴포넌트 본문의 JSX 텍스트
- `function FlowMemberSignup() { ... }` 안의 `<button>가입하기</button>` → `<button>회원 등록</button>` 같은 **카피 변경**은 안전.
- `<div>{'아메리카노'}</div>` 같은 문자열 리터럴 직접 교체도 안전.
- 단, 컴포넌트 **이름**(`FlowMemberSignup`)과 함수 시그니처(`function Name() {`)는 절대 건들지 말 것 — `window.__FLOW_COMPONENTS` 맵의 값과 묶여 있다.

### 2.2 `:root` CSS 변수값
- `--primary: #2b6cb0` → `--primary: #1a4480` 같은 **색상 미세조정**은 즉시 반영되고 안전.
- 다만 `TOKENS` JS 객체에도 같은 값이 미러돼 있다. JS 쪽에서 `TOKENS.primary` 를 직접 읽어 인라인 스타일로 적용하는 컴포넌트가 있다면 mismatch 가 생긴다. **둘 다 같이 바꾸는 게 안전**.
- `--font-family` 변경 시 Pretendard CDN 외 폰트는 별도 `<link>` 추가 필요.

### 2.3 `window.__DEMO_SEED__` 객체 안의 개별 필드값
- `{ name: '김민서', phone: '010-1234-5678' }` 의 phone 만 바꾸기 → 안전.
- `<entity>_id` 형식은 유지할 것. 다른 엔티티가 `appointment_id: 'ent_appointment_003'` 로 참조 중일 수 있다.
- **엔티티 키를 추가/삭제하면 깨진다** — `initDemoStore` 가 시드 키 그대로 store 에 박고, Pass B 컴포넌트들이 `store.<key>` 형태로 읽는다.

### 2.4 `<style>` 블록의 클래스 추가
- 새 CSS 클래스를 `<style>` 안에 추가하고 JSX `className=` 에서 참조하는 것은 안전 (충돌만 안 나면).
- 기존 클래스 시그니처 변경은 위험 — 어떤 컴포넌트가 의존 중인지 grep 후에.

---

## 3. 절대 직접 편집하면 안 되는 영역

### 3.1 라우팅 / 디스패처 / 마운트
- `case 'flow_xxx':` 라우팅 switch 의 case 값 (Pass A 가 spec.core_flows.id 와 동기화).
- `FlowPlaceholder` 함수의 디스패처 가드 (`window.__FLOW_COMPONENTS && ...`).
- `ReactDOM.createRoot(document.getElementById('root'))` 라인.
- `// ---- Pass C: injected flow components (T3.4) ----` ~ `// ---- end Pass C injection ----` 마커 라인.

이걸 건들면 부분 재생성 시 `assembleDemo` 가 식별자(`FlowPlaceholder`·`createRoot`·마커)를 못 찾고 실패한다 (`worker/generate-demo/assemble.ts:72-82` 의 계약 검증).

### 3.2 `function FlowXxx()` 의 함수 이름
- `window.__FLOW_COMPONENTS` 맵의 우항이 이 이름과 **문자열 일치**해야 한다. 이름을 바꾸면 매핑이 깨지고 placeholder 카드로 fall-through 된다.

### 3.3 `STORAGE_KEY` 값
- `'demo_<domain>'` 형식. 바꾸면 기존 LocalStorage 데이터가 분리돼서 빈 데모처럼 보인다 (사용자 손 데이터를 쓰는 시나리오라면 더 위험).

### 3.4 시드 객체의 키 이름·관계 무결성
- `patient` 키를 `patients` 로 바꾸면 모든 Pass B 컴포넌트의 `store.patient` 참조가 undefined.
- `appointment.patient_id` 가 가리키는 `patient_id` 가 시드에 없으면 화면에 빈 칸/NaN.

---

## 4. "이거 고치고 싶은데 어디 가야 해?" — 결정 트리

```
무엇을 고치고 싶은가?

├─ 카피 한 줄, 가격 숫자, 토스트 메시지
│   ├─ 한 번만 보여주고 끝 (오늘 미팅용) → 직접 HTML 편집 OK
│   └─ 영구 반영 → spec_structured 의 해당 entity sample 또는 프롬프트(`pass-b-section.md`) 손보고 재생성
│
├─ 디자인 토큰 (색·폰트·라운드)
│   ├─ 일회성 → :root 변수 직접 편집
│   └─ 영구 → portfolio-1/index.html 의 실제 사용색 자체를 고치고 전체 재생성
│       (extract-tokens 가 portfolio-1 에서 추출하므로)
│
├─ 시드 데이터 (이름·가격·재고)
│   ├─ 한두 건 즉시 수정 → __DEMO_SEED__ 직접 편집
│   └─ 분포·도메인 톤 자체 → seed.ts 프롬프트 보강하고 전체 재생성 (시드는 부분 재생성 대상 아님)
│
├─ 플로우 추가/삭제/티어 변경
│   └─ 대시보드 spec 편집기 → 승인 → 전체 재생성. 직접 HTML 으로는 절대 하지 말 것 (라우팅·맵·prompt context 가 spec 과 결속).
│
├─ 특정 플로우 한 개의 동작/UI 가 마음에 안 듦
│   ├─ "이번엔 다른 결과가 나왔으면" → 대시보드 → 해당 플로우만 재생성 (Opus 1회 호출, ~30-60s)
│   └─ "프롬프트 자체를 손보고 싶음" → `worker/prompts/pass-b-section.md` 수정 → 전체 재생성
│
└─ 새 화면·새 컴포넌트·spec 에 없는 기능 추가
    └─ 직접 HTML 으로 끼워넣지 말 것. spec 에 새 flow 로 등록하거나, 진짜 일회성이면 별도 브랜치에 portfolio-demo 를 fork 해서 작업하고 데모 생성 큐에서 분리.
```

---

## 5. 직접 편집했을 때 재생성하면 어떻게 되나

### 5.1 전체 재생성 (`regenerate_scope = 'all'`)
- skeleton·seed·sections·assemble 전부 새로 호출.
- 캐시(`demo_artifacts`)도 통째로 새 값으로 덮어쓰임.
- **너의 직접 편집은 100% 사라진다**. 백업 안 했으면 끝.

### 5.2 부분 재생성 (`regenerate_scope = 'flow:flow_xxx'`)
- skeleton·seed·tokens 는 캐시 재사용, 대상 flow 만 Pass B 재호출.
- 다른 플로우의 component_code 도 캐시(`demo_artifacts.patches`)에서 byte-identical 로 복원.
- 그러나 **HTML 파일 자체는 `assembleDemo` 가 처음부터 다시 만든다** — 직접 편집 흔적은 시드·CSS 변수·다른 플로우 컴포넌트 본문 어디든 100% 사라진다.

요약: **`demo_artifacts` 가 SSOT 다.** HTML 은 그냥 `assembleDemo(skeleton, patches, seed)` 의 결정론적 산출물이다. 직접 편집은 영구화되지 않는다.

---

## 6. 미팅 직전 비상 수정 체크리스트

미팅 5분 전 오타를 발견했다면:

1. 직접 `{slug}/portfolio-demo/index.html` 열고 해당 텍스트만 바꾼다.
2. 브라우저 hard reload (`⌘⇧R`) 로 확인 — LocalStorage 가 `__DEMO_SEED__` 갱신을 자동 반영하지 않으므로 시드 변경했으면 LocalStorage `demo_<domain>` 키 삭제 후 새로고침.
3. 이 변경을 git 에 커밋하지 말 것 (`{slug}/portfolio-demo/` 는 워커가 덮어쓰는 generated artifact). 미팅 끝나고 spec / 프롬프트로 영구 반영하거나 그냥 버린다.
4. 미팅 후 같은 프로젝트를 다시 데모할 일이 있으면 **다음 재생성 전에** 해당 변경의 출처를 spec_structured / 프롬프트로 끌어올려라.

---

## 7. 안 좋은 패턴 (하지 말 것)

- ❌ HTML 에 `<script src="./extra.js">` 외부 의존 추가 — 데모는 single-file 계약. `assembleDemo` 가 외부 의존을 검증하지는 않지만 GitHub Pages 배포 시 경로 깨질 수 있고 portfolio 컨벤션(§3) 위반.
- ❌ `function FlowXxx` 끝에 새 `function FlowYyy` 추가 — 다음 재생성에서 `window.__FLOW_COMPONENTS` 맵에 등록 안 돼 dead code. 진짜 새 플로우면 spec 에 등록해라.
- ❌ `__DEMO_SEED__` 에 새 엔티티 추가 — Pass B 컴포넌트가 `store.<new>` 를 참조하지 않으므로 표시되지 않음. spec.data_entities 에 추가하고 재생성.
- ❌ 같은 색/이름을 spec 에 안 넣고 HTML 에서만 바꾸기 — 다음 재생성에서 그대로 원복.
- ❌ `// ---- Pass C ...` 마커 라인 삭제 — 부분 재생성의 contract 의존 (있어도 무해, 없으면 운영자가 헷갈림).

---

## 부록 A: 영구 반영 워크플로우 한눈에

| 변경 의도 | 영구화 경로 |
|---|---|
| 카피·문구·UI 패턴 | 프롬프트 (`worker/prompts/pass-{a,b}-*.md`) → 전체 재생성 |
| 시드 분포·도메인 톤 | `worker/prompts/seed-data.md` → 전체 재생성 |
| 디자인 토큰 추출 휴리스틱 | `worker/shared/extract-tokens.ts` |
| spec 추출 정확도 | `worker/prompts/extract-spec.md` → 해당 프로젝트 spec 재추출 |
| Assemble 로직 (디스패처·시드 주입 등) | `worker/generate-demo/assemble.ts` → 모든 프로젝트 차차 재생성 |
| 플로우 정의·티어·엔티티 | 대시보드 spec 편집기 (UI) → 승인 → 재생성 |
