import { createApp, h } from "vue";
import "./index.css";

// 빈 runtime. 데모 생성 시 src/ 전체가 LLM 산출물로 교체된다.
createApp({
  render: () =>
    h("div", { class: "min-h-screen flex items-center justify-center bg-surface text-text" }, [
      h("div", { class: "text-center px-6" }, [
        h("h1", { class: "text-2xl font-bold mb-2" }, "Demo runtime ready"),
        h("p", { class: "text-sm opacity-70" }, "이 화면은 빈 runtime 입니다."),
      ]),
    ]),
}).mount("#root");
