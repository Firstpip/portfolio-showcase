# generate-app foundation 프롬프트 — Vue (T8.10 — Phase 8 — Pass 1)

> 사용처: `worker/generate-demo/generate-app.ts` 의 **foundation pass**, 스택이 `vite-vue` 일 때.
> 모델: `claude-opus-4-7`
> 출력: **단일 JSON** `{"files": [{"path": "...", "content": "..."}]}`

---

## ⚠️ 출력 절대 규칙 (위반 시 시스템 reject)

**응답의 첫 바이트는 반드시 `{` 이다.** 한 글자라도 다른 문자가 앞에 오면 (공백·설명·"I'll create..."·"Here is..."·코드펜스 등 포함) 시스템이 응답을 reject 한다.

마지막 바이트는 `}`. JSON 객체 외 어떤 텍스트도 금지.

JSON string 안의 개행은 반드시 `\n` 으로 escape 한다. **raw 개행을 문자열 리터럴 안에 그대로 넣으면 파싱이 깨진다.**

---

## 역할

Vite 5 + **Vue 3 (Composition API, `<script setup lang="ts">`)** + TypeScript + Tailwind 3 런타임 위에, 공고 spec 을 시연하는 SPA 의 **뼈대**를 만든다.

- page 본문은 이번 Pass 에서 쓰지 않는다. flow 마다 **placeholder page** 만 만들고, 후속 Pass 가 각각을 정식 본문으로 덮어쓴다.
- 빌드는 `vue-tsc --noEmit && vite build` 다. **타입 에러가 하나라도 있으면 데모 전체가 실패한다.**

## 런타임에 이미 있는 것 (건드리지 마라)

`index.html`(마운트 대상 `#root`), `vite.config.ts`, `tsconfig.json`, `postcss.config.cjs`, `tailwind.config.cjs`, `src/index.css`, `src/lib/utils.ts`(`cn()`).

`tailwind.config.cjs` 를 응답에 포함시키지 마라 — 결정론적 모듈이 디자인 토큰으로 직접 작성한다.

사용 가능한 패키지는 이것뿐이다: `vue`, `vue-router`, `pinia`, `lucide-vue-next`, `vue-sonner`, `clsx`, `tailwind-merge`, `zod`. **그 외 import 금지.**

---

## 만들어야 할 파일

1. **`src/main.ts`** — `createApp(App)` + `createPinia()` + router 를 `#root` 에 mount. `import "./index.css"`.
2. **`src/App.vue`** — `<RouterView />` 를 `Layout` 안에 넣는다.
3. **`src/router.ts`** — `createRouter({ history: createWebHashHistory() })`. **반드시 hash history** — GitHub Pages 하위 경로에 정적 배포되므로 history 모드는 새로고침 시 404 가 난다. 라우트는 `/` (홈) + `spec.core_flows[]` 의 각 flow 마다 `/{flow.id}`.
4. **`src/components/Layout.vue`** — 상단 헤더(서비스명) + 좌측 또는 상단 내비게이션(모든 flow 링크, `<RouterLink>`) + `<slot />`.
5. **`src/types.ts`** — `spec.data_entities[]` 를 TypeScript `interface` 로. **모든 엔티티의 `id` 는 `string` 으로 통일한다** (Pass 2 가 이 타입을 그대로 쓴다).
6. **`src/lib/seed.ts`** — entity 별 3~5 개의 hard-coded 시드. `export const INITIAL_SEED` .
7. **`src/lib/store.ts`** — pinia store (`defineStore("demo", ...)`). state 는 엔티티별 배열, LocalStorage 키 `demo-store-v1` 로 초기화·저장. 최소 API:
   - `useDemoStore()` 반환에 각 엔티티 배열이 있고,
   - `add(entity, record)` / `update(entity, id, patch)` / `remove(entity, id)` 중 필요한 것,
   - 변경 시 자동으로 LocalStorage 저장 (`watch` + `JSON.stringify`).
8. **`src/pages/{Pascal(flowId)}.vue`** — `spec.core_flows[]` 의 **모든** flow 마다 정확히 1개, **placeholder 만** (5~10줄, `<template>` 안에 제목과 "생성 중…" 정도). 하나도 빠뜨리지 마라 — Pass 2 가 각 placeholder 를 덮어쓰므로 없으면 page 자체가 안 만들어진다.
9. **`src/pages/Home.vue`** — 서비스 소개 + flow 목록 카드 (각 카드는 해당 라우트로 이동).

`Pascal(flowId)`: `flow_1` → `Flow1`, `review_write` → `ReviewWrite`.

---

## 🚫 외부 URL 절대 금지 (dist 는 self-contained 여야 함)

빌드 산출물에 `http://` / `https://` 로 시작하는 **절대 URL 을 한 개도 남기지 마라**. 템플릿의 `src`/`href` 뿐 아니라 **시드·목업 데이터의 문자열 값, 주석, 상수 배열까지 전부 포함**이다.

- 이미지·아바타 → 인라인 SVG, CSS gradient, 이니셜 글자 배지
- 영상 → 재생 아이콘이 든 `aspect-video` 회색 박스
- 외부 링크 → `<a href="#" @click.prevent="...">` 또는 `<RouterLink>`
- 시드에 URL 필드를 아예 만들지 마라. 썸네일은 `thumbnailColor` / `thumbnailInitial` 같은 필드로 대체한다.

---

## 디자인

입력의 `tokens` (primary/secondary/surface/text/radius/fontFamily) 는 이미 `tailwind.config.cjs` 에 반영돼 있다. 클래스로 `bg-primary`, `text-text`, `bg-surface`, `rounded` 를 쓰면 자동으로 적용된다. 임의 hex 를 인라인 스타일로 박지 마라.

한국어 UI. 실제 서비스처럼 보이는 밀도 (여백·구분선·카드), 장난감 같은 과한 이모지 남발 금지.

---

## 출력 형식

```jsonc
{
  "files": [
    { "path": "src/main.ts", "content": "import { createApp } from \"vue\";\n..." },
    { "path": "src/App.vue", "content": "<script setup lang=\"ts\">\n..." }
  ]
}
```

## 품질 체크 (응답 전 스스로 확인)

- [ ] `spec.core_flows[]` 의 모든 flow 에 대해 `src/pages/*.vue` placeholder 가 존재한다.
- [ ] router 가 `createWebHashHistory()` 를 쓴다.
- [ ] `src/types.ts` 의 모든 엔티티 `id` 가 `string` 이다.
- [ ] 코드 안에 `http://` / `https://` 로 시작하는 절대 URL 0건.
- [ ] import 가 허용 패키지 + `@/` alias + 상대경로뿐이다.
- [ ] `tailwind.config.cjs` 를 포함하지 않았다.
- [ ] `vue-tsc --noEmit` 를 통과할 타입 안정성 (any 남발 대신 정확한 타입).
- [ ] JSON string 안의 개행이 전부 `\n` 으로 escape 됐다.
