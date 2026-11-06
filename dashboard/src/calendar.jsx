// 사내 캘린더 — 워크룸 #calendar 화면 (2026-10-30)
//
// 팀 근무지(패스트파이브 지점·재택)·개인 근무지·휴가·수동 미팅/일정을 보여 주고 편집한다.
// 수주 미팅은 wishket_projects.meeting_at 을 읽기 전용으로 겹쳐 보여 준다.
// DB: supabase/migrations/20261030120000_team_calendar.sql — 모든 변경은 감사 트리거(project_audit_log)에 남는다.
//
// 구조: 승인받은 프로토타입(초기 디자인 아티팩트)의 화면 엔진을 그대로 옮긴 바닐라 JS 섬이다.
//   React 는 마운트·데이터 전달만 하고(CalendarPage), 화면은 mountCalendar 가 직접 그린다.
//   - 폭에 따라 데스크톱(사이드바 + 월/주/목록)과 폰(5일 카드 → 선택일 → 월/주)을 컨테이너 쿼리로 바꾼다.
//   - 스타일은 모두 .fpcal 아래로 한정해 워크룸 다른 화면에 영향이 없다.
const { useEffect: useEffectCal, useRef: useRefCal, useState: useStateCal } = React;
// 다시 들어올 때 바로 보이게: 캘린더를 나갈 때 데이터·보기 상태를 기억해 두고, 다음에 열면 먼저 그린 뒤 뒤에서 새로 읽는다 (2026-11-04)
//   같은 날·같은 사람·30분 안일 때만 쓴다. 실시간 갱신·탭 복귀 재조회는 그대로.
let CAL_CACHE = null;

const CAL_CSS = ".fpcal{--pink:#fd79a8;--teal:#00cec9;--avbg:#3a3f55;--avfg:#e4e6f0;color:var(--text);line-height:1.5;-webkit-tap-highlight-color:transparent}\n[data-theme=\"light\"] .fpcal{--pink:#db2777;--teal:#0891b2;--avbg:#d5d7e3;--avfg:#1a1d2e}\n.fpcal *,.fpcal *::before,.fpcal *::after{box-sizing:border-box;margin:0;padding:0}\n.fpcal button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}\n.fpcal input,.fpcal select,.fpcal textarea{font:inherit;color:var(--text);background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:.5rem .65rem;width:100%;min-width:0}\n.fpcal input:focus-visible,.fpcal select:focus-visible,.fpcal textarea:focus-visible,.fpcal button:focus-visible{outline:2px solid var(--accent2);outline-offset:1px}\n.fpcal .tnum{font-variant-numeric:tabular-nums}\n.fpcal [hidden]{display:none!important}\n.fpcal .shell{container-type:inline-size;container-name:app;position:relative}\n.fpcal .app{padding-bottom:calc(90px + env(safe-area-inset-bottom,0px))}\n.fpcal .top{position:sticky;top:0;z-index:20;background:var(--bg);padding:calc(.85rem + env(safe-area-inset-top,0px)) 0 .6rem;display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}\n.fpcal .top h1{font-size:1.25rem;font-weight:700;letter-spacing:-.02em;margin-right:auto;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}\n.fpcal .top h1 small{font-size:.72rem;font-weight:500;color:var(--text2);padding:.1rem .45rem;border:1px solid var(--border);border-radius:20px}\n.fpcal .seg{display:inline-flex;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:2px}\n.fpcal .seg button{padding:.35rem .7rem;border-radius:8px;font-size:.82rem;color:var(--text2);font-weight:500}\n.fpcal .seg button[aria-pressed=\"true\"]{background:var(--surface);color:var(--text);font-weight:600;box-shadow:0 1px 3px var(--shadow)}\n.fpcal .btn{padding:.42rem .8rem;border-radius:8px;font-size:.84rem;font-weight:600;border:1px solid var(--border);background:var(--surface2)}\n.fpcal .btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}\n.fpcal .btn.danger{color:var(--red);border-color:color-mix(in srgb,var(--red) 40%,transparent)}\n.fpcal .btn.ghost{border-color:transparent;background:transparent;color:var(--text2)}\n.fpcal .btn:disabled{opacity:.5;cursor:not-allowed}\n.fpcal .nav{display:flex;align-items:center;gap:.5rem;margin:.4rem 0 .8rem;flex-wrap:wrap}\n.fpcal .nav .range{font-weight:700;font-size:1.05rem;letter-spacing:-.01em}\n.fpcal .nav .arrow{width:34px;height:34px;border-radius:8px;border:1px solid var(--border);background:var(--surface);font-size:1rem;display:grid;place-items:center}\n.fpcal .nav .spacer{flex:1}\n.fpcal .role{display:inline-flex;align-items:center;gap:.4rem;font-size:.76rem;color:var(--text2)}\n.fpcal .layout{display:none;grid-template-columns:300px minmax(0,1fr);gap:1rem;align-items:start}\n.fpcal .mobile{display:flex;flex-direction:column;gap:.75rem}\n@container app (min-width: 900px){.fpcal .layout{display:grid}\n.fpcal .mobile,.fpcal .fab{display:none}}\n@container app (max-width: 899px){.fpcal .nav,.fpcal .top .seg,.fpcal .top h1 small,.fpcal #btn-add-top{display:none}}\n.fpcal .mobile{max-width:640px;width:100%;margin:0 auto}\n@container app (min-width: 900px){.fpcal .side{position:sticky;top:70px;max-height:calc(100vh - 82px);overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;padding-bottom:6px}}\n.fpcal .wnav{display:flex;align-items:center;gap:.5rem}\n.fpcal .wnav .range{font-weight:700;font-size:1rem;letter-spacing:-.01em;flex:1}\n.fpcal .wnav .arrow{width:32px;height:32px;border-radius:8px;border:1px solid var(--border);background:var(--surface);display:grid;place-items:center}\n.fpcal .wnav .seg button{padding:.3rem .65rem}\n.fpcal .mday .today-head{margin-bottom:.6rem}\n.fpcal .mday .now{font-size:.74rem;font-weight:700;color:var(--accent2)}\n.fpcal .mday .cnt{font-size:.78rem;color:var(--text2);margin-left:auto}\n.fpcal .mday .evlist{margin-top:.75rem;padding-top:.7rem;border-top:1px dashed var(--border)}\n.fpcal .mday .ev{padding:.6rem .7rem}\n.fpcal .mday .ev .ti{font-size:.9rem;white-space:normal}\n.fpcal .mday .ev .su{font-size:.76rem;white-space:normal;flex-wrap:wrap}\n.fpcal .mday .ev .t{font-size:.8rem;width:3.4rem}\n.fpcal .side{display:flex;flex-direction:column;gap:.9rem}\n.fpcal .card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:.85rem .95rem}\n.fpcal .card h3{font-size:.76rem;font-weight:600;color:var(--text2);letter-spacing:.04em;text-transform:uppercase;margin-bottom:.55rem;display:flex;align-items:center;gap:.4rem}\n.fpcal .card h3 .r{margin-left:auto;font-weight:500;letter-spacing:0;text-transform:none;font-size:.72rem;color:var(--text2)}\n.fpcal .teamloc{display:flex;align-items:center;gap:.6rem;padding:.6rem .75rem;border-radius:10px;border:1px solid;min-width:0}\n.fpcal .teamloc .ic{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;font-size:1.1rem;flex-shrink:0;background:color-mix(in srgb,currentColor 18%,transparent)}\n.fpcal .teamloc .tx{min-width:0;flex:1}\n.fpcal .teamloc .tx>span{display:block}\n.fpcal .teamloc .tx .l2{white-space:normal;word-break:keep-all}\n.fpcal .teamloc .l1{font-size:.66rem;font-weight:600;letter-spacing:.04em;opacity:.8}\n.fpcal .teamloc .l2{font-size:.98rem;font-weight:700;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)}\n.fpcal .teamloc .l3{font-size:.7rem;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.fpcal .teamloc .edit{font-size:.74rem;color:var(--text2);padding:.25rem .5rem;border:1px solid var(--border);border-radius:6px;flex-shrink:0;background:var(--surface)}\n.fpcal .today-head{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin-bottom:.6rem}\n.fpcal .sheet .today-head .x{margin-left:.1rem}\n.fpcal .today-head .d{font-size:1.15rem;font-weight:700}\n.fpcal .today-head .hol{color:var(--red);font-weight:600;font-size:.85rem}\n.fpcal .people{display:flex;flex-direction:column;gap:.4rem;margin-top:.6rem}\n.fpcal .prow{display:flex;align-items:center;gap:.6rem;min-width:0}\n.fpcal .prow .nm{font-weight:600;font-size:.88rem;width:3.6rem;flex-shrink:0}\n.fpcal .prow .nm small{display:block;font-size:.62rem;font-weight:500;color:var(--text2);line-height:1}\n.fpcal .prow .note{color:var(--text2);font-size:.74rem;margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}\n.fpcal .av{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-size:.72rem;font-weight:700;color:var(--avfg);background:var(--avbg);flex-shrink:0}\n.fpcal .av.me{outline:2px solid var(--accent);outline-offset:-1px}\n.fpcal .loc{display:inline-flex;align-items:center;gap:.3rem;padding:.15rem .5rem;border-radius:20px;font-size:.76rem;font-weight:600;border:1px solid;white-space:nowrap}\n.fpcal .loc i{width:7px;height:7px;border-radius:50%;background:currentColor}\n.fpcal .loc.editable{cursor:pointer}\n.fpcal .loc.same{color:var(--text2);border-color:var(--border);background:transparent}\n.fpcal .loc.same i{opacity:.9}\n.fpcal .mystat{margin-top:.75rem;display:flex;flex-direction:column;gap:.35rem}\n.fpcal .mystat .h{font-size:.74rem;font-weight:700;color:var(--text)}\n.fpcal .mystat .h small{font-weight:500;color:var(--text2);font-size:.68rem}\n.fpcal .mystat .opts{display:flex;gap:3px;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:3px}\n.fpcal .mystat .opts button{flex:1 1 auto;padding:.5rem .45rem;border-radius:8px;font-size:.8rem;font-weight:600;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}\n.fpcal .mystat .opts button[aria-pressed=\"true\"]{background:var(--surface);color:var(--c);box-shadow:0 1px 3px var(--shadow);outline:1.5px solid color-mix(in srgb,var(--c) 55%,transparent);outline-offset:-1.5px}\n.fpcal .mystat .opts button[data-q=\"more\"]{color:var(--text2);font-weight:500}\n.fpcal .offday{font-size:.86rem;font-weight:600;color:var(--text2);padding:.5rem .1rem .1rem}\n.fpcal .mystat .leave{font-size:.84rem;font-weight:600;color:var(--red)}\n.fpcal .addday{align-self:flex-start;padding:.3rem .4rem}\n.fpcal .wb-h{display:flex;align-items:center;gap:.35rem;margin-bottom:.6rem}\n.fpcal .wb-h h3{margin:0}\n.fpcal .wb-h .r{margin-left:auto;font-size:.74rem;color:var(--text2)}\n.fpcal .wb-h .arrow{width:26px;height:26px;border-radius:7px;border:1px solid var(--border);background:var(--surface2);display:grid;place-items:center;font-size:.9rem}\n.fpcal .wb{display:flex;flex-direction:column;gap:3px}\n.fpcal .wb-row{display:grid;grid-template-columns:2.4rem minmax(0,1fr);gap:.5rem;align-items:start;padding:.4rem .45rem;border-radius:10px;border:1px solid transparent}\n.fpcal .wb-row.today{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 7%,transparent)}\n.fpcal .wb-row.past{opacity:.5}\n.fpcal .wb-d{display:flex;flex-direction:column;align-items:center;line-height:1.15;padding-top:2px;border-radius:6px}\n.fpcal .wb-d:hover{background:var(--surface2)}\n.fpcal .wb-d .w{font-size:.68rem;color:var(--text2)}\n.fpcal .wb-d .n{font-size:1.05rem;font-weight:700}\n.fpcal .wb-row.today .wb-d .n{color:var(--accent2)}\n.fpcal .wb-main{min-width:0;display:flex;flex-direction:column;gap:3px}\n.fpcal .wb-team{display:flex;align-items:center;gap:.4rem;padding:.38rem .55rem;border-radius:8px;font-size:.86rem;font-weight:700;text-align:left;width:100%;min-width:0;color:var(--c);background:color-mix(in srgb,var(--c) 12%,transparent);border:1px solid color-mix(in srgb,var(--c) 35%,transparent)}\n.fpcal .wb-team:hover{background:color-mix(in srgb,var(--c) 20%,transparent)}\n.fpcal .wb-team .ic{font-size:.9rem;flex-shrink:0}\n.fpcal .wb-team .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)}\n.fpcal .wb-team em{font-style:normal;font-size:.66rem;font-weight:600;margin-left:auto;flex-shrink:0;white-space:nowrap}\n.fpcal .wb-ex{display:flex;align-items:center;gap:.35rem;font-size:.78rem;padding:2px .3rem;border-radius:6px;text-align:left;width:100%;min-width:0}\n.fpcal .wb-ex:hover{background:var(--surface2)}\n.fpcal .wb-ex .av{width:18px;height:18px;font-size:.56rem}\n.fpcal .wb-ex span{font-weight:600;flex-shrink:0}\n.fpcal .wb-ex b{font-weight:700;color:var(--c);flex-shrink:0}\n.fpcal .wb-ex small{color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:.72rem}\n.fpcal .wb-hol{display:block;color:var(--text2);font-weight:600;font-size:.84rem;padding:.38rem .2rem}\n.fpcal .wb-foot{margin-top:.6rem;padding-top:.55rem;border-top:1px dashed var(--border);font-size:.72rem;color:var(--text2);line-height:1.5}\n.fpcal .strip-vp{position:relative;margin:0 -2px;padding:0 2px}\n.fpcal .strip{display:grid;grid-auto-flow:column;grid-auto-columns:calc((100% - 20px) / 5);gap:5px;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;overscroll-behavior-x:contain;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding:1px 0}\n.fpcal .strip::-webkit-scrollbar{display:none}\n.fpcal .strip>button{scroll-snap-align:start}\n.fpcal .strip.dragging{scroll-snap-type:none;cursor:grabbing}\n.fpcal .strip.entering{position:absolute;inset:0 2px}\n.fpcal .strip.leaving{pointer-events:none}\n@media (prefers-reduced-motion: reduce){.fpcal .strip{transition:none}}\n.fpcal .strip button.off{background:color-mix(in srgb,var(--surface) 55%,var(--bg))}\n.fpcal .strip button{display:flex;flex-direction:column;align-items:center;gap:3px;padding:.45rem 0 .4rem;border-radius:10px;border:1px solid transparent;background:var(--surface);min-width:0}\n.fpcal .strip .wd{font-size:.68rem;color:var(--text2)}\n.fpcal .strip .dn{font-size:1rem;font-weight:700;line-height:1.1}\n.fpcal .strip .lb{font-size:.6rem;font-weight:700;line-height:1;padding:2px 5px;border-radius:4px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.fpcal .strip .who{display:flex;gap:1px;height:16px;align-items:center}\n.fpcal .strip .who .av{width:16px;height:16px;font-size:.52rem;border:1.5px solid var(--c)}\n.fpcal .strip button.past{opacity:.55}\n.fpcal .strip button.past[aria-pressed=\"true\"]{opacity:.85}\n.fpcal .strip-vp.dragging .strip{transition:none}\n.fpcal .strip-vp{cursor:grab;user-select:none;-webkit-user-select:none}\n.fpcal .strip button[aria-pressed=\"true\"]{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 14%,var(--surface))}\n.fpcal .strip button.today .dn,.fpcal .strip button.today .wd{color:var(--accent2);font-weight:700}\n.fpcal .strip .wd.sat{color:var(--blue)}\n.fpcal .strip .wd.sun{color:var(--red)}\n.fpcal .strip .cnt{font-size:.62rem;color:var(--text2);height:.9rem}\n.fpcal .week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}\n.fpcal .col{background:var(--surface);border:1px solid var(--border);border-radius:12px;min-height:300px;display:flex;flex-direction:column;overflow:hidden;min-width:0}\n.fpcal .col.today{border-color:var(--accent)}\n.fpcal .col.wknd{background:color-mix(in srgb,var(--surface) 70%,var(--bg))}\n.fpcal .col.past{opacity:.6}\n.fpcal .col .ch{padding:.55rem .6rem .4rem;display:flex;align-items:baseline;gap:.4rem;border-bottom:1px solid var(--border);width:100%;text-align:left;min-width:0}\n.fpcal .col .ch:hover{background:var(--surface2)}\n.fpcal .col .ch .dn{font-size:1.15rem;font-weight:700;line-height:1}\n.fpcal .col.today .ch .dn{color:var(--accent2)}\n.fpcal .col .ch .wd{font-size:.75rem;color:var(--text2)}\n.fpcal .col .ch .hol{font-size:.72rem;color:var(--red);font-weight:600;margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.fpcal .col .tl{display:flex;align-items:center;gap:.35rem;padding:.4rem .5rem;font-size:.76rem;font-weight:700;border-bottom:1px solid var(--border);min-width:0;width:100%;text-align:left}\n.fpcal .col .tl i{width:8px;height:8px;border-radius:50%;background:currentColor;flex-shrink:0}\n.fpcal .col .tl span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.fpcal .col .tl em{font-style:normal;font-size:.6rem;color:var(--text2);font-weight:500;margin-left:auto;flex-shrink:0}\n.fpcal .col .exc{display:flex;flex-direction:column;gap:3px;padding:.35rem .5rem;border-bottom:1px solid var(--border);background:color-mix(in srgb,var(--surface2) 50%,transparent)}\n.fpcal .locrow{display:flex;align-items:center;gap:.35rem;font-size:.72rem;min-width:0;border-radius:6px;padding:1px 2px;width:100%;text-align:left}\n.fpcal .locrow:hover{background:var(--surface2)}\n.fpcal .locrow .av{width:18px;height:18px;font-size:.58rem}\n.fpcal .locrow .lb{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.fpcal .locrow .lb::before{content:\"\";display:inline-block;width:7px;height:7px;border-radius:50%;background:currentColor;margin-right:4px;vertical-align:1px}\n.fpcal .col .evs{padding:.45rem .5rem;display:flex;flex-direction:column;gap:4px;flex:1}\n.fpcal .col .add{color:var(--text2);font-size:.75rem;padding:.4rem .5rem;text-align:left;opacity:0;transition:opacity .15s}\n.fpcal .col:hover .add{opacity:1}\n.fpcal .ev{display:flex;gap:.45rem;align-items:flex-start;padding:.4rem .5rem;border-radius:8px;background:var(--surface2);border-left:3px solid var(--c,var(--accent));text-align:left;min-width:0;width:100%}\n.fpcal .ev .t{font-size:.72rem;color:var(--text2);white-space:nowrap;flex-shrink:0;padding-top:1px}\n.fpcal .ev .b{min-width:0;flex:1}\n.fpcal .ev .ti{font-size:.8rem;font-weight:600;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.fpcal .ev .su{font-size:.7rem;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:.3rem}\n.fpcal .ev .su .who{color:var(--text);font-weight:500}\n.fpcal .ev.allday{background:color-mix(in srgb,var(--c,var(--accent)) 16%,var(--surface2))}\n.fpcal .ev.done{opacity:.55}\n.fpcal .ev .tag{font-size:.62rem;font-weight:700;padding:0 .3rem;border-radius:4px;background:color-mix(in srgb,var(--c) 22%,transparent);color:var(--c);margin-right:.25rem;vertical-align:1px;white-space:nowrap}\n.fpcal .ev .pp{display:inline-flex;vertical-align:middle;flex-shrink:0}\n.fpcal .ev .pp .av{width:14px;height:14px;font-size:.5rem;margin-left:-4px;border:1.5px solid var(--surface2)}\n.fpcal .ev .pp .av:first-child{margin-left:0}\n.fpcal .daydetail .ev,.fpcal .agenda .ev{padding:.6rem .7rem}\n.fpcal .agenda.on{display:flex}\n.fpcal .daydetail .ev .ti,.fpcal .agenda .ev .ti{font-size:.9rem;white-space:normal}\n.fpcal .daydetail .ev .su,.fpcal .agenda .ev .su{font-size:.76rem;white-space:normal;flex-wrap:wrap}\n.fpcal .daydetail .ev .t,.fpcal .agenda .ev .t{font-size:.8rem;width:3.4rem}\n.fpcal .daydetail{display:flex;flex-direction:column;gap:.8rem}\n.fpcal .dd-head{display:flex;align-items:baseline;gap:.5rem;flex-wrap:wrap}\n.fpcal .dd-head .d{font-size:1.05rem;font-weight:700}\n.fpcal .dd-head .hol{color:var(--red);font-size:.82rem;font-weight:600}\n.fpcal .evlist{display:flex;flex-direction:column;gap:6px}\n.fpcal .empty{color:var(--text2);font-size:.82rem;padding:.6rem .2rem}\n.fpcal .agenda{display:none;flex-direction:column;gap:.5rem}\n.fpcal .agenda.on{display:flex}\n.fpcal .ag-day{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:.6rem .8rem;display:flex;flex-direction:column;gap:.4rem}\n.fpcal .ag-day.today{border-color:var(--accent)}\n.fpcal .ag-day.off{opacity:.7}\n.fpcal .ag-h{display:flex;align-items:center;gap:.5rem;min-width:0;flex-wrap:wrap}\n.fpcal .ag-h .d{font-weight:700;font-size:.95rem;cursor:pointer}\n.fpcal .ag-h .d.today{color:var(--accent2)}\n.fpcal .ag-h .hol{color:var(--red);font-size:.78rem;font-weight:600}\n.fpcal .ag-h .tl{display:inline-flex;align-items:center;gap:.3rem;font-size:.74rem;font-weight:700;padding:.1rem .5rem;border-radius:20px;border:1px solid}\n.fpcal .ag-h .tl i{width:7px;height:7px;border-radius:50%;background:currentColor}\n.fpcal .ag-h .ex{display:inline-flex;gap:.3rem;font-size:.72rem;color:var(--text2);flex-wrap:wrap}\n.fpcal .ag-h .ex b{font-weight:600}\n.fpcal .ag-h .add{margin-left:auto;color:var(--text2);font-size:.78rem}\n.fpcal .ag-more{text-align:center}\n.fpcal .month{display:none}\n.fpcal .month.on{display:block}\n.fpcal .mgrid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px}\n.fpcal .mgrid .wh{font-size:.72rem;color:var(--text2);text-align:center;padding:.2rem 0 .4rem}\n.fpcal .mgrid .wh.sat{color:var(--blue)}\n.fpcal .mgrid .wh.sun{color:var(--red)}\n.fpcal .mc{background:var(--surface);border:1px solid var(--border);border-radius:8px;min-height:58px;padding:.3rem .3rem;text-align:left;display:flex;flex-direction:column;gap:2px;min-width:0}\n@container app (min-width: 900px){.fpcal .mc{min-height:108px;padding:.35rem .4rem}}\n.fpcal .mc.out{opacity:.4}\n.fpcal .mc.past{opacity:.6}\n.fpcal .mc.sel{border-color:var(--accent);opacity:1}\n.fpcal .mc.today{background:color-mix(in srgb,var(--accent) 8%,var(--surface))}\n.fpcal .mc.today .n{color:var(--accent2)}\n.fpcal .mc .n{font-size:.8rem;font-weight:700;line-height:1.1;display:flex;justify-content:space-between;align-items:center;min-width:0}\n.fpcal .mc .n .h{font-size:.58rem;color:var(--red);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:3px}\n.fpcal .mc .n .ex{display:flex;gap:1px}\n.fpcal .mc .n .ex .av{width:13px;height:13px;font-size:.48rem;border:1px solid var(--c)}\n.fpcal .mc .tloc.dim{background:transparent;padding-left:1px;font-weight:600;opacity:.75}\n.fpcal .mc .tloc{font-size:.6rem;font-weight:700;line-height:1.2;padding:1px 4px;border-radius:4px;align-self:flex-start;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.fpcal .mc .li{font-size:.66rem;line-height:1.3;padding:0 .25rem;border-radius:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-left:2px solid var(--c);background:color-mix(in srgb,var(--c) 14%,transparent)}\n.fpcal .mc .li b{font-weight:600}\n.fpcal .mc .li .k{color:var(--c);font-weight:700;margin-right:2px}\n.fpcal .mc .more{font-size:.62rem;color:var(--text2)}\n.fpcal .mc .bars{display:none;flex-direction:column;gap:2px;margin-top:1px}\n.fpcal .mc .bars i{display:block;height:4px;border-radius:2px;background:var(--c);max-width:100%}\n@container app (max-width: 899px){.fpcal .mc .li,.fpcal .mc .more{display:none}\n.fpcal .mc .bars{display:flex}}\n.fpcal .chips{display:flex;flex-wrap:wrap;gap:.35rem}\n.fpcal .chip{display:inline-flex;align-items:center;gap:.35rem;padding:.3rem .6rem;border-radius:20px;border:1px solid var(--border);font-size:.78rem;font-weight:500;color:var(--text2);background:var(--surface2);white-space:nowrap}\n.fpcal .chip[aria-pressed=\"true\"]{color:var(--text);border-color:var(--c,var(--accent));background:color-mix(in srgb,var(--c,var(--accent)) 16%,var(--surface2))}\n.fpcal .chip .av{width:16px;height:16px;font-size:.55rem}\n.fpcal .chip i.sw{width:8px;height:8px;border-radius:2px;background:var(--c)}\n.fpcal .log{display:flex;flex-direction:column;gap:.45rem;font-size:.8rem}\n.fpcal .log .e{display:grid;grid-template-columns:auto 1fr;gap:.4rem;align-items:start;min-width:0}\n.fpcal .log .e .av{width:18px;height:18px;font-size:.55rem;margin-top:2px}\n.fpcal .log .e .m{min-width:0;line-height:1.35}\n.fpcal .log .e .m b{font-weight:600}\n.fpcal .log .e .m small{display:block;color:var(--text2);font-size:.68rem}\n.fpcal .fab{position:fixed;right:calc(16px + env(safe-area-inset-right,0px));bottom:calc(18px + env(safe-area-inset-bottom,0px));width:54px;height:54px;border-radius:50%;background:var(--accent);color:#fff;font-size:1.7rem;display:grid;place-items:center;box-shadow:0 6px 18px var(--shadow);z-index:25;line-height:1}\n@container app (min-width: 900px){.fpcal .fab{display:none}}\n.fpcal .ovl{position:fixed;inset:0;background:var(--overlay);z-index:40;display:flex;align-items:center;justify-content:center;padding:1rem}\n.fpcal .ovl[hidden]{display:none!important}\n.fpcal .sheet{background:var(--surface);border:1px solid var(--border);border-radius:16px;width:min(520px,100%);max-height:90%;overflow:auto;padding:1.1rem 1.1rem calc(1.1rem + env(safe-area-inset-bottom,0px));box-shadow:0 12px 40px var(--shadow)}\n@container app (max-width: 640px){.fpcal .ovl{align-items:flex-end;padding:0}\n.fpcal .sheet{width:100%;border-radius:16px 16px 0 0;max-height:94%;animation:fpcal-up .22s ease-out}\n.fpcal input,.fpcal select,.fpcal textarea{font-size:16px}}\n@keyframes fpcal-up{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}\n@media (prefers-reduced-motion: reduce){.fpcal .sheet{animation:none}}\n.fpcal .sheet h2{font-size:1.05rem;font-weight:700;margin-bottom:.8rem;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}\n.fpcal .sheet .x{margin-left:auto;width:30px;height:30px;border-radius:8px;display:grid;place-items:center;color:var(--text2)}\n.fpcal .types{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-bottom:.9rem}\n.fpcal .types button{padding:.5rem .2rem;border-radius:8px;border:1px solid var(--border);background:var(--surface2);font-size:.8rem;font-weight:600;color:var(--text2)}\n.fpcal .types button[aria-pressed=\"true\"]{border-color:var(--c);color:var(--c);background:color-mix(in srgb,var(--c) 14%,var(--surface2))}\n.fpcal .sub{display:inline-flex;gap:4px;margin-bottom:.8rem}\n.fpcal .sub button{padding:.35rem .7rem;border-radius:8px;border:1px solid var(--border);font-size:.8rem;font-weight:600;color:var(--text2);background:var(--surface2)}\n.fpcal .sub button[aria-pressed=\"true\"]{color:var(--text);border-color:var(--accent);background:color-mix(in srgb,var(--accent) 14%,var(--surface2))}\n.fpcal .fld{display:flex;flex-direction:column;gap:.25rem;margin-bottom:.7rem}\n.fpcal .fld label{font-size:.76rem;font-weight:600;color:var(--text2)}\n.fpcal .fld label.ck{display:flex;align-items:center;gap:.4rem;color:var(--text);font-weight:500}\n.fpcal .fld label.ck input{width:auto}\n.fpcal .row2{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}\n.fpcal .hint{font-size:.74rem;color:var(--text2);line-height:1.45}\n.fpcal .hint.warn{color:var(--yellow)}\n.fpcal .hint.warn::before{content:\"⚠ \"}\n.fpcal .kinds{display:grid;grid-template-columns:repeat(3,1fr);gap:4px}\n.fpcal .kinds button{padding:.4rem .3rem;border-radius:8px;border:1px solid var(--border);background:var(--surface2);font-size:.74rem;font-weight:600;color:var(--text2);text-align:left;line-height:1.25}\n.fpcal .kinds button small{display:block;font-weight:400;font-size:.62rem;opacity:.8}\n.fpcal .kinds button[aria-pressed=\"true\"]{border-color:var(--c);color:var(--c);background:color-mix(in srgb,var(--c) 14%,var(--surface2))}\n.fpcal .actions{display:flex;gap:.5rem;justify-content:flex-end;margin-top:.5rem;flex-wrap:wrap}\n.fpcal .actions .btn{padding:.55rem 1rem}\n.fpcal .kv{display:grid;grid-template-columns:5rem 1fr;gap:.35rem .6rem;font-size:.86rem;margin-bottom:.8rem}\n.fpcal .kv dt{color:var(--text2)}\n.fpcal .kv dd{min-width:0;word-break:break-word}\n.fpcal .meta{font-size:.72rem;color:var(--text2);margin-bottom:.6rem;padding-top:.5rem;border-top:1px dashed var(--border)}\n.fpcal .toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(84px + env(safe-area-inset-bottom,0px));background:var(--text);color:var(--bg);padding:.55rem .9rem;border-radius:10px;font-size:.84rem;font-weight:600;z-index:60;box-shadow:0 6px 18px var(--shadow);max-width:calc(100% - 32px);width:max-content;word-break:keep-all;text-align:center}\n.fpcal .toast{display:flex;align-items:center;gap:.8rem;justify-content:center}\n.fpcal .toast button{color:inherit;font-weight:700;text-decoration:underline;font-size:.84rem;padding:.1rem .2rem;white-space:nowrap;flex:none}\n.fpcal .toast[hidden]{display:none!important}\n.fpcal .demo{font-size:.72rem;color:var(--text2);text-align:center;padding:1rem 0 0;line-height:1.5}\n.fpcal .demo button{color:var(--text2);text-decoration:underline;font-size:inherit}\n.fpcal .fab{z-index:900}\n.fpcal .ovl{z-index:1000}\n.fpcal .toast{z-index:1001}\n.fpcal.wide .fab{display:none}\n.fpcal.narrow .ovl{align-items:flex-end;padding:0}\n.fpcal.narrow .sheet{width:100%;border-radius:16px 16px 0 0;max-height:94%;animation:fpcal-up .22s ease-out}\n.fpcal.narrow .sheet input,.fpcal.narrow .sheet select,.fpcal.narrow .sheet textarea{font-size:16px}\n@media (prefers-reduced-motion: reduce){ .fpcal.narrow .sheet{animation:none} }\n/* 입력창 정돈 (2026-10-31) — 칸 높이 통일, 종일 스위치, 버튼 묶음 칸 맞춤, 저장 줄 고정 */\n.fpcal .sheet input:not([type=checkbox]),.fpcal .sheet select{min-height:44px}\n.fpcal .sheet input[type=date],.fpcal .sheet input[type=time]{-webkit-appearance:none;appearance:none;display:flex;align-items:center;text-align:left}\n.fpcal .sheet input::-webkit-date-and-time-value{text-align:left;margin:0}\n.fpcal .lblrow{display:flex;align-items:center;justify-content:space-between;min-height:24px}\n.fpcal .tgl{display:inline-flex;align-items:center;gap:.4rem;font-size:.8rem!important;font-weight:600;color:var(--text)!important;cursor:pointer;user-select:none}\n.fpcal .tgl input{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}\n.fpcal .tgl i{width:34px;height:20px;border-radius:10px;background:var(--border);position:relative;transition:background .15s}\n.fpcal .tgl i::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}\n.fpcal .tgl input:checked+i{background:var(--accent)}\n.fpcal .tgl input:checked+i::after{transform:translateX(14px)}\n.fpcal .tgl input:focus-visible+i{outline:2px solid var(--accent2);outline-offset:2px}\n.fpcal .trow{display:grid;grid-template-columns:1fr auto 1fr;gap:.5rem;align-items:center}\n.fpcal .trow span{color:var(--text2)}\n.fpcal .trow{grid-template-columns:minmax(0,1fr) auto minmax(0,1fr) auto}\n.fpcal .trow .tin{text-align:center;font-variant-numeric:tabular-nums;cursor:pointer;caret-color:transparent}\n.fpcal .trow .tin.on{border-color:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 25%,transparent)}\n.fpcal .trow .tin[hidden],.fpcal .trow [hidden]{display:none}\n.fpcal .addend{grid-column:2/-1;justify-self:start;padding:.45rem .7rem;border-radius:8px;border:1px dashed var(--border);font-size:.8rem;font-weight:600;color:var(--text2)}\n.fpcal .addend.x{grid-column:auto;border-style:solid;padding:.45rem .6rem}\n.fpcal .tpk{margin-top:.5rem;padding:.6rem;border:1px solid var(--border);border-radius:12px;background:var(--surface2)}\n.fpcal .tpk-h{display:flex;justify-content:space-between;align-items:center;font-size:.74rem;font-weight:600;color:var(--text2);margin:.1rem 0 .35rem}\n.fpcal .tpk-g{display:grid;gap:.3rem;margin-bottom:.45rem}\n.fpcal .tpk-g.hrs{grid-template-columns:repeat(6,1fr)}\n.fpcal .tpk-g.mins{grid-template-columns:repeat(6,1fr);margin-bottom:0}\n.fpcal .tpk-g button{min-height:40px;border-radius:8px;border:1px solid var(--border);background:var(--surface);font-size:.85rem;font-weight:600;font-variant-numeric:tabular-nums;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.05}\n.fpcal .tpk-g button small{font-size:.58rem;font-weight:500;color:var(--text2)}\n.fpcal .tpk-g button[aria-pressed=\"true\"]{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 18%,var(--surface));color:var(--text)}\n.fpcal .linkbtn{font-size:.76rem;font-weight:600;color:var(--accent2);text-decoration:underline;text-underline-offset:2px;padding:0 .1rem}\n.fpcal .allday-box{min-height:44px;display:flex;align-items:center;padding:0 .65rem;border:1px dashed var(--border);border-radius:8px;color:var(--text2);font-size:.9rem}\n.fpcal .seg.full{display:grid;grid-auto-flow:column;grid-auto-columns:1fr}\n.fpcal .seg.full button{min-height:38px}\n.fpcal .sheet .sub{display:grid;grid-auto-flow:column;grid-auto-columns:1fr}\n.fpcal .sheet .sub button{min-height:38px}\n.fpcal .chips.grid2,.fpcal .chips.grid3,.fpcal .chips.grid4{display:grid;gap:.4rem}\n.fpcal .chips.grid2{grid-template-columns:1fr 1fr}\n.fpcal .chips.grid3{grid-template-columns:repeat(3,1fr)}\n.fpcal .chips.grid4{grid-template-columns:repeat(4,1fr)}\n.fpcal .chips.grid2 .chip,.fpcal .chips.grid3 .chip,.fpcal .chips.grid4 .chip{min-height:40px;border-radius:10px;justify-content:center;white-space:normal;text-align:center;line-height:1.25}\n.fpcal .chips.grid2 .chip{justify-content:flex-start;text-align:left}\n.fpcal .chips .chip.span2{grid-column:1/-1}\n.fpcal .fld label.ck{align-items:flex-start;line-height:1.4}\n.fpcal .fld label.ck input{margin-top:.15rem;flex:none}\n.fpcal.narrow .sheet.form{height:94%;display:flex;flex-direction:column}\n.fpcal.narrow .sheet.form>*{flex-shrink:0}\n.fpcal.narrow .sheet.form>form{flex:1 0 auto;display:flex;flex-direction:column}\n.fpcal.narrow .sheet .actions.foot{position:sticky;bottom:calc(-1.1rem - env(safe-area-inset-bottom,0px));margin:auto -1.1rem calc(-1.1rem - env(safe-area-inset-bottom,0px));padding:.7rem 1.1rem calc(.7rem + env(safe-area-inset-bottom,0px));background:var(--surface);border-top:1px solid var(--border);display:grid;grid-template-columns:1fr 2fr;gap:.5rem;z-index:2}\n.fpcal.narrow .sheet .actions.foot .btn{min-height:46px;font-size:.95rem}\n.fpcal .top .back{padding:.35rem .55rem;font-size:.84rem;color:var(--text2);border:1px solid var(--border);border-radius:8px}\n.fpcal .ro{margin:.2rem 0 .8rem;padding:.6rem .8rem;border-radius:10px;border:1px solid color-mix(in srgb,var(--yellow) 45%,transparent);background:color-mix(in srgb,var(--yellow) 10%,transparent);font-size:.82rem;line-height:1.5}\n.fpcal .steps{display:flex;flex-direction:column;gap:.5rem;margin:.2rem 0 .9rem;padding-left:1.2rem;font-size:.88rem;line-height:1.5}\n.fpcal .steps b{font-weight:700}\n.fpcal .pstat{display:flex;align-items:center;gap:.5rem;padding:.6rem .75rem;border-radius:10px;margin-bottom:.9rem;font-size:.86rem;font-weight:600;border:1px solid color-mix(in srgb,var(--c) 45%,transparent);background:color-mix(in srgb,var(--c) 10%,transparent);color:var(--text)}\n.fpcal .pstat i{width:8px;height:8px;border-radius:50%;background:var(--c);flex-shrink:0}\n.fpcal .ovl:not([hidden]) ~ .toast{top:calc(16px + env(safe-area-inset-top,0px));bottom:auto}\n.fpcal .loading{padding:3rem 0;text-align:center;color:var(--text2)}\n/* PC 정돈 (2026-11-03) — 헤더 한 줄, 사이드바 탭(안쪽 스크롤 없이 한 화면), 주간 칸 제목, 입력창 저장 줄 고정 */\n.fpcal .ev .ti{display:block;word-break:keep-all;overflow-wrap:anywhere}\n.fpcal .top .nav{margin:0;flex-wrap:nowrap}\n.fpcal .top .nav{gap:.25rem}\n.fpcal .top .nav .range{white-space:nowrap;text-align:center;padding:0 .35rem}\n.fpcal .top .nav .range[data-v=month]{min-width:6.4em}\n.fpcal .top .nav .range[data-v=week],.fpcal .top .nav .range[data-v=list]{min-width:14.3em}\n@container app (max-width: 899px){.fpcal .top #btn-push,.fpcal .top #btn-set{order:1}\n.fpcal .top #btn-today{order:2}}\n@container app (min-width: 900px){.fpcal .top h1{margin-right:.6rem}\n.fpcal .top .nav{margin-right:auto}\n.fpcal .app{padding-bottom:1.5rem}\n.fpcal .layout{margin-top:.4rem}\n.fpcal .side{max-height:calc(100vh - 94px);gap:.5rem}\n.fpcal .side .card{padding:.7rem .85rem}}\n.fpcal .stabs{width:100%}\n.fpcal .stabs button{padding:.45rem .3rem;font-size:.82rem;white-space:nowrap}\n.fpcal .mday .ev.mini{padding:.4rem .55rem;align-items:center;gap:.4rem}\n.fpcal .mday .ev.mini .t{width:2.9rem;font-size:.74rem;padding-top:0}\n.fpcal .mday .ev.mini .ti{white-space:nowrap;font-size:.84rem}\n.fpcal .evlist .more-day{text-align:left;font-size:.8rem;font-weight:600;color:var(--text2);padding:.3rem .55rem;border-radius:8px}\n.fpcal .evlist .more-day:hover{background:var(--surface2);color:var(--text)}\n.fpcal .col .ev{flex-direction:column;gap:2px}\n.fpcal .col .ev .t{padding-top:0;font-size:.7rem}\n.fpcal .col .ev .b{width:100%}\n.fpcal .col .ev .ti{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}\n.fpcal .uplist{display:flex;flex-direction:column;gap:4px}\n.fpcal .up-d{display:flex;align-items:baseline;gap:.45rem;padding:.45rem .15rem .05rem;text-align:left;border-radius:6px}\n.fpcal .up-d:first-child{padding-top:0}\n.fpcal .up-d:hover span{color:var(--text)}\n.fpcal .up-d b{font-size:.98rem;font-weight:700;color:var(--text)}\n.fpcal .up-d.today b{color:var(--accent2)}\n.fpcal .up-d span{font-size:.84rem;font-weight:600;color:var(--text2)}\n.fpcal .ev.up{padding:.48rem .65rem;align-items:center}\n.fpcal .ev.up .t{font-size:.98rem;font-weight:700;color:var(--text);width:3.3rem;padding-top:0}\n.fpcal .ev.up .ti{font-size:.86rem}\n/* 달력 본문 가독성 (2026-11-03) — 평소 근무지 글자 생략 + 범례, 주말 칸 좁게(PC), 날짜 숫자 색, 주간 추가 버튼 포커스·터치 노출 */\n.fpcal .mc .n .dn.sat{color:var(--blue)}\n.fpcal .mc .n .dn.sun{color:var(--red)}\n.fpcal .mfoot{display:flex;align-items:center;gap:.4rem;font-size:.74rem;color:var(--text2);margin-top:.5rem;line-height:1.4}\n.fpcal .mfoot:empty{display:none}\n.fpcal .mfoot b{font-weight:600;color:var(--text)}\n@container app (min-width: 900px){.fpcal #mgrid{grid-template-columns:repeat(5,minmax(0,1fr)) repeat(2,minmax(0,.62fr))}\n.fpcal .week{grid-template-columns:repeat(5,minmax(0,1fr)) repeat(2,minmax(0,.62fr))}}\n.fpcal .col .add:focus-visible,.fpcal .col:focus-within .add{opacity:1}\n@media (hover: none){.fpcal .col .add{opacity:1}}\n.fpcal .mobile .calnav{padding-right:66px}\n.fpcal .maplink{font-size:.72rem;font-weight:600;color:var(--accent2);text-decoration:underline;text-underline-offset:2px;white-space:nowrap}\n.fpcal .calnav .cnav{margin-left:auto;display:flex;align-items:center;gap:.25rem;min-width:0}\n.fpcal .calnav .cnav .range{flex:none;min-width:6.4em;text-align:center;white-space:nowrap}\n.fpcal .fab{transition:transform .2s ease,opacity .2s ease}\n.fpcal .fab.away{transform:translateY(calc(100% + 30px));opacity:0;pointer-events:none}\n@media (prefers-reduced-motion: reduce){.fpcal .fab{transition:none}}\n.fpcal .shell.fetching main,.fpcal .shell.fetching .mobile{opacity:.55;transition:opacity .2s .2s}\n/* 주간 근무 보드 촘촘하게 (2026-11-03) — 예외 줄이 많은 주에도 짧은 노트북 화면(1366×640)에서 사이드바 안쪽 스크롤이 안 생기게 */\n.fpcal .wb{gap:2px}\n.fpcal .wb-row{padding:.28rem .45rem}\n.fpcal .wb-main{gap:1px}\n.fpcal .wb-team{padding:.3rem .55rem}\n.fpcal .wb-ex{padding:0 .3rem;line-height:1.35}\n.fpcal .wb-ex .av{width:16px;height:16px;font-size:.52rem}\n.fpcal .wb-foot{margin-top:.45rem;padding-top:.45rem}\n.fpcal .sheet .actions.foot{position:sticky;bottom:-1.1rem;margin:.8rem -1.1rem -1.1rem;padding:.7rem 1.1rem;background:var(--surface);border-top:1px solid var(--border);z-index:2}.fpcal .pat{display:grid;gap:.4rem;margin:.1rem 0 .7rem}\n.fpcal .pat .pr{display:flex;align-items:center;gap:.55rem}\n.fpcal .pat .pr>b{flex:none;width:1.5em;font-size:.86rem}\n.fpcal .pat .sub{margin:0;flex:1;display:grid;grid-template-columns:repeat(3,1fr)}\n.fpcal .pat .sub button[aria-pressed=\"true\"]{color:var(--c);border-color:var(--c);background:color-mix(in srgb,var(--c) 14%,transparent)}\n.fpcal .pat .sub button.chg{box-shadow:inset 0 -2px 0 var(--c)}\n.fpcal .setsec{font-size:.92rem;font-weight:700;margin:.1rem 0 .35rem}\n.fpcal .phist{display:grid;gap:.35rem;font-size:.8rem}\n.fpcal .phist .e{display:flex;gap:.5rem;align-items:center;padding:.4rem .6rem;border:1px solid var(--border);border-radius:8px}\n.fpcal .phist .e b{white-space:nowrap}\n.fpcal .phist .e span{flex:1;min-width:0;color:var(--text2)}\n.fpcal .phist .e.now{border-color:color-mix(in srgb,var(--accent2) 60%,transparent)}\n.fpcal .phist .e .btn{padding:.2rem .5rem;font-size:.74rem}\n.fpcal .lnk{color:var(--accent2);text-decoration:underline;font-weight:600;font-size:inherit}\n.fpcal .top #btn-set{display:inline-flex;align-items:center;gap:.15rem}\n.fpcal .top #btn-set .ic{font-size:1.05rem;line-height:1}\n@container app (max-width: 360px){.fpcal .top{gap:.35rem}.fpcal .top #btn-set,.fpcal .top #btn-push{padding:.42rem .5rem}}\n@container app (min-width: 900px){.fpcal .top{padding:.5rem 0 .7rem}\n.fpcal .app{padding-bottom:0}\n.fpcal .layout{grid-template-columns:clamp(300px,20vw,340px) minmax(0,1fr);margin-top:.25rem;gap:1.5rem}\n.fpcal #mgrid{grid-template-rows:auto;grid-auto-rows:minmax(80px,1fr);min-height:var(--fit-h,0px);gap:6px}\n.fpcal #mgrid .mc{padding:.45rem .55rem;border-radius:10px;gap:3px}\n.fpcal .week{gap:8px}\n.fpcal #mgrid .mc{min-height:0;overflow:hidden;contain:size}\n.fpcal #mgrid .mc>*{flex-shrink:0}\n.fpcal .week{min-height:var(--fit-h,0px)}\n.fpcal .side{height:var(--fit-h,auto);max-height:var(--fit-h,calc(100vh - 94px))}\n.fpcal .demo{display:none}\n.fpcal #mgrid .mc .n{font-size:.86rem}\n.fpcal #mgrid .mc .tloc{font-size:.66rem}\n.fpcal #mgrid .mc .li{font-size:.72rem;line-height:1.35}\n.fpcal #mgrid .mc .more{font-size:.7rem;font-weight:600}}\n.fpcal .top .appnav{display:flex;align-items:center;margin-right:auto;min-width:0}\n.fpcal .top .appright{display:flex;align-items:center;gap:.5rem}\n@media (max-width: 899px){.fpcal .top .appright,.fpcal .top .app-brand-title{display:none!important}}\n@container app (min-width: 900px){.fpcal .top .appnav{margin-right:.6rem}}\n";

export function CalendarPage(props) {
  const ref = useRefCal(null);
  const ctl = useRefCal(null);
  const [slots, setSlots] = useStateCal(null);
  useEffectCal(() => {
    ctl.current = mountCalendar(ref.current, props);
    setSlots({ nav: ref.current.querySelector('#cal-appnav'), right: ref.current.querySelector('#cal-appright') });
    return () => ctl.current?.destroy();
  }, []);
  // 폭·바깥 여백은 워크룸 목록과 같다(index.html #root) — 화면을 오갈 때 제목·탭 위치가 튀지 않게 (2026-11-04)
  useEffectCal(() => { ctl.current?.setContext(props); }, [props.teamMembers, props.projects, props.currentMember]);
  return (
    <>
      <style>{CAL_CSS}</style>
      <div ref={ref} className="fpcal" />
      {slots?.nav && props.appNav && ReactDOM.createPortal(props.appNav, slots.nav)}
      {slots?.right && props.appRight && ReactDOM.createPortal(props.appRight, slots.right)}
    </>
  );
}

// 워크룸 첫 화면 '오늘' 요약 (2026-11-04) — 캘린더 판단 코드(근무지·휴가·일정)를 화면 없이 돌려 결과(digest)만 받는다.
//   규칙을 두 벌로 두지 않으려고 mountCalendar 를 headless 로 쓴다. 나갈 때 캐시를 남겨 캘린더를 열면 바로 보인다.
let TODAY_DIGEST = null;   // 다시 돌아왔을 때 카드가 바로 보이게(스크롤 복원이 어긋나지 않게) 마지막 요약을 기억
export function CalendarToday(props) {
  const [d, setD0] = useStateCal(() => TODAY_DIGEST && Date.now() - TODAY_DIGEST.at < 30*60000 ? TODAY_DIGEST.d : null);
  const setD = v => { TODAY_DIGEST = { d:v, at:Date.now() }; setD0(v); };
  const ctl = useRefCal(null);
  useEffectCal(() => {
    ctl.current = mountCalendar(document.createElement('div'), { ...props, headless:true, onDigest:setD });
    return () => ctl.current?.destroy();
  }, []);
  useEffectCal(() => { ctl.current?.setContext(props); }, [props.teamMembers, props.projects, props.currentMember]);
  if (!d) return null;
  const open = () => props.onOpen?.(d.k);
  const chip = (txt, color, key, strong) => (
    <span key={key} style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'0.18rem 0.55rem', borderRadius:20, fontSize:'0.78rem', whiteSpace:'nowrap',
      fontWeight: strong ? 600 : 500, color, border:`1px solid color-mix(in srgb, ${color} 40%, transparent)`, background:`color-mix(in srgb, ${color} 10%, transparent)` }}>{txt}</span>);
  const evs = d.evs.filter(e => !e.done), shown = evs.slice(0, 3), more = evs.length - shown.length;
  return (
    <section className="fade-in cal-today" role="button" tabIndex={0} onClick={open}
      onKeyDown={e => { if (e.key==='Enter' || e.key===' ') { e.preventDefault(); open(); } }}
      aria-label={`${d.today ? '오늘' : d.tomorrow ? '내일' : '다음 근무일'} ${d.date} 근무·일정 요약 — 눌러서 캘린더에서 보기`}
      style={{ marginBottom:'1rem', padding:'0.65rem 0.9rem', borderRadius:10, background:'var(--surface)', border:'1px solid var(--border)', cursor:'pointer',
        display:'flex', flexWrap:'wrap', alignItems:'center', columnGap:14, rowGap:8 }}>
      <span style={{ display:'flex', alignItems:'baseline', gap:6, flexShrink:0 }}>
        <b style={{ fontSize:'0.9rem' }}>{d.today ? '오늘' : d.tomorrow ? '내일' : '다음 근무일'}</b>
        <span style={{ fontSize:'0.78rem', color:'var(--text2)' }} className="tnum">{d.date}</span>
      </span>
      <span style={{ display:'flex', flexWrap:'wrap', gap:6, alignItems:'center', minWidth:0 }}>
        {chip(`${d.team.ic} 팀 ${d.team.name}`, d.team.color, 'team', true)}
        {d.me && chip(`나 · ${d.me.text}`, d.me.color, 'me', true)}
        {d.others.map((o, i) => chip(`${o.name} ${o.text}`, o.color, 'o'+i))}
        {!d.others.length && d.people > 1 && <span style={{ fontSize:'0.78rem', color:'var(--text2)' }}>다른 팀원은 모두 팀 근무지</span>}
      </span>
      <span style={{ display:'flex', flexWrap:'wrap', gap:'4px 12px', alignItems:'center', fontSize:'0.8rem', minWidth:0, flex:'1 1 260px' }}>
        {shown.length ? shown.map((e, i) => (
          <span key={i} style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:'100%', color: e.mine ? 'var(--text)' : 'var(--text2)', fontWeight: e.mine ? 600 : 400 }}>
            <span className="tnum" style={{ color: e.type==='wishket' ? 'var(--yellow)' : e.type==='deadline' ? 'var(--pink, #fd79a8)' : 'var(--blue)', marginRight:5 }}>{e.t}</span>{e.title}
          </span>)) : <span style={{ color:'var(--text2)' }}>{d.evs.length ? '남은 일정 없음' : '일정 없음'}</span>}
        {more > 0 && <span style={{ color:'var(--text2)' }}>외 {more}건</span>}
      </span>
      <span style={{ marginLeft:'auto', fontSize:'0.78rem', color:'var(--accent)', whiteSpace:'nowrap', flexShrink:0 }}>캘린더 ›</span>
    </section>
  );
}

function mountCalendar(root, ctx) {
  // headless: 화면 없이 판단 코드만 돌린다(CalendarToday). 그릴 때마다 ctx.onDigest 로 요약을 넘기고, 알림·서비스 워커는 건드리지 않는다.
  const HEADLESS = !!ctx.headless;
  root.innerHTML = "<div class=\"shell\" id=\"shell\"><div class=\"app\">\n  <header class=\"top\">\n    <div class=\"appnav\" id=\"cal-appnav\"></div>\n    <button class=\"btn\" id=\"btn-today\">오늘</button>\n    <div class=\"nav\" id=\"nav\"><button class=\"arrow\" id=\"prev\" aria-label=\"이전\">‹</button><div class=\"range tnum\" id=\"range\" aria-live=\"polite\"></div><button class=\"arrow\" id=\"next\" aria-label=\"다음\">›</button></div>\n    <div class=\"seg\" role=\"group\" aria-label=\"보기\">\n      <button id=\"v-month\" aria-pressed=\"true\">월</button>\n      <button id=\"v-week\" aria-pressed=\"false\">주</button>\n      <button id=\"v-list\" aria-pressed=\"false\">목록</button>\n    </div>\n    <button class=\"btn\" id=\"btn-set\" aria-label=\"설정\" title=\"설정 (주간 근무 패턴)\"><span class=\"ic\">⚙️</span></button>\n    <button class=\"btn\" id=\"btn-push\" aria-label=\"알림 설정\" title=\"알림 설정\">🔔</button>\n    <button class=\"btn primary\" id=\"btn-add-top\">＋ 추가</button>\n    <div class=\"appright\" id=\"cal-appright\"></div>\n  </header>\n  <div class=\"ro\" id=\"ro-banner\" hidden></div>\n  <div class=\"ro\" id=\"push-down\" role=\"status\" hidden></div>\n  <div class=\"ro\" id=\"hol-warn\" role=\"status\" hidden></div>\n  <div class=\"loading\" id=\"cal-loading\">불러오는 중…</div>\n  <div id=\"cal-body\" hidden>\n  <section class=\"mobile\" id=\"mobile\">\n    <div class=\"wnav\"><button class=\"arrow\" id=\"m-prev\" aria-label=\"5일 전\">‹</button><span class=\"range tnum\" id=\"m-range\"></span><button class=\"arrow\" id=\"m-next\" aria-label=\"5일 후\">›</button></div>\n    <div class=\"strip-vp\" id=\"m-strip\"></div>\n    <section class=\"card mday\" id=\"m-day\"></section>\n    <div class=\"wnav calnav\" style=\"margin-top:.25rem\">\n      <div class=\"seg\" role=\"group\" aria-label=\"달력 보기\"><button id=\"m-vmonth\" aria-pressed=\"true\">월</button><button id=\"m-vweek\" aria-pressed=\"false\">주</button></div>\n      <div class=\"cnav\"><button class=\"arrow\" id=\"m-cprev\" aria-label=\"이전 달\">‹</button><span class=\"range tnum\" id=\"m-crange\" aria-live=\"polite\"></span><button class=\"arrow\" id=\"m-cnext\" aria-label=\"다음 달\">›</button></div>\n    </div>\n    <div class=\"mgrid\" id=\"m-mgrid\"></div><p class=\"mfoot\" id=\"m-mfoot\"></p>\n    <div class=\"agenda\" id=\"m-week\"></div>\n  </section>\n  <div class=\"layout\">\n    <aside class=\"side\">\n      <div class=\"seg full stabs\" role=\"group\" aria-label=\"사이드바 보기\"><button id=\"s-today\" aria-pressed=\"true\">오늘</button><button id=\"s-week\" aria-pressed=\"false\">주간 근무</button><button id=\"s-up\" aria-pressed=\"false\">다가오는 미팅</button></div>\n      <section class=\"card mday\" id=\"todaycard\"></section>\n      <section class=\"card\" id=\"weekboard\"></section>\n      <section class=\"card\" id=\"upcard\"></section>\n    </aside>\n    <main style=\"min-width:0\">\n      <div class=\"month on\" id=\"monthview\"><div class=\"mgrid\" id=\"mgrid\"></div><p class=\"mfoot\" id=\"mfoot\"></p></div>\n      <div id=\"weekview\" style=\"display:none\"><div class=\"week\" id=\"week\"></div></div>\n      <div class=\"agenda\" id=\"listview\"></div>\n    </main>\n  </div>\n  <p class=\"demo\"><button type=\"button\" id=\"log-open\">변경 기록 보기</button></p>\n  </div>\n</div></div>\n<button class=\"fab\" id=\"fab\" aria-label=\"일정 추가\">＋</button>\n<div class=\"ovl\" id=\"ovl\" hidden><div class=\"sheet\" id=\"sheet\" role=\"dialog\" aria-modal=\"true\" tabindex=\"-1\"></div></div>\n<div class=\"toast\" id=\"toast\" hidden></div>";
  // 데이터 계층을 먼저 선언 — 엔진의 최상위 코드가 on()·T 등을 바로 쓴다
  // ───────── Supabase 연결 ─────────
  const sb = ctx.supabase;
  const T = { routines:'team_work_routines', team:'team_work_overrides', member:'member_work_overrides', leaves:'team_leaves', events:'calendar_events', holidays:'calendar_holidays' };
  let memberByUser = {}, loaded = false, setupNeeded = false, busy = false;
  const kstFmt = new Intl.DateTimeFormat('sv-SE', { timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' });
  // timestamptz → 'YYYY-MM-DDTHH:MM' (한국 시간)
  const toKst = iso => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : kstFmt.format(d).replace(' ', 'T'); };
  const actorOf = uid => uid ? (memberByUser[uid] || 'u:' + uid.slice(0,8)) : null;
  const edited = r => r.updated_at && r.created_at && (new Date(r.updated_at) - new Date(r.created_at) > 2000);
  const hm = t => t ? String(t).slice(0,5) : undefined;
  const MAP = {
    routine: r => ({ id:r.id, from:r.valid_from, days:r.days, by:actorOf(r.created_by), at:toKst(r.created_at) }),
    team:    r => ({ id:r.id, date:r.work_date, loc:r.loc, branch:r.branch||'', note:r.note||'', by:actorOf(r.updated_by||r.created_by), at:toKst(r.updated_at) }),
    member:  r => ({ id:r.id, person:r.member_id, date:r.work_date, loc:r.loc, branch:r.branch||'', note:r.note||'', by:actorOf(r.updated_by||r.created_by), at:toKst(r.updated_at) }),
    leave:   r => ({ id:r.id, person:r.member_id, from:r.from_date, to:r.to_date, kind:r.kind, note:r.note||'', by:actorOf(r.created_by), at:toKst(r.created_at),
                     editedBy: edited(r) ? actorOf(r.updated_by) : undefined, editedAt: edited(r) ? toKst(r.updated_at) : undefined }),
    event:   r => ({ id:r.id, type:r.type, kind:r.kind||undefined, title:r.title, date:r.event_date, allday:!!r.all_day, start:hm(r.start_time), end:hm(r.end_time),
                     mt:r.meeting_type||undefined, place:r.place||'', people:r.people||[], note:r.note||'', repeat:r.repeat||undefined, until:r.repeat_until||undefined,
                     skipHoliday:r.skip_holiday!==false, exdates:r.exdates||[], parent:r.parent_id||undefined, project:r.project_slug||undefined, autoOut:!!r.auto_out,
                     by:actorOf(r.created_by), at:toKst(r.created_at), editedBy: edited(r) ? actorOf(r.updated_by) : undefined, editedAt: edited(r) ? toKst(r.updated_at) : undefined }),
  };
  // 화면 값 → calendar_events 행
  const eventRow = f => ({ type:f.type, kind:f.kind||null, title:f.title, event_date:f.date, all_day:!!f.allday,
    start_time: f.allday ? null : (f.start||null), end_time: f.allday ? null : (f.end||null), meeting_type:f.mt||null, place:f.place||null,
    people:f.people||[], note:f.note||null, repeat:f.repeat||null, repeat_until:f.until||null, skip_holiday:f.skipHoliday!==false,
    exdates:f.exdates||[], parent_id:f.parent||null, project_slug:f.project||null, auto_out:!!f.autoOut });
  const missing = e => e && (e.code==='42P01' || e.code==='PGRST205' || /does not exist|schema cache/i.test(e.message||''));
  // ───────── 읽는 기간 (2026-11-03) ─────────
  // 날짜가 있는 4개 테이블은 기간을 정해 읽는다: 처음엔 오늘 -100일 ~ +200일, 화면이 그 밖으로 가면 넓혀서 다시 읽음.
  // 주간 패턴·공휴일은 양이 적어 전부. 매주 반복 일정은 시작일이 기간 앞이어도 기간 안에 회차가 있으면 포함.
  // span = 지금 목표 기간, have = 실제로 다 읽은 기간. 기간이 바뀐 사이에 끝난 옛 읽기 결과는 버린다(좁은 결과가 덮어쓰지 않게).
  let span = null, have = null, spanJob = Promise.resolve(false);
  const initSpan = () => ({ from: key(addDays(TODAY, -100)), to: key(addDays(TODAY, 200)) });
  // 테이블마다 요청 번호를 매겨 가장 나중에 보낸 읽기 결과만 반영 — 늦게 도착한 옛 읽기가 그 뒤 실시간 갱신을 덮어쓰지 않게 (2026-11-03)
  const seq = {};
  const ranged = (t, q, fn) => async () => { const r = span, my = (seq[t] = (seq[t] || 0) + 1); const { data, error } = await q(r); if (error) throw error; if (my !== seq[t] || r !== span || destroyed) return; fn(data); };
  const LOADERS = {
    [T.routines]: async () => { const { data, error } = await sb.from(T.routines).select('*').order('valid_from'); if (error) throw error; ROUTINES = data.map(MAP.routine); },
    [T.team]:     ranged(T.team, r => sb.from(T.team).select('*').gte('work_date', r.from).lte('work_date', r.to), d => { teamOverrides = d.map(MAP.team); }),
    [T.member]:   ranged(T.member, r => sb.from(T.member).select('*').gte('work_date', r.from).lte('work_date', r.to), d => { personOverrides = d.map(MAP.member); }),
    [T.leaves]:   ranged(T.leaves, r => sb.from(T.leaves).select('*').is('deleted_at', null).lte('from_date', r.to).gte('to_date', r.from), d => { leaves = d.map(MAP.leave); }),
    [T.events]:   ranged(T.events, r => sb.from(T.events).select('*').is('deleted_at', null).lte('event_date', r.to)
                    .or(`event_date.gte.${r.from},and(repeat.not.is.null,or(repeat_until.is.null,repeat_until.gte.${r.from}))`), d => { manual = d.map(MAP.event); }),
    [T.holidays]: async () => { const { data, error } = await sb.from(T.holidays).select('holiday_date,name'); if (error) throw error; HOLIDAYS = Object.fromEntries(data.map(h => [h.holiday_date, h.name])); holidayWarn(); },
  };
  async function reload(...tables){ await Promise.all(tables.map(t => LOADERS[t]())); render(); }
  async function loadAll(){
    if (!span) span = initSpan();
    const r = span;
    try { await Promise.all(Object.values(LOADERS).map(f => f())); setupNeeded = false; if (r === span) have = r; }
    catch (e) { if (missing(e)) setupNeeded = true; else { console.warn('캘린더 로드 실패:', e); if (!destroyed) toast(friendly(e)); } }
    if (destroyed) return;
    loaded = true; $('cal-loading').hidden = true; $('cal-body').hidden = setupNeeded; render();
  }
  // a~b 가 읽은 기간 밖이면 넓혀서 다시 읽는다. 넓힐 때는 그 방향으로 여유(앞 3달·뒤 6달)를 더 잡아 자주 읽지 않게.
  const covered = (a, b) => !!have && a >= have.from && b <= have.to;
  let destroyed = false, spanFailAt = 0;   // 실패하면 10초 동안은 다시 묻지 않음(오프라인에서 ‹ › 마다 요청·오류 알림이 쌓이지 않게)
  function ensureSpan(a, b){
    if (covered(a, b) || setupNeeded) return Promise.resolve(false);
    spanJob = spanJob.catch(() => false).then(async () => {
      if (covered(a, b) || destroyed) return false;
      const base = have || span || initSpan();
      const next = { from: a < base.from ? key(addDays(parse(a), -92)) : base.from, to: b > base.to ? key(addDays(parse(b), 183)) : base.to };
      span = next; $('shell')?.classList.add('fetching');
      try { await Promise.all([T.team, T.member, T.leaves, T.events].map(t => LOADERS[t]())); if (span === next) have = next; spanFailAt = 0; return true; }
      catch (e) { console.warn('캘린더 기간 읽기 실패:', e); spanFailAt = Date.now(); if (!destroyed) toast(friendly(e)); return false; }
      finally { $('shell')?.classList.remove('fetching'); }
    });
    return spanJob;
  }
  const friendly = e => e?.code==='23P01' ? '같은 기간에 이미 등록된 휴가가 있어요'
    : e?.code==='23505' ? '방금 다른 사람이 같은 날을 먼저 저장했어요. 화면을 확인하고 다시 해 주세요'
    : e?.code==='23514' ? '입력값을 다시 확인해 주세요'
    : e?.code==='42501' ? '권한이 없어요. 다시 로그인해 주세요'
    : /Failed to fetch|NetworkError/i.test(e?.message||'') ? '네트워크 연결을 확인해 주세요'
    : (e?.message || '저장하지 못했어요');
  async function db(fn){ const { data, error } = await fn(); if (error) throw error; return data; }
  // 쓰기 한 번에 하나만(연타 방지). 실패하면 알림만 띄우고 입력창은 그대로 둔다.
  async function run(task){ if (busy) return false; busy = true; try { await task(); return true; } catch (e) { console.warn(e); toast(friendly(e)); return false; } finally { busy = false; } }
  function renderBanner(){
    const b = $('ro-banner');
    const msg = setupNeeded ? '캘린더 DB가 아직 준비되지 않았습니다. 마이그레이션(20261030120000_team_calendar.sql) 적용 후 새로고침하세요.'
      : !ME ? '로그인한 계정이 팀원과 연결되어 있지 않아 보기만 할 수 있습니다. 워크룸 메뉴의 팀 관리에서 계정을 연결하세요.' : '';
    b.hidden = !msg; b.textContent = msg;
    $('btn-add-top').hidden = !ME || setupNeeded; $('nav').hidden = setupNeeded; $('fab').hidden = !ME || setupNeeded;
  }
  function scrollToTop(){ const y = root.getBoundingClientRect().top + window.scrollY - 8; window.scrollTo({ top: Math.max(0, y), behavior:'smooth' }); }
  const cleanups = [];
  const on = (t, ev, fn, opt) => { t.addEventListener(ev, fn, opt); cleanups.push(() => t.removeEventListener(ev, fn, opt)); };
  // 워크룸 쪽 데이터(팀원·프로젝트·로그인 사용자) 반영
  function setContext(c){
    const nextMap = Object.fromEntries((c.teamMembers||[]).filter(m => m.user_id).map(m => [m.user_id, m.id]));
    const mapChanged = JSON.stringify(nextMap) !== JSON.stringify(memberByUser);
    memberByUser = nextMap;
    PEOPLE = (c.teamMembers||[]).filter(m => m.is_active !== false).map(m => ({ id:m.id, name:m.name, role:'' }));
    ME = c.currentMember?.id || null;
    const secured = c.securedStatuses || [];
    const now = Date.now();
    WORKROOM = (c.projects||[]).filter(p => p.meeting_at && toKst(p.meeting_at)).map(p => ({
      slug:p.slug, title:p.title || p.slug, meeting_at:toKst(p.meeting_at), meeting_type:p.meeting_type || 'video',
      main:p.assigned_main || null, sub:p.assigned_sub || null,
      status: p.current_status==='interview' && new Date(p.meeting_at).getTime() > now ? 'interview' : 'meeting_done',
      client: c.isDirect?.(p) ? '직거래' : '위시켓' }));
    PROJECTS = (c.projects||[]).filter(p => secured.includes(p.current_status)).map(p => ({ slug:p.slug, title:p.title || p.slug }));
    if (mapChanged && loaded && !setupNeeded) loadAll(); else render();
  }
  // ───────── 데이터 (Supabase 에서 채움) ─────────
  let PEOPLE = [], ME = null, WORKROOM = [], PROJECTS = [];
  const LOC = {
    cityhall:{ label:'시청역',   full:'패스트파이브 시청역2호점', color:'var(--blue)',    kind:'office', ic:'🏢' },
    forest:  { label:'서울숲',   full:'패스트파이브 서울숲',     color:'var(--accent2)', kind:'office', ic:'🏢' },
    // other: 직접 입력한 장소(다른 지점·미팅 장소로 바로 출근 등, branch 에 장소명). 2026-11-04 '기타 지점' → '다른 장소'로 넓힘
    other:   { label:'다른 장소', full:'다른 장소 (직접 입력)',   color:'var(--teal)',    kind:'office', ic:'📍' },
    home:    { label:'재택',     full:'재택근무',                 color:'var(--green)',   kind:'remote', ic:'🏠' },
    out:     { label:'외근',     full:'외근 · 고객사 방문',       color:'var(--yellow)',  kind:'out',    ic:'🚕' },
    off:     { label:'연차',     full:'연차',                     color:'var(--red)',     kind:'leave' },
    am:      { label:'오전반차', full:'오전 반차 (오후 출근)',     color:'var(--red)',     kind:'leave' },
    pm:      { label:'오후반차', full:'오후 반차 (오전 근무)',     color:'var(--red)',     kind:'leave' },
    sick:    { label:'병가',     full:'병가',                     color:'var(--red)',     kind:'leave' },
  };
  const EVTYPE = {
    wishket: { label:'수주 미팅', color:'var(--yellow)' },
    meeting: { label:'미팅',     color:'var(--blue)' },
    internal:{ label:'사내',     color:'var(--accent2)' },
    deadline:{ label:'마감',     color:'var(--pink)' },
    other:   { label:'기타',     color:'var(--teal)' },
    leave:   { label:'휴가',     color:'var(--red)' },
    holiday: { label:'공휴일',   color:'var(--red)' },
  };
  const KIND = {
    sales:    { label:'수주 상담',  desc:'직거래·소개 건 첫 미팅' },
    bid:      { label:'입찰·제안',  desc:'설명회, 제안 발표, PT' },
    kickoff:  { label:'킥오프',     desc:'계약 후 착수 회의' },
    req:      { label:'요구사항',   desc:'기획·화면 협의' },
    review:   { label:'중간보고',   desc:'진행 점검, 검수' },
    delivery: { label:'납품·교육',  desc:'오픈, 인수인계' },
    maint:    { label:'유지보수',   desc:'CS, 장애, 추가 요청' },
    partner:  { label:'협력사',     desc:'외주·디자인·인프라' },
    etc:      { label:'기타',       desc:'' },
  };
  const MT = { video:'화상', inperson:'대면', phone:'전화' };
  // 캘린더 미팅의 방식 문구: 대면이면 어디서 하는지(외근 표시 = 외부)까지 — '대면 · 우리 사무실' / '대면 · 외근'
  const mtText = e => !e.mt ? '' : e.mt==='inperson' && e.type==='meeting' ? `대면 · ${e.autoOut?'외근':'우리 사무실'}` : MT[e.mt];
  let ROUTINES = [], HOLIDAYS = {}, manual = [], leaves = [], teamOverrides = [], personOverrides = [];
  // 패턴이 하나도 없을 때(마이그레이션 직후 등) 쓰는 기본값: 월~금 시청역
  const DEFAULT_ROUTINE = { from:'1970-01-01', days:{ 1:'cityhall', 2:'cityhall', 3:'cityhall', 4:'cityhall', 5:'cityhall' } };

  // ───────── 유틸 ─────────
  const pad = n => String(n).padStart(2,'0');
  // 손으로 친 값 다듬기: '930'→09:30, '14'→14:00, '2:5'→02:05. 못 읽으면 원래 값으로
  const normT = v => { v = String(v||'').trim().replace(/[^0-9:]/g, ''); let h, m;
    if (v.includes(':')) [h, m] = v.split(':').map(Number); else if (v.length <= 2) { h = +v; m = 0; } else { h = +v.slice(0, -2); m = +v.slice(-2); }
    return Number.isInteger(h) && Number.isInteger(m||0) && h>=0 && h<24 && (m||0)>=0 && (m||0)<60 ? `${pad(h)}:${pad(m||0)}` : null; };
  const key = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const parse = k => { const [y,m,d] = k.split('-').map(Number); return new Date(y,m-1,d); };
  const addDays = (d,n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
  const monday = d => { const x = new Date(d); const w = (x.getDay()+6)%7; x.setDate(x.getDate()-w); x.setHours(0,0,0,0); return x; };
  const WD = ['일','월','화','수','목','금','토'];
  let TODAY = new Date(); TODAY.setHours(0,0,0,0);
  let TK = key(TODAY);
  const nowIso = () => { const d=new Date(); return `${key(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtAt = iso => { const d = parse(iso.slice(0,10)); return `${d.getMonth()+1}/${d.getDate()} ${iso.slice(11,16)}`; };
  const fmtD = k => { const d=parse(k); return `${d.getMonth()+1}/${d.getDate()} (${WD[d.getDay()]})`; };
  // 퇴사·비활성 팀원이나 팀원과 연결 안 된 계정도 이름이 깨지지 않게
  const P = id => PEOPLE.find(p => p.id===id) || { id: id || '?', name: !id ? '시스템' : String(id).startsWith('u:') ? String(id).slice(2) : '알 수 없음', role:'' };
  const names = ids => ids.map(i=>P(i)?.name).filter(Boolean).join('·');
  const esc = s => String(s??'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const av = (p, cls='') => `<span class="av ${cls} ${p.id===ME?'me':''}" title="${esc(p.name)}">${esc(p.name.slice(1,2)||p.name[0])}</span>`;
  const avs = ids => `<span class="pp">${ids.map(i=>P(i)).filter(Boolean).map(p=>av(p)).join('')}</span>`;
  const uid = () => 'x' + Math.random().toString(36).slice(2,8);
  const isOffDay = k => !!HOLIDAYS[k] || [0,6].includes(parse(k).getDay());
  // 한국어 조사: 받침 있으면 a, 없으면 b
  const josa = (w, a, b) => { const c = String(w).charCodeAt(String(w).length-1); return (c>=0xAC00 && c<=0xD7A3 && (c-0xAC00)%28) ? a : b; };
  const HALF = { am:true, pm:true };
  // 변경 기록은 DB 감사 트리거가 남긴다 (화면은 change_note 로 사람이 읽을 요약만 넘김)
  const toMin = t => { const [h,m]=t.split(':').map(Number); return h*60+m; };
  const overlaps = (a,b) => { if (a.allday||b.allday||!a.start||!b.start) return false; const as=toMin(a.start), ae=a.end?toMin(a.end):as+60, bs=toMin(b.start), be=b.end?toMin(b.end):bs+60; return as<be && bs<ae; };

  const routineAt = k => ROUTINES.filter(r=>r.from<=k).sort((a,b)=>a.from<b.from?1:-1)[0] || ROUTINES[0] || DEFAULT_ROUTINE;
  function teamLoc(k){
    if (isOffDay(k)) return null;
    const ov = teamOverrides.find(o => o.date===k);
    if (ov) return { code:ov.loc, src:'override', note:ov.note, branch:ov.branch, ref:ov };
    const r = routineAt(k); return { code:r.days[parse(k).getDay()] || 'cityhall', src:'routine', ref:r };
  }
  const teamLocName = t => t.code==='other' && t.branch ? t.branch.replace('패스트파이브 ','') : LOC[t.code].label;
  const teamLocFull = t => t.code==='other' && t.branch ? t.branch : LOC[t.code].full;
  // 직접 입력한 장소는 눌러서 지도에서 찾게 (네이버 지도 검색)
  const mapLink = place => place ? `<a class="maplink" href="https://map.naver.com/p/search/${encodeURIComponent(place)}" target="_blank" rel="noopener" title="지도에서 보기">지도</a>` : '';
  // 그날만 정한 팀 근무지에 '평소 ○○'를 붙이던 표시는 뺐다 (2026-11-06 사용자 QA — 평소 근무지는 안 보여 줘도 됨). 그날 근무지만 보인다.
  // 반복 일정이 k 날짜에 열리는지 (건너뛴 회차·종료일·공휴일 건너뜀 반영)
  function occursOn(m, k){
    if ((m.exdates||[]).includes(k)) return false;
    if (m.date===k) return true;
    return m.repeat==='weekly' && m.date<k && (!m.until || k<=m.until) && parse(m.date).getDay()===parse(k).getDay() && !(m.skipHoliday && HOLIDAYS[k]);
  }
  // 대면 미팅 장소가 우리 사무실이면 외근이 아님
  const atOffice = place => !!place && ['패스트파이브','시청역','서울숲','사무실'].some(w => place.includes(w));
  // pid 가 k 날 사무실 밖 대면 미팅에 가는지. 수동 미팅은 '외근 표시' 체크한 것, 위시켓은 대면이면서 장소가 사무실이 아닌 것.
  // 대면 미팅 외근: 시간이 있는 미팅이면 그 시각(at)부터 외근이고 그 전엔 팀 근무지, 종일 미팅이면(at=null) 하루 전체 외근.
  //   여러 건이면 종일이 하나라도 있으면 종일, 아니면 가장 이른 시각 (2026-11-03 — 오전 출근 후 오후 미팅을 하루 외근으로 보던 문제)
  function outMeetingOf(pid, k){
    const hits = [];
    WORKROOM.forEach(w => { if (w.meeting_type==='inperson' && w.meeting_at.slice(0,10)===k && [w.main,w.sub].includes(pid) && !atOffice(w.place)) hits.push({ title:w.title, at:w.meeting_at.slice(11,16), place:w.place||'', people:[w.main,w.sub].filter(Boolean) }); });
    manual.forEach(m => { if (m.type==='meeting' && m.mt==='inperson' && m.autoOut && m.people.includes(pid) && occursOn(m,k)) hits.push({ title:m.title, at: m.allday || !m.start ? null : m.start, place:m.place||'', people:m.people }); });
    if (!hits.length) return null;
    return hits.find(h => h.at===null) || hits.sort((a,b) => a.at.localeCompare(b.at))[0];
  }
  // 그 날 그 사람의 근무지. 우선순위: 종일 휴가 > 직접 고른 근무지 > 대면 미팅 외근 > 팀 근무지. 반차는 근무지를 유지하고 half 로 표시.
  // 직접 고른 근무지가 팀 근무지와 같으면 예외가 아니라 same 으로 봅니다(팀 근무지를 나중에 바꿔도 꼬이지 않음).
  function locOf(pid, k){
    if (isOffDay(k)) return null;
    const lv = leaves.find(l => l.person===pid && l.from<=k && l.to>=k);
    if (lv && !HALF[lv.kind]) return { code:lv.kind, src:'leave', note:lv.note, ref:lv };
    const t = teamLoc(k);
    const ov = personOverrides.find(o => o.person===pid && o.date===k);
    let r;
    if (ov) r = (ov.loc===t.code && (ov.loc!=='other' || (ov.branch||'')===(t.branch||''))) ? { code:t.code, src:'team', same:true, note:ov.note, ref:ov, pinned:true }
                                                                                         : { code:ov.loc, src:'personal', same:false, note:ov.note, branch:ov.branch, ref:ov };
    else { const om = outMeetingOf(pid, k);
      // 시간 있는 미팅: 근무지는 팀 근무지 그대로(출근 인원에 포함) + outAt 시각부터 외근
      r = !om ? { code:t.code, src:'team', same:true }
        : om.at ? { code:t.code, src:'team', same:true, outAt:om.at, outPlace:om.place, note:om.title }
        : { code:'out', src:'meeting', auto:true, note:om.title }; }
    if (lv) r = { ...r, same:false, half:lv.kind, leaveRef:lv, note:[lv.note, r.note].filter(Boolean).join(' · ') };
    return r;
  }
  // 표시용 장소명과 색. 반차면 "오후반차 · 시청역"
  function placeName(l, k){ return l.src==='team' ? teamLocName(teamLoc(k)) : (l.code==='other' && l.branch) ? l.branch.replace('패스트파이브 ','') : LOC[l.code].label; }
  const locText = (l, k) => l.half ? `${LOC[l.half].label} · ${placeName(l,k)}${l.outAt ? ` · ${l.outAt} 외근` : ''}` : l.outAt ? `${placeName(l,k)} · ${l.outAt} 외근` : placeName(l,k);
  const locColor = l => l.half ? 'var(--red)' : l.outAt ? LOC.out.color : LOC[l.code].color;
  // 팀과 다른 점이 있어 따로 보여 줄 사람(근무지가 다르거나, 반차, 시간 있는 미팅으로 도중에 외근)
  const isEx = l => !!l && (!l.same || !!l.outAt);
  // 팀 근무지에 실제로 오는 사람이 없을 때 보일 이름 (2026-11-04 사용자 QA — 3명 모두 다른 곳인데 '시청역'만 보이던 문제)
  //   데이터(팀 근무지)는 그대로 두고 보이는 것만 바꾼다. 반차·시간 있는 미팅은 팀 근무지에 오는 사람으로 센다.
  //   전원 같은 곳 → '전원 재택', 제각각 → '각자 근무', 모두 휴가 → '전원 휴가'. sub = '재택 2 · 서울숲 1'.
  function teamView(k){
    const t = teamLoc(k); if (!t) return null;
    const ls = PEOPLE.map(p => locOf(p.id, k)).filter(Boolean);
    const base = { t, n: ls.filter(l => l.src==='team').length, empty:false, name:teamLocName(t), color:LOC[t.code].color, ic:LOC[t.code].ic, sub:'' };
    if (base.n || !ls.length) return base;
    const away = ls.filter(l => l.src!=='leave'), lv = ls.length - away.length;
    if (!away.length) return { ...base, empty:true, name:'전원 휴가', color:'var(--red)', ic:'🌴' };
    const g = {}; away.forEach(l => { const nm = placeName(l,k); (g[nm] = g[nm] || { nm, c:0, color:locColor(l), code:l.code, branch:l.branch||null }).c++; });
    const gs = Object.values(g).sort((a,b) => b.c-a.c);
    const sub = gs.map(x => `${x.nm} ${x.c}`).concat(lv ? [`휴가 ${lv}`] : []).join(' · ');
    if (gs.length===1) return { ...base, empty:true, one:gs[0], name: lv ? gs[0].nm : `전원 ${gs[0].nm}`, color:gs[0].color, ic:LOC[gs[0].code]?.ic || '📍', sub };
    return { ...base, empty:true, name:'각자 근무', color:'var(--text2)', ic:'👥', sub };
  }
  const emptyTip = v => `팀 근무지 ${teamLocName(v.t)} · 오는 사람 없음${v.sub ? ' · '+v.sub : ''}`;
  const leaveDays = (from, to, kind) => { let n = 0; for (let d=parse(from); key(d)<=to; d=addDays(d,1)) if (!isOffDay(key(d))) n++; return HALF[kind] ? n/2 : n; };
  function rawEventsOf(k){
    const out = [];
    if (HOLIDAYS[k]) out.push({ id:'h'+k, type:'holiday', title:HOLIDAYS[k], allday:true, people:[] });
    // 휴가는 근무일에만 표시 (주말·공휴일 칸에는 안 뜸)
    if (!isOffDay(k)) leaves.forEach(l => { if (l.from<=k && l.to>=k) out.push({ id:l.id, type:'leave', title:`${P(l.person).name} ${LOC[l.kind].label}`, allday:true, people:[l.person], note:l.note, ref:l, kind:l.kind, by:l.by, at:l.at, editedBy:l.editedBy, editedAt:l.editedAt }); });
    WORKROOM.forEach(w => { if (w.meeting_at.slice(0,10)===k) out.push({ id:'w'+w.slug, type:'wishket', title:w.title, start:w.meeting_at.slice(11,16), mt:w.meeting_type, people:[w.main, w.sub].filter(Boolean), place:w.place, done:w.status==='meeting_done', ref:w }); });
    const nowMin = new Date().getHours()*60 + new Date().getMinutes();
    manual.forEach(m => { if (occursOn(m,k)) out.push({ ...m, ref:m, done: m.type==='meeting' && (k<TK || (k===TK && !m.allday && m.start && (m.end ? toMin(m.end) : toMin(m.start)+60) < nowMin)) }); });
    return out.sort((a,b) => (a.allday?0:1)-(b.allday?0:1) || (a.start||'').localeCompare(b.start||''));
  }
  const eventsOf = rawEventsOf; // 보기 필터 제거: 항상 전원·전체 일정

  // ───────── 상태 ─────────
  const defaultBweek = () => key(addDays(monday(TODAY), [0,6].includes(TODAY.getDay()) ? 7 : 0));
  // view: 데스크톱(월/주/목록), mview: 폰 하단 달력(월/주)
  // slide: 폰 5일 카드가 이번 렌더에서 밀려날 일수(+면 왼쪽으로), bweek: 데스크톱 주간 근무 보드의 월요일, dayModal/ret: 날짜 모달과 되돌아갈 날짜
  // side: 데스크톱 사이드바 탭(today | week | up)
  const state = { view:'month', mview:'month', anchor:new Date(TODAY), sel:TK, slide:0, bweek:defaultBweek(), dayModal:null, ret:null, listDays:14, side:'today' };
  const $ = id => root.querySelector('#'+id);

  // 워크룸 '오늘' 요약: 오늘(주말·공휴일이면 다음 근무일)의 팀 근무지·내 근무지·팀과 다른 팀원·일정
  function digest(){
    // 18시가 지나면 다음 근무일을 보여 준다(18시 다음 근무일 안내와 같은 기준)
    let k = new Date().getHours() >= 18 ? key(addDays(TODAY, 1)) : TK; for (let i = 0; isOffDay(k) && i < 30; i++) k = key(addDays(parse(k), 1));
    const t = teamLoc(k), v = teamView(k), d = parse(k);
    const lt = l => l.src==='leave' ? LOC[l.code].label : locText(l, k), lc = l => l.src==='leave' ? 'var(--red)' : locColor(l);
    const mine = ME ? locOf(ME, k) : null;
    return { k, today: k===TK, tomorrow: k===key(addDays(TODAY, 1)), date: `${d.getMonth()+1}월 ${d.getDate()}일 ${WD[d.getDay()]}요일`, people: PEOPLE.length,
      team: v.empty ? { name:v.name, ic:v.ic, color:v.color } : { name:teamLocName(t), ic:LOC[t.code].ic, color:LOC[t.code].color },
      me: mine ? { text: lt(mine), color: mine.same && !mine.outAt ? 'var(--text2)' : lc(mine) } : null,
      others: PEOPLE.filter(p => p.id!==ME).map(p => ({ p, l:locOf(p.id, k) })).filter(x => isEx(x.l)).map(x => ({ name:x.p.name, text:lt(x.l), color:lc(x.l) })),
      evs: rawEventsOf(k).filter(e => e.type!=='holiday' && e.type!=='leave').map(e => ({ t: e.allday || !e.start ? '종일' : e.start, title:e.title, type:e.type,
        mine: !!ME && (e.people||[]).includes(ME), done: !!e.done })) };
  }

  // ───────── 렌더 ─────────
  // 지금 화면들이 보는 날짜 범위(월 달력 6주, 주·목록·5일 카드, 주간 근무 보드, 다가오는 미팅 60일, 날짜 창)
  function neededSpan(){
    const a = state.anchor, ks = [
      key(monday(new Date(a.getFullYear(), a.getMonth(), 1))), key(addDays(monday(new Date(a.getFullYear(), a.getMonth()+1, 0)), 6)),
      key(monday(a)), key(addDays(monday(a), 6)),
      key(addDays(monday(parse(state.sel)), -1)), key(addDays(parse(state.sel), Math.max(state.listDays, 7))),
      state.bweek, key(addDays(parse(state.bweek), 6)), TK, key(addDays(TODAY, 60)) ];
    if (state.dayModal) ks.push(state.dayModal);
    ks.sort(); return [ks[0], ks[ks.length-1]];
  }
  function render(){
    if (!loaded || destroyed) return;
    if (HEADLESS) { ctx.onDigest?.(digest()); return; }
    const [na, nb] = neededSpan(); if (!covered(na, nb) && Date.now() - spanFailAt > 10000) ensureSpan(na, nb).then(ch => { if (ch) render(); });
    renderBanner(); renderHeader(); renderMobile();
    // 데스크톱: 사이드바(오늘 · 주간 근무 · 다가오는 미팅) + 월/주/목록
    // 사이드바는 탭 하나만 보여 줘 안쪽 스크롤 없이 한 화면에 들어오게 한다 (2026-11-03)
    renderDayInto($('todaycard'), TK, true); renderWeekBoard(); renderUpcoming();
    [['today','todaycard'],['week','weekboard'],['up','upcard']].forEach(([s,id]) => { $('s-'+s).setAttribute('aria-pressed', state.side===s); $(id).hidden = state.side!==s; });
    $('weekview').style.display = state.view==='week' ? '' : 'none';
    $('monthview').classList.toggle('on', state.view==='month');
    $('listview').classList.toggle('on', state.view==='list');
    fitHeight();
    if (state.view==='week') renderWeek();
    else if (state.view==='month') { monthGrid($('mgrid')); clampMonth(); }
    else renderList();
    // 날짜 모달이 열려 있으면 내용 갱신(스크롤 유지)
    if (state.dayModal && !$('ovl').hidden) { const sh = $('sheet'), sc = sh.scrollTop, inSheet = sh.contains(document.activeElement) || document.activeElement===sh;
      sh.innerHTML = `<div class="mday">${dayHtml(state.dayModal, true)}</div>`; bindDay(sh, state.dayModal); const x = sh.querySelector('.x'); x.onclick = closeSheet; sh.scrollTop = sc;
      if (inSheet) x.focus({ preventScroll:true }); }
  }
  // 데스크톱: 달력·사이드바를 창 높이에 맞춘다(--fit-h). 전에는 칸 높이가 고정(108px)이라 큰 창에선 아래가 비고 작은 창에선 스크롤이 생겼다.
  function fitHeight(){
    const sh = $('shell'), lay = sh.querySelector('.layout');
    if (!root.classList.contains('wide') || !lay) { sh.style.removeProperty('--fit-h'); return; }
    const pb = parseFloat(getComputedStyle(document.getElementById('root') || document.body).paddingBottom) || 0;
    const top = lay.getBoundingClientRect().top + window.scrollY;
    sh.style.setProperty('--fit-h', Math.max(480, Math.floor(window.innerHeight - top - pb)) + 'px');
  }
  // 월 칸에 들어가는 만큼만 일정 줄을 보이고 나머지는 '+N'
  function clampMonth(){
    if (!root.classList.contains('wide')) return;
    $('mgrid').querySelectorAll('.mc').forEach(c => { const lis = [...c.querySelectorAll('.li')], more = c.querySelector('.more'); if (!more) return;
      const total = Number(more.dataset.n); lis.forEach(x => x.hidden = false); more.hidden = true;
      if (!lis.length) return;
      const limit = c.getBoundingClientRect().bottom - 4; let shown = lis.length;
      if (lis[shown-1].getBoundingClientRect().bottom <= limit && total <= lis.length) return;
      more.hidden = false;
      while (shown > 0 && (lis[shown-1].getBoundingClientRect().bottom > limit - more.getBoundingClientRect().height - 2 || false)) { lis[--shown].hidden = true; }
      more.textContent = `+${total - shown}건`; });
  }
  let fitT = 0; const onResize = () => { cancelAnimationFrame(fitT); fitT = requestAnimationFrame(() => { if (root.classList.contains('wide')) render(); }); };
  on(window, 'resize', onResize);
  // ───────── 폰: 5일 카드(선택일 -1 ~ +3일) → 선택일 카드 → 월/주 달력 ─────────
  // 날짜를 고르면(카드 누르기·달력·오늘) 그 날이 두 번째 카드로 온다. 좌우로 끌거나 ‹ › 는 둘러보기만 하고 선택 날짜는 그대로 (2026-11-04 사용자 QA —
  //   전에는 끌어서 놓으면 끈 칸 수만큼 선택 날짜가 바뀌어 아래 카드·달력까지 따라 바뀌었다).
  const stripStart = () => addDays(parse(state.sel), -1);
  const dayDiff = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
  function selectDay(k){
    state.slide = dayDiff(state.sel, k);
    state.sel = k; state.anchor = parse(k); render();
  }
  // ‹ › : 5일씩 둘러보기(선택 날짜는 그대로)
  const stepStrip = dir => { const sc = $('m-strip').querySelector('.strip'); if (!sc) return;
    sc.scrollBy({ left: dir * 5 * stripPitch(sc), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); };
  function renderMobile(){
    renderStrip($('m-strip')); state.slide = 0;
    renderDayInto($('m-day'), state.sel);
    ['month','week'].forEach(v => $('m-v'+v).setAttribute('aria-pressed', state.mview===v));
    const isM = state.mview==='month';
    $('m-mgrid').style.display = isM ? '' : 'none'; $('m-mfoot').hidden = !isM; $('m-week').classList.toggle('on', !isM);
    $('m-cprev').setAttribute('aria-label', isM?'이전 달':'지난주'); $('m-cnext').setAttribute('aria-label', isM?'다음 달':'다음주');
    if (isM) { $('m-crange').textContent = `${state.anchor.getFullYear()}년 ${state.anchor.getMonth()+1}월`; monthGrid($('m-mgrid'), true); }
    else { const ws = monday(state.anchor), we = addDays(ws,6); $('m-crange').textContent = `${ws.getMonth()+1}/${ws.getDate()} – ${we.getMonth()+1}/${we.getDate()}`;
      $('m-week').innerHTML = agendaDays(ws, 7); bindAgenda($('m-week'));
      $('m-week').querySelectorAll('.ag-h .d').forEach(el => el.onclick = () => { selectDay(el.closest('[data-k]').dataset.k); scrollToTop(); }); }
  }
  const fmtSpan = (s, e) => s.getFullYear()!==e.getFullYear() ? `${s.getFullYear()}년 ${s.getMonth()+1}월 ${s.getDate()}일 – ${e.getFullYear()}년 ${e.getMonth()+1}월 ${e.getDate()}일`
    : s.getMonth()!==e.getMonth() ? `${s.getFullYear()}년 ${s.getMonth()+1}월 ${s.getDate()}일 – ${e.getMonth()+1}월 ${e.getDate()}일`
    : `${s.getFullYear()}년 ${s.getMonth()+1}월 ${s.getDate()}–${e.getDate()}일`;
  function renderHeader(){
    ['month','week','list'].forEach(v => $('v-'+v).setAttribute('aria-pressed', state.view===v));
    // 제목은 ‹ › 사이 고정 폭 칸(보기마다 폭이 다름 — data-v)에 가운데 정렬해 같은 보기 안에서는 › 위치가 움직이지 않게.
    // 기간 표기는 늘 연도부터: '2026년 11월 2–8일' · '2026년 11월 30일 – 12월 6일' · '2026년 12월 28일 – 2027년 1월 3일'
    // 주 보기 제목은 실제 주간 달력(renderWeek)과 같은 선택일 기준
    const r = $('range'); r.dataset.v = state.view;
    if (state.view==='week') { const s = monday(parse(state.sel)); r.textContent = fmtSpan(s, addDays(s,6)); }
    else if (state.view==='month') r.textContent = `${state.anchor.getFullYear()}년 ${state.anchor.getMonth()+1}월`;
    else { const s = parse(state.sel); r.textContent = fmtSpan(s, addDays(s, state.listDays-1)); }
    r.setAttribute('aria-label', r.textContent);
  }
  function teamBanner(k){
    const t = teamLoc(k);
    if (!t) return `<div class="teamloc" style="color:var(--text2);border-color:var(--border)"><span class="ic">－</span><span class="tx"><span class="l1">팀 근무지</span><span class="l2">휴무</span></span></div>`;
    const v = teamView(k);
    if (v.empty) return `<div class="teamloc" style="color:${v.color};border-color:color-mix(in srgb,${v.color} 45%,transparent);background:color-mix(in srgb,${v.color} 9%,transparent)">
      <span class="ic">${v.ic}</span><span class="tx"><span class="l1">팀 근무지 ${esc(teamLocName(t))} · 오는 사람 없음</span><span class="l2">${esc(v.name)}</span>${v.sub?`<span class="l3">${esc(v.sub)}</span>`:''}</span>
      <button class="edit" data-tl="${k}">변경</button></div>`;
    const L = LOC[t.code];
    const l3 = t.note ? esc(t.note) : t.src==='override' ? `${esc(P(t.ref.by).name)} 변경 · ${fmtAt(t.ref.at)}` : '';   // 주간 패턴대로인 날은 셋째 줄 없음 (2026-11-04)
    return `<div class="teamloc" style="color:${L.color};border-color:color-mix(in srgb,${L.color} 45%,transparent);background:color-mix(in srgb,${L.color} 9%,transparent)">
      <span class="ic">${L.ic}</span><span class="tx"><span class="l1">팀 근무지</span><span class="l2">${esc(teamLocFull(t))}${t.code==='other' ? ' '+mapLink(t.branch) : ''}</span>${l3?`<span class="l3">${l3}</span>`:''}</span>
      <button class="edit" data-tl="${k}">변경</button></div>`;
  }
  // 사람별 위치 칩: 팀과 같으면 실제 장소명을 흐린 칩으로, 다르면(반차 포함) 색 칩으로
  function locChip(l, k){ if (!l) return `<span class="loc same"><i></i>휴무</span>`;
    if (l.same && !l.outAt) { const t = teamLoc(k); return `<span class="loc same editable" title="팀 근무지와 같음 · 눌러서 이 사람만 바꾸기"><i style="background:${LOC[t.code].color}"></i>${esc(teamLocName(t))}</span>`; }
    const c = locColor(l); return `<span class="loc editable" style="color:${c};border-color:color-mix(in srgb,${c} 45%,transparent);background:color-mix(in srgb,${c} 12%,transparent)"><i></i>${esc(locText(l,k))}${l.auto?' · 미팅':''}</span>`; }
  function peopleRows(k){
    return PEOPLE.map(p => { const l = locOf(p.id,k);
      return `<div class="prow">${av(p)}<span class="nm">${esc(p.name)}${p.role?`<small>${esc(p.role)}</small>`:''}</span>${locChip(l,k)}<span class="note">${esc(l?.note||'')}${l?.src==='personal' && l.code==='other' ? ' '+mapLink(l.branch) : ''}</span></div>`; }).join('');
  }
  function bindPeopleRows(root, k){ root.querySelectorAll('.loc.editable').forEach((el,i) => el.onclick = () => openAdd('loc', { person:PEOPLE[i].id, date:k, scope:'person' })); root.querySelectorAll('[data-tl]').forEach(b => b.onclick = () => openAdd('loc', { date:b.dataset.tl, scope:'team' })); }
  // 다가오는 미팅: 오늘부터 60일 안의 회차를 실제로 펼쳐서(반복 미팅 포함) 앞에서 n개
  function upcomingMeetings(n=4){
    const out = [];
    for (let i=0; i<60 && out.length<n; i++){ const k = key(addDays(TODAY,i));
      rawEventsOf(k).filter(e => (e.type==='wishket' || e.type==='meeting') && !e.done).forEach(e => out.push({ k, t:e.start||'종일', title:e.title, people:e.people,
        tag: e.type==='wishket' ? '수주' : (KIND[e.kind]?.label||'미팅'), place: e.type==='wishket' ? (e.place||MT[e.mt]) : [mtText(e), e.place].filter(Boolean).join(' · ') })); }
    return out.slice(0,n);
  }
  // 내 근무 선택: [팀 근무지 출근 | 외근 | 재택 | 다른 곳…]. 오늘 이후 평일에만. 팀 근무지는 그대로 두고 내 근무지만 바꿉니다.
  // 반차인 날은 나머지 반나절 근무지를, 대면 미팅이 있는 날은 자동 외근을 보여 줍니다.
  function myStatus(k){
    if (isOffDay(k) || k<TK) return '';
    const l = locOf(ME,k), t = teamLoc(k), when = k===TK ? '오늘' : fmtD(k);
    if (l.src==='leave') return `<div class="mystat"><span class="h">${when} 내 근무</span><div class="leave">${LOC[l.code].label}${l.note?' · '+esc(l.note):''}</div></div>`;
    const head = l.half ? `${when} ${l.half==='pm'?'오전':'오후'} 근무지` : `${when} 내 근무`;
    const sub = l.half ? `${LOC[l.half].label}라 나머지 반나절만 정합니다` : l.outAt ? `${l.outAt} 대면 미팅(${esc(l.note)})부터 외근으로 표시됩니다` : l.auto ? `종일 대면 미팅(${esc(l.note)})이 있어 자동으로 외근입니다` : '팀 근무지는 그대로, 나만 바뀝니다';
    const cur = l.src==='team' ? 'team' : l.code;
    const opts = [['team', t.code==='home' ? '재택' : `${teamLocName(t)} 출근`, LOC[t.code].color]];
    if (t.code!=='home') opts.push(['home','재택','var(--green)']);
    // 시간 있는 외부 미팅이 있는 날: 그곳으로 아침에 바로 가면 하루 종일 그 장소로 (개인 '다른 장소' = 미팅 외근보다 우선, 서버도 같은 규칙)
    if (l.outAt) opts.push(['direct','미팅 장소로 바로 출근',LOC.other.color]);
    // 외근은 고르는 선택지에서 뺐다(→ '다른 곳…'에서 장소를 적음, 2026-11-05). 미팅 자동 외근·예전 외근 기록은 상태로만 보인다
    if (!opts.some(o=>o[0]===cur)) opts.push([cur, cur==='out' ? '외근' : `${placeName(l,k)} 출근`, LOC[cur].color]);
    opts.push(['more','다른 곳…','var(--text)']);
    return `<div class="mystat"><span class="h">${head} <small>· ${sub}</small></span><div class="opts" role="group" aria-label="${head}">${opts.map(([c,lb,col])=>`<button data-q="${c}" style="--c:${col}" aria-pressed="${c===cur}">${esc(lb)}</button>`).join('')}</div></div>`;
  }
  function bindQuick(root,k){ root.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { const c=b.dataset.q, t=teamLoc(k), when = k===TK?'오늘':fmtD(k);
    if (c==='more') return openAdd('loc', { person:ME, date:k, scope:'person' });
    if (c==='direct') return openDirect(k);
    if (b.getAttribute('aria-pressed')==='true' || !ME) return;
    const om = outMeetingOf(ME,k), auto = om && !om.at;   // 하루 전체 자동 외근(종일 미팅)일 때만 '사무실에 있음'을 따로 기록
    const lb = c==='team' ? (t.code==='home' ? '재택' : `${teamLocName(t)} 출근`) : LOC[c].label;
    // 팀 근무지로 돌아갈 때 대면 미팅 자동 외근이 있으면 '사무실에 있음'을 직접 기록해 둡니다.
    const keep = c==='team' ? !!auto : !(c==='out' && auto);
    const note = `${fmtD(k)} ${P(ME).name} → ${lb}`;
    run(async () => {
      if (keep) await db(() => sb.from(T.member).upsert({ member_id:ME, work_date:k, loc: c==='team' ? t.code : c, branch: c==='team' ? (t.branch||null) : null, note:null, change_note:note }, { onConflict:'member_id,work_date' }));
      else await db(() => sb.from(T.member).delete().eq('member_id', ME).eq('work_date', k));
      await reload(T.member); toast(`${when} ${lb}으로 바꿨어요`);
    }); }); }
  // 미팅 장소로 바로 출근: 참석자가 나뿐이면 바로 저장, 여럿이면 같이 바로 가는 사람을 고른다 (2026-11-05 — '둘 다 바로 가자'를
  //   한 사람이 정하는 경우가 많다). 나만 미리 골라 두고, 다른 사람 근무지를 바꾸면 그 사람에게 변경 알림이 간다(기존 규칙)
  function openDirect(k){
    const om = outMeetingOf(ME,k); if (!om?.at) return;
    const when = k===TK ? '오늘' : fmtD(k);
    let branch = om.place;
    const save = who => run(async () => {
      for (const p of who) await db(() => sb.from(T.member).upsert({ member_id:p, work_date:k, loc:'other', branch, note:`${om.at} ${om.title}`, change_note:`${fmtD(k)} ${P(p).name} → ${branch} · ${om.at} ${om.title} 바로 출근` }, { onConflict:'member_id,work_date' }));
      await reload(T.member); if (!$('ovl').hidden && $('dr-f')) closeSheet(); render(); toast(`${when} ${names(who)} → ${branch} 바로 출근`); });
    // 같이 고를 수 있는 사람: 이 미팅 참석자 중 그날 종일 휴가가 아니고, 아직 이 장소로 정하지 않은 사람
    const cand = (om.people||[ME]).filter(p => PEOPLE.some(x => x.id===p) && locOf(p,k)?.src!=='leave' && !(branch && locOf(p,k)?.code==='other' && locOf(p,k)?.branch===branch));
    if (!cand.includes(ME)) cand.unshift(ME);
    if (cand.length <= 1 && branch) return save([ME]);
    const sub = p => { const l = locOf(p,k); return l.src==='personal' ? `지금 ${placeName(l,k)}` : ''; };
    openSheet(`<h2>미팅 장소로 바로 출근<button class="x" aria-label="닫기">✕</button></h2>
      <form id="dr-f"><div class="hint">${esc(when)} ${om.at} ${esc(om.title)}${branch?' · '+esc(branch):''}<br>고른 사람은 아침부터 이 장소로 보입니다.${cand.length>1?' 다른 사람을 고르면 그 사람에게 알림이 갑니다.':''}</div>
      ${branch ? '' : `<div class="fld"><label for="dr-place">장소</label><input id="dr-place" placeholder="이름이나 주소"><div class="hint">이 미팅엔 장소가 적혀 있지 않아요.</div></div>`}
      <div class="fld" ${cand.length>1?'':'hidden'}><label>누가 바로 가나요</label><div class="chips grid2" id="dr-p">${cand.map(p => `<button type="button" class="chip" data-dp="${p}" style="--c:var(--accent)" aria-pressed="${p===ME}">${av(P(p))}${esc(P(p).name)}${p===ME?' (나)':''}${sub(p)?`<small> · ${esc(sub(p))}</small>`:''}</button>`).join('')}</div></div>
      <div class="actions foot"><button type="button" class="btn" id="dr-cancel">취소</button><button type="submit" class="btn primary">저장</button></div></form>`);
    const sh = $('sheet');
    sh.querySelectorAll('[data-dp]').forEach(b => b.onclick = () => b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed')!=='true')));
    $('dr-cancel').onclick = closeSheet;
    $('dr-f').onsubmit = e => { e.preventDefault(); const who = [...sh.querySelectorAll('[data-dp][aria-pressed="true"]')].map(b => b.dataset.dp);
      if (!who.length) { toast('바로 가는 사람을 한 명 이상 고르세요'); return; }
      if (!branch) { const v2 = $('dr-place').value.trim(); if (!v2) { toast('장소를 입력해 주세요'); $('dr-place').focus(); return; } branch = v2; }
      save(who); };
  }
  // 하루 카드: 폰 선택일 카드 · 데스크톱 오늘 카드 · 데스크톱 날짜 모달이 같은 내용을 씁니다.
  // compact: 데스크톱 사이드바 오늘 카드 — 일정을 한 줄씩, 5건이 넘으면 4건 + 'N건 더 보기'(날짜 창)
  const MINI_MAX = 4;
  function evMini(e){
    const c = e.type==='leave' ? EVTYPE.leave.color : EVTYPE[e.type].color;
    const tag = e.type==='wishket' ? '<span class="tag">수주</span>' : e.type==='meeting' ? `<span class="tag">${KIND[e.kind]?.label||'미팅'}</span>` : '';
    return `<button class="ev mini ${e.allday?'allday':''} ${e.done?'done':''}" style="--c:${c}" data-ev="${e.id}" title="${esc(e.title)}"><span class="t tnum">${e.allday?'종일':e.start}</span><span class="b"><span class="ti">${tag}${esc(e.title)}</span></span></button>`;
  }
  function evListHtml(k, evs, compact){
    if (!evs.length) return '<div class="empty">등록된 일정이 없습니다.</div>';
    if (!compact || evs.length <= MINI_MAX+1) return evs.map(e => compact ? evMini(e) : evCard(e)).join('');
    return evs.slice(0, MINI_MAX).map(evMini).join('') + `<button class="more-day" data-more="${k}">＋ ${evs.length-MINI_MAX}건 더 보기</button>`;
  }
  function dayHtml(k, modal=false, compact=false){
    const d=parse(k), hol=HOLIDAYS[k], off=isOffDay(k), evs=eventsOf(k).filter(e=>e.type!=='holiday'), n=evs.length;
    return `<div class="today-head"><span class="d tnum">${d.getMonth()+1}월 ${d.getDate()}일 (${WD[d.getDay()]})</span>${k===TK?'<span class="now">오늘</span>':''}${hol?`<span class="hol">${esc(hol)}</span>`:''}<span class="cnt">일정 ${n}건</span>${modal?'<button class="x" aria-label="닫기">✕</button>':''}</div>
      ${off ? `<div class="offday">${hol ? esc(hol)+' · 휴무' : '주말 · 휴무'}</div>` : teamBanner(k) + `<div class="people">${peopleRows(k)}</div>` + myStatus(k)}
      <div class="evlist">${evListHtml(k, evs, compact)}<button class="btn ghost addday" data-add="${k}">＋ 이 날에 일정 추가</button></div>`;
  }
  function bindDay(root, k){
    root.dataset.k = k;
    bindEv(root); bindPeopleRows(root, k); bindQuick(root, k);
    root.querySelector('[data-add]').onclick = () => openAdd('meeting', { date:k });
    const more = root.querySelector('[data-more]'); if (more) more.onclick = () => openDay(k, true);
  }
  function renderDayInto(root, k, compact=false){ root.innerHTML = dayHtml(k, false, compact); bindDay(root, k); }
  // 데스크톱: 날짜 모달. 모달 안에서 추가·수정 시트를 열었다 닫으면 같은 날짜 모달로 돌아옵니다.
  // keepSel: 사이드바(오늘 카드·다가오는 미팅·주간 근무)에서 열 때는 주·목록 보기가 다른 주로 옮겨 가지 않게 선택일을 그대로 둔다
  function openDay(k, keepSel=false){ if (!keepSel) state.sel = k; openSheet('', k); render(); }
  // 날짜별 소제목(오늘·내일·N일 후 + 날짜) 아래에 시간을 크게 — 훑어보기 쉽게 (2026-11-03)
  function renderUpcoming(){
    const up = upcomingMeetings(5);   // 5건 · 날짜 5개여도 1366×640 노트북 화면에 스크롤 없이 들어감
    const rel = k => { const n = dayDiff(TK, k); return n===0 ? '오늘' : n===1 ? '내일' : `${n}일 후`; };
    let h = '', last = '';   // 제목은 사이드바 탭 이름으로 충분
    if (!up.length) h += '<div class="empty">예정된 미팅이 없습니다.</div>';
    else { h += '<div class="uplist">';
      up.forEach(u => { if (u.k!==last) { last = u.k; const d = parse(u.k);
          h += `<button class="up-d ${u.k===TK?'today':''}" data-day="${u.k}"><b>${rel(u.k)}</b><span class="tnum">${d.getMonth()+1}월 ${d.getDate()}일 (${WD[d.getDay()]})</span></button>`; }
        h += `<button class="ev up" style="--c:${u.tag==='수주'?'var(--yellow)':'var(--blue)'}" data-day="${u.k}"><span class="t tnum">${u.t}</span><span class="b"><span class="ti"><span class="tag">${u.tag}</span><wbr>${esc(u.title)}</span><span class="su"><span class="who">${names(u.people)}</span>${u.place?'· '+esc(u.place):''}</span></span></button>`; });
      h += '</div>'; }
    $('upcard').innerHTML = h;
    $('upcard').querySelectorAll('[data-day]').forEach(b => b.onclick = () => openDay(b.dataset.day, true));
  }
  // 데스크톱: 주간 근무 보드 — 요일마다 팀 근무지(전체 이름) 한 줄 + 다른 사람만 아래에. 표 대신 행 단위라 좁은 폭에서도 읽힘.
  function routineSummary(r){
    const g = {}; [1,2,3,4,5].forEach(w => { const c = r.days[w] || 'cityhall'; (g[c] = g[c] || []).push(WD[w]); });
    return Object.entries(g).map(([c,ws]) => `${ws.join('·')} ${LOC[c].label}`).join(' / ');
  }
  function renderWeekBoard(){
    const s = parse(state.bweek), e = addDays(s,4), mon = monday(TODAY), title = state.bweek===key(mon) ? '이번 주' : state.bweek===key(addDays(mon,7)) ? '다음 주' : '주간';
    let h = `<div class="wb-h"><h3>${title} 근무</h3><span class="r tnum">${s.getMonth()+1}/${s.getDate()} – ${e.getMonth()+1}/${e.getDate()}</span><button class="arrow" data-wb="-1" aria-label="지난주">‹</button><button class="arrow" data-wb="1" aria-label="다음주">›</button></div><div class="wb">`;
    for (let i=0;i<5;i++){ const d=addDays(s,i), k=key(d), hol=HOLIDAYS[k], t=teamLoc(k);
      const dcol = `<button class="wb-d" data-day="${k}" title="이 날 자세히"><span class="w">${WD[d.getDay()]}</span><span class="n tnum">${d.getDate()}</span></button>`;
      if (!t) { h += `<div class="wb-row ${k===TK?'today':''} ${k<TK?'past':''}">${dcol}<div class="wb-main"><span class="wb-hol">${esc(hol||'휴무')}</span></div></div>`; continue; }
      const L = LOC[t.code], ex = PEOPLE.map(p=>({p,l:locOf(p.id,k)})).filter(x=>isEx(x.l)), away = ex.filter(x => !x.l.same);
      const tv = teamView(k);
      const pill = tv.empty ? `<button class="wb-team" data-tl="${k}" style="--c:${tv.color}" title="${esc(emptyTip(tv))} · 눌러서 이날 팀 근무지 변경"><span class="ic">${tv.ic}</span><span class="nm">${esc(tv.name)}</span><em>팀 ${esc(teamLocName(t))} 0명</em></button>` : `<button class="wb-team" data-tl="${k}" style="--c:${L.color}" title="${esc(teamLocFull(t))}${t.note?' · '+esc(t.note):''} · 눌러서 이날 팀 근무지 변경"><span class="ic">${L.ic}</span><span class="nm">${esc(teamLocFull(t).replace('패스트파이브 ',''))}</span><em>${away.length?`${PEOPLE.length-away.length}명`:'전원'}</em></button>`;
      const exH = ex.map(({p,l}) => `<button class="wb-ex" data-p="${p.id}" data-k="${k}" style="--c:${locColor(l)}">${av(p)}<span>${esc(p.name)}</span><b>${esc(locText(l,k))}</b>${l.note?`<small>${esc(l.note)}</small>`:''}</button>`).join('');
      h += `<div class="wb-row ${k===TK?'today':''} ${k<TK?'past':''}">${dcol}<div class="wb-main">${pill}${exH}</div></div>`; }
    h += `</div><div class="wb-foot">기본 ${esc(routineSummary(routineAt(state.bweek)))} · <button type="button" class="lnk" data-set>패턴 바꾸기</button><br>근무지를 누르면 그날만 바꿉니다.</div>`;
    const root = $('weekboard'); root.innerHTML = h;
    root.querySelectorAll('[data-wb]').forEach(b => b.onclick = () => { state.bweek = key(addDays(parse(state.bweek), 7*Number(b.dataset.wb))); render(); });
    root.querySelectorAll('[data-tl]').forEach(b => b.onclick = () => openAdd('loc', { date:b.dataset.tl, scope:'team' }));
    root.querySelectorAll('.wb-ex').forEach(b => b.onclick = () => openAdd('loc', { person:b.dataset.p, date:b.dataset.k, scope:'person' }));
    root.querySelectorAll('[data-day]').forEach(b => b.onclick = () => openDay(b.dataset.day, true));
    root.querySelectorAll('[data-set]').forEach(b => b.onclick = () => openSettings());
  }
  // 변경 기록: 화면에 상시 노출하지 않고 추적이 필요할 때만 시트로 조회 — project_audit_log(감사 트리거)에서 읽음
  const AUDIT_TITLE = { team_work_routines:'주간 패턴', team_work_overrides:'팀 근무지', member_work_overrides:'개인 근무지', team_leaves:'휴가', calendar_events:'일정' };
  function auditRow(a){
    const b = a.before || {}, f = a.after || {}, r = a.op==='DELETE' ? b : f;
    const who = memberByUser[a.actor_id] ? P(memberByUser[a.actor_id]).name : a.actor_email ? a.actor_email.split('@')[0] : '시스템';
    const soft = a.op==='UPDATE' && !b.deleted_at && f.deleted_at, undel = a.op==='UPDATE' && b.deleted_at && !f.deleted_at;
    const isLoc = /work_/.test(a.table_name);
    const what = AUDIT_TITLE[a.table_name] + (isLoc ? (a.op==='DELETE' ? ' 해제' : ' 변경') : a.op==='INSERT' ? ' 추가' : (a.op==='DELETE' || soft) ? ' 삭제' : undel ? ' 되돌림' : ' 수정');
    const d = x => x ? fmtD(x) : '';
    const fallback = {
      team_work_routines: () => `${d(r.valid_from)}부터 주간 패턴`,
      team_work_overrides: () => `${d(r.work_date)} ${a.op==='DELETE' ? '주간 패턴대로' : (r.branch || LOC[r.loc]?.label || '')}`,
      member_work_overrides: () => `${d(r.work_date)} ${P(r.member_id).name} ${a.op==='DELETE' ? '→ 팀 근무지대로' : (r.branch || LOC[r.loc]?.label || '')}`,
      team_leaves: () => `${d(r.from_date)}${r.to_date && r.to_date!==r.from_date ? '–'+d(r.to_date) : ''} ${P(r.member_id).name} ${LOC[r.kind]?.label||''}`,
      calendar_events: () => `${d(r.event_date)} ${r.title||''}`,
    }[a.table_name];
    const detail = (a.op!=='DELETE' && f.change_note && f.change_note !== b.change_note) ? f.change_note : (a.op==='INSERT' && f.change_note) ? f.change_note : fallback ? fallback() : '';
    return { at: toKst(a.at), who, what, detail };
  }
  async function openLog(){
    const { data, error } = await sb.from('project_audit_log').select('at,table_name,op,actor_id,actor_email,before,after')
      .in('table_name', Object.keys(AUDIT_TITLE)).order('at', { ascending:false }).limit(300);
    if (error) { toast(friendly(error)); return; }
    const rows = (data||[]).map(auditRow);
    const row = e => `<div class="e"><span class="av">${esc(e.who.slice(1,2)||e.who[0]||'?')}</span><div class="m"><b>${esc(e.what)}</b> ${esc(e.detail)}<small>${esc(e.who)} · ${fmtAt(e.at)}</small></div></div>`;
    openSheet(`<h2>변경 기록 <span style="font-size:.78rem;font-weight:500;color:var(--text2)">최근 ${rows.length}건</span><button class="x" aria-label="닫기">✕</button></h2><div class="log">${rows.map(row).join('')||'<div class="empty">아직 변경이 없습니다.</div>'}</div>`);
  }
  function evCard(e){
    const t = EVTYPE[e.type], c = e.type==='leave' ? EVTYPE.leave.color : t.color;
    let tag = '', sub = '';
    if (e.type==='wishket') { tag = `<span class="tag">수주 · ${MT[e.mt]}</span>`; sub = `<span class="who">${names(e.people)}</span>${e.place?'· '+esc(e.place):''}${e.done?' · 완료':''}`; }
    else if (e.type==='meeting') { tag = `<span class="tag">${KIND[e.kind]?.label||'미팅'}${e.mt?' · '+mtText(e):''}</span>`; sub = `<span class="who">${names(e.people)}</span>${e.place?'· '+esc(e.place):''}${e.end?' · ~'+e.end:''}`; }
    else if (e.type==='leave') { sub = esc(e.note||LOC[e.kind].full); }
    else { sub = [e.people.length&&e.people.length<PEOPLE.length?`<span class="who">${names(e.people)}</span>`:'', e.place?esc(e.place):'', e.end?`~${e.end}`:''].filter(Boolean).join(' · '); }
    return `<button class="ev ${e.allday?'allday':''} ${e.done?'done':''}" style="--c:${c}" data-ev="${e.id}">
      <span class="t tnum">${e.allday?'종일':e.start}</span>
      <span class="b"><span class="ti">${tag}<wbr>${esc(e.title)}</span>${sub?`<span class="su">${sub}${e.people.length&&e.type!=='leave'?avs(e.people):''}</span>`:''}</span></button>`;
  }
  function bindEv(root){ root.querySelectorAll('[data-ev]').forEach(b => b.onclick = ev => { ev.stopPropagation(); openDetail(b.dataset.ev, b.closest('[data-k]')?.dataset.k || state.sel); }); }
  // 5일 카드 줄: 가로 스크롤(관성·카드 단위로 멈춤). 선택일 앞뒤로 넉넉히 그려 두고, 끝에 다가가면 더 이어 붙인다.
  //   선택 날짜가 바뀌었을 때만 그 날을 두 번째 칸으로 옮기고, 그 밖의 다시 그리기(실시간 갱신 등)에는 보던 위치를 지킨다.
  let stripFrom = null, stripTo = null, stripSel = null, stripPlaced = false;
  const stripPitch = sc => (sc.clientWidth + 5) / 5;   // 카드 한 칸 = (폭 - 간격 4개) / 5 + 간격 5px
  function stripCard(k){ const d=parse(k), dw=d.getDay(), hol=HOLIDAYS[k], t=teamLoc(k), tv=t && teamView(k);
    const n = eventsOf(k).filter(e=>e.type!=='holiday').length;
    const lb = t ? `<span class="lb" style="background:color-mix(in srgb,${tv.color} 22%,transparent);color:${tv.color}"${tv.empty?` title="${esc(emptyTip(tv))}"`:''}>${esc(tv.name)}</span>`
      : `<span class="lb" style="color:${hol?'var(--red)':'var(--text2)'}">${esc(hol||'휴무')}</span>`;
    // 팀과 다른 곳에 있는 사람: 이니셜 + 장소색 테두리
    const who = PEOPLE.map(p => { const l=locOf(p.id,k); return isEx(l) ? `<span class="av" style="--c:${locColor(l)}" title="${esc(p.name)} ${esc(locText(l,k))}">${esc(p.name.slice(1,2))}</span>` : ''; }).join('');
    return `<button data-k="${k}" aria-pressed="${k===state.sel}" class="${k===TK?'today':''} ${t?'':'off'} ${k<TK?'past':''}" aria-label="${d.getMonth()+1}월 ${d.getDate()}일 ${WD[dw]}요일${hol?' '+hol:''}"><span class="wd ${dw===6?'sat':(dw===0||hol)?'sun':''}">${k===TK?'오늘':WD[dw]}</span><span class="dn tnum">${d.getDate()===1?(d.getMonth()+1)+'/':''}${d.getDate()}</span>${lb}<span class="who">${who}</span><span class="cnt">${n?n+'건':''}</span></button>`; }
  function stripFill(sc){ let h = ''; for (let d = parse(stripFrom); key(d) <= stripTo; d = addDays(d, 1)) h += stripCard(key(d)); sc.innerHTML = h; }
  // 지금 보이는 5일을 위 제목에 (끌어서 둘러보는 동안에도 따라 바뀜)
  function stripLabel(sc){ const i = sc.clientWidth ? Math.round(sc.scrollLeft / stripPitch(sc)) : dayDiff(stripFrom, key(stripStart()));
    const s = addDays(parse(stripFrom), i), e = addDays(s, 4);
    $('m-range').textContent = s.getMonth()===e.getMonth() ? `${s.getMonth()+1}월 ${s.getDate()}–${e.getDate()}일` : `${s.getMonth()+1}월 ${s.getDate()}일 – ${e.getMonth()+1}월 ${e.getDate()}일`; }
  function stripPlace(sc, smooth){ if (!sc.clientWidth) { stripPlaced = false; return; } stripPlaced = true;
    const left = dayDiff(stripFrom, key(stripStart())) * stripPitch(sc);
    if (smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches) sc.scrollTo({ left, behavior:'smooth' }); else sc.scrollLeft = left; }
  function renderStrip(vp){
    let sc = vp.querySelector('.strip');
    if (!sc) { sc = document.createElement('div'); sc.className = 'strip'; vp.replaceChildren(sc); bindStrip(sc); }
    const sel = state.sel, near = dayDiff(stripFrom || sel, sel);
    // 선택일이 그려 둔 범위의 가장자리 가까이(또는 밖)면 선택일 중심으로 새로 잡는다
    const rebuild = !stripFrom || near < 8 || dayDiff(sel, stripTo) < 12;
    if (rebuild) { stripFrom = key(addDays(parse(sel), -35)); stripTo = key(addDays(parse(sel), 63)); }
    const keep = sc.scrollLeft;
    stripFill(sc);
    if (rebuild || !stripPlaced) stripPlace(sc, false);
    else if (sel !== stripSel) { sc.scrollLeft = keep; stripPlace(sc, true); }
    else sc.scrollLeft = keep;
    stripSel = sel; stripLabel(sc);
  }
  function bindStrip(sc){
    sc.addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (!b || dragMoved) return; selectDay(b.dataset.k); });
    // 끝에 다가가면 앞(뒤)으로 5주씩 더 그린다. 앞에 붙일 때는 보던 자리가 그대로 보이게 위치를 같이 민다.
    let ext = 0;
    sc.addEventListener('scroll', () => { stripLabel(sc); cancelAnimationFrame(ext); ext = requestAnimationFrame(() => {
      const pitch = stripPitch(sc), first = sc.scrollLeft / pitch, total = dayDiff(stripFrom, stripTo) + 1;
      if (first < 6) { stripFrom = key(addDays(parse(stripFrom), -35)); const l = sc.scrollLeft; stripFill(sc); sc.scrollLeft = l + 35 * pitch; }
      else if (first + 5 > total - 6) { stripTo = key(addDays(parse(stripTo), 35)); const l = sc.scrollLeft; stripFill(sc); sc.scrollLeft = l; }
    }); }, { passive:true });
    // 폭이 바뀌면(화면 회전·창 크기) 보던 첫 칸을 그대로 맞춘다
    let firstIdx = 0, lastW = 0;
    sc.addEventListener('scroll', () => { if (sc.clientWidth === lastW) firstIdx = Math.round(sc.scrollLeft / stripPitch(sc)); }, { passive:true });
    // 숨겨져 있다가(PC 폭 → 폰 폭) 처음 보일 때는 선택일을 두 번째 칸에 놓는다
    const ro2 = new ResizeObserver(() => { const w = sc.clientWidth; if (!w) return;
      if (!stripPlaced) stripPlace(sc, false);
      else if (lastW && w !== lastW) sc.scrollLeft = firstIdx * stripPitch(sc);
      lastW = w; firstIdx = Math.round(sc.scrollLeft / stripPitch(sc)); stripLabel(sc); });
    ro2.observe(sc); cleanups.push(() => ro2.disconnect());
    // 마우스(좁은 창의 PC)는 가로 스크롤 손잡이가 없어서 끌기로 둘러보게 한다. 터치는 기본 스크롤을 그대로 쓴다.
    let x0 = null, l0 = 0;
    sc.addEventListener('pointerdown', e => { dragMoved = false; if (e.pointerType !== 'mouse' || e.button !== 0) return; x0 = e.clientX; l0 = sc.scrollLeft; });
    sc.addEventListener('pointermove', e => { if (x0 === null) return; const dx = e.clientX - x0; if (!dragMoved && Math.abs(dx) < 6) return;
      if (!dragMoved) { dragMoved = true; sc.classList.add('dragging'); } sc.scrollLeft = l0 - dx; });
    const end = () => { if (x0 === null) return; x0 = null; if (dragMoved) { sc.classList.remove('dragging');
      const p = stripPitch(sc); sc.scrollTo({ left: Math.round(sc.scrollLeft / p) * p, behavior:'smooth' }); setTimeout(() => { dragMoved = false; }, 0); } };
    on(window, 'pointerup', end); on(window, 'pointercancel', end);
  }
  let dragMoved = false;
  function renderWeek(){
    const s = monday(parse(state.sel));
    $('week').innerHTML = [0,1,2,3,4,5,6].map(i => { const d=addDays(s,i), k=key(d), hol=HOLIDAYS[k], off=isOffDay(k), t=teamLoc(k);
      const tv = off ? null : teamView(k);
      const tl = off ? '' : tv.empty ? `<button class="tl" data-tl="${k}" style="color:${tv.color}" title="${esc(emptyTip(tv))} · 눌러서 팀 근무지 변경"><i></i><span>${tv.ic} ${esc(tv.name)}</span><em>팀 ${esc(teamLocName(t))} 0명</em></button>` : `<button class="tl" data-tl="${k}" style="color:${LOC[t.code].color}" title="${esc(teamLocFull(t))}${t.note?' · '+esc(t.note):''} · 눌러서 변경"><i></i><span>${LOC[t.code].ic} ${esc(teamLocName(t))}</span></button>`;
      const exc = PEOPLE.map(p=>({p,l:locOf(p.id,k)})).filter(x=>isEx(x.l));
      const excH = (off||!exc.length) ? '' : `<div class="exc">${exc.map(({p,l}) => `<button class="locrow" data-p="${p.id}" data-k="${k}" title="${esc(locText(l,k))}${l.note?' · '+esc(l.note):''}">${av(p)}<span class="lb" style="color:${locColor(l)}">${esc(p.name)} ${esc(locText(l,k))}</span></button>`).join('')}</div>`;
      const evs = eventsOf(k).filter(e=>e.type!=='holiday');
      return `<div class="col ${k===TK?'today':''} ${off?'wknd':''} ${k<TK?'past':''}" data-k="${k}"><button class="ch" data-day="${k}" title="이 날 자세히"><span class="dn tnum">${d.getDate()}</span><span class="wd">${WD[d.getDay()]}</span>${hol?`<span class="hol">${esc(hol)}</span>`:''}</button>${tl}${excH}
        <div class="evs">${evs.map(e=>evCard(e)).join('')}</div><button class="add" data-add="${k}">＋ 일정 추가</button></div>`; }).join('');
    bindEv($('week'));
    $('week').querySelectorAll('.locrow').forEach(b => b.onclick = () => openAdd('loc', { person:b.dataset.p, date:b.dataset.k, scope:'person' }));
    $('week').querySelectorAll('[data-tl]').forEach(b => b.onclick = () => openAdd('loc', { date:b.dataset.tl, scope:'team' }));
    $('week').querySelectorAll('[data-add]').forEach(b => b.onclick = () => openAdd('meeting', { date:b.dataset.add }));
    $('week').querySelectorAll('[data-day]').forEach(b => b.onclick = () => openDay(b.dataset.day));
  }
  // 월 그리드: 데스크톱 #mgrid, 폰 #m-mgrid 공용. 폰에서 날짜를 누르면 위의 주간 스트립·선택일 카드가 그 날로 바뀌고 맨 위로 올립니다.
  function monthGrid(root, phone=false){
    const a = state.anchor, first = new Date(a.getFullYear(), a.getMonth(), 1), start = monday(first);
    let h = WD.slice(1).concat(WD[0]).map(w=>`<div class="wh ${w==='토'?'sat':w==='일'?'sun':''}">${w}</div>`).join('');
    // 그 달 마지막 날이 든 주까지 온전한 주 단위로 그린다 (마지막 줄이 한 칸만 남지 않게)
    const last = new Date(a.getFullYear(), a.getMonth()+1, 0), cells = Math.round((addDays(monday(last),7) - start) / 864e5);
    // 팀 근무지는 근무일마다 모두 표시 (2026-11-03 사용자 요청 — 평소 근무지 생략·범례 방식은 되돌림). 그날만 정한 곳은 색 칩.
    for (let i=0;i<cells;i++){ const d=addDays(start,i), k=key(d), dw=d.getDay();
      const hol=HOLIDAYS[k], off=isOffDay(k), evs=eventsOf(k).filter(e=>e.type!=='holiday'), t=teamLoc(k);
      const tv = off ? null : teamView(k);
      const tloc = off ? '' : tv.empty
        ? `<span class="tloc" style="background:color-mix(in srgb,${tv.color} 18%,transparent);color:${tv.color}" title="${esc(emptyTip(tv))}">${esc(tv.name)}</span>`
        : t.src==='override'
        ? `<span class="tloc" style="background:color-mix(in srgb,${LOC[t.code].color} 24%,transparent);color:${LOC[t.code].color}" title="그날만 정한 팀 근무지 → 이날 ${esc(teamLocName(t))}">${esc(teamLocName(t))}</span>`
        : `<span class="tloc dim" style="color:${LOC[t.code].color}" title="주간 패턴">${esc(teamLocName(t))}</span>`;
      const label = `${d.getMonth()+1}월 ${d.getDate()}일 ${WD[dw]}요일${hol?' '+hol:''}${off?'':tv.empty?' · '+tv.name:' · 팀 '+teamLocName(t)}${evs.length?` · 일정 ${evs.length}건`:''}`;
      const ex = off ? '' : PEOPLE.map(p=>{ const l=locOf(p.id,k); return isEx(l)?`<span class="av" style="--c:${locColor(l)}" title="${esc(p.name)} ${esc(locText(l,k))}">${esc(p.name.slice(1,2))}</span>`:''; }).join('');
      const colorOf = e => e.type==='leave'?EVTYPE.leave.color:EVTYPE[e.type].color;
      const items = evs.slice(0,12).map(e=>`<span class="li" style="--c:${colorOf(e)}">${e.allday?'':`<b>${e.start}</b> `}${e.type==='wishket'?'<span class="k">수주</span>':e.type==='meeting'?`<span class="k">${KIND[e.kind]?.label||'미팅'}</span>`:''}${esc(e.title)}${(e.type==='wishket'||e.type==='meeting')?` <span style="opacity:.75">· ${names(e.people)}</span>`:''}</span>`).join('') + `<span class="more" data-n="${evs.length}" ${evs.length>3?'':'hidden'}>${evs.length>3?'+'+(evs.length-3):''}</span>`;
      const bars = `<span class="bars">${evs.slice(0,3).map(e=>`<i style="--c:${colorOf(e)}"></i>`).join('')}</span>`;
      h += `<button class="mc tnum ${d.getMonth()!==a.getMonth()?'out':''} ${k===state.sel?'sel':''} ${k===TK?'today':''} ${k<TK?'past':''}" data-k="${k}" aria-label="${esc(label)}"><span class="n"><span class="dn ${dw===6?'sat':(dw===0||hol)?'sun':''}">${d.getDate()}</span>${hol?`<span class="h">${esc(hol)}</span>`:ex?`<span class="ex">${ex}</span>`:''}</span>${tloc}${items}${bars}</button>`; }
    root.innerHTML = h;
    const foot = $(phone ? 'm-mfoot' : 'mfoot'); if (foot) foot.innerHTML = '';
    root.querySelectorAll('.mc').forEach(b => b.onclick = () => { const k = b.dataset.k;
      if (phone) { selectDay(k); scrollToTop(); } else openDay(k); });
  }
  // 날짜별 블록(팀 근무지·개인 예외·일정) n일치. 데스크톱 목록 보기와 폰 '주' 달력이 공용.
  function agendaDays(s, n){
    let h = '';
    for (let i=0;i<n;i++){ const d=addDays(s,i), k=key(d), hol=HOLIDAYS[k], off=isOffDay(k), t=teamLoc(k), evs=eventsOf(k).filter(e=>e.type!=='holiday');
      if (off && !evs.length && !hol) continue;
      const tv = t && teamView(k);
      const tl = tv?.empty ? `<span class="tl" style="color:${tv.color};border-color:color-mix(in srgb,${tv.color} 45%,transparent)" title="${esc(emptyTip(tv))}"><i></i>${tv.ic} ${esc(tv.name)} · 팀 ${esc(teamLocName(t))} 0명</span>` : t ? `<span class="tl" style="color:${LOC[t.code].color};border-color:color-mix(in srgb,${LOC[t.code].color} 45%,transparent)"><i></i>${LOC[t.code].ic} ${esc(teamLocName(t))}</span>` : '';
      const ex = off ? '' : PEOPLE.map(p=>{ const l=locOf(p.id,k); return isEx(l)?`<span><b>${esc(p.name)}</b> <span style="color:${locColor(l)}">${esc(locText(l,k))}</span></span>`:''; }).filter(Boolean).join('');
      h += `<div class="ag-day ${k===TK?'today':''} ${off?'off':''}" data-k="${k}"><div class="ag-h"><span class="d tnum ${k===TK?'today':''}">${d.getMonth()+1}/${d.getDate()} ${WD[d.getDay()]}${k===TK?' · 오늘':''}</span>${hol?`<span class="hol">${esc(hol)}</span>`:''}${tl}${ex?`<span class="ex">${ex}</span>`:''}<button class="add" data-add="${k}">＋</button></div>
        ${evs.length?`<div class="evlist">${evs.map(e=>evCard(e)).join('')}</div>`:'<div class="empty" style="padding:.1rem 0">일정 없음</div>'}</div>`; }
    return h;
  }
  function bindAgenda(root){ bindEv(root); root.querySelectorAll('[data-add]').forEach(b => b.onclick = () => openAdd('meeting', { date:b.dataset.add })); }
  // 데스크톱 목록: 선택일부터 14일씩
  function renderList(){
    $('listview').innerHTML = agendaDays(parse(state.sel), state.listDays) + `<div class="ag-more"><button class="btn ghost" id="list-more">14일 더 보기</button></div>`;
    bindAgenda($('listview'));
    $('list-more').onclick = () => { state.listDays += 14; render(); };
  }

  // ───────── 시트 ─────────
  // 시트 한 장을 돌려 씀. 날짜 모달 위에서 다른 시트를 열면 ret 에 날짜를 기억했다가 닫을 때 날짜 모달로 복귀.
  // 열 때 포커스를 시트로 옮기고, 완전히 닫으면 연 버튼으로 돌려줍니다.
  function openSheet(html, day=null){
    // 다시 그려져도 찾을 수 있게 연 버튼의 위치(감싼 영역 id + 날짜 또는 id)를 기억
    if ($('ovl').hidden) { const a = document.activeElement; state.lastFocus = a ? { el:a, id:a.id, k:a.dataset?.k || a.dataset?.day, root:a.closest('[id]:not(button)')?.id } : null; }
    if (!day && state.dayModal && !$('ovl').hidden) state.ret = state.dayModal;
    state.dayModal = day;
    const sh = $('sheet'); sh.classList.remove('form'); sh._snap = null; sh.innerHTML = html; $('ovl').hidden = false; sh.scrollTop = 0;
    const x = sh.querySelector('.x'); if (x) x.onclick = closeSheet;
    (x || sh).focus({ preventScroll:true });
  }
  function closeSheet(){
    if (state.ret) { const k = state.ret; state.ret = null; openDay(k); return; }
    $('ovl').hidden = true; state.dayModal = null;
    const f = state.lastFocus; if (!f) return;
    const el = f.el?.isConnected ? f.el : (f.id && $(f.id)) || (f.root && f.k && document.querySelector(`#${f.root} [data-k="${f.k}"], #${f.root} [data-day="${f.k}"]`));
    try { el?.focus?.({ preventScroll:true }); } catch(e){}
  }
  // 작성 중인 입력창은 바깥 클릭·Esc 로 실수로 닫히지 않게 한 번 묻는다 (취소·✕ 는 그대로 닫음)
  const formSnap = () => { const sh = $('sheet');
    return [...sh.querySelectorAll('input,select,textarea')].map(x => x.type==='checkbox' ? x.checked : x.value).join('\u0001') + '|' + [...sh.querySelectorAll('[aria-pressed]')].map(b => b.getAttribute('aria-pressed')).join(''); };
  const formDirty = () => { const sh = $('sheet'); return sh._snap != null && !!sh.querySelector('#f') && formSnap() !== sh._snap; };
  function softClose(){ if (formDirty() && !window.confirm('작성 중인 내용이 있어요. 저장하지 않고 닫을까요?')) return; closeSheet(); }
  $('ovl').onclick = e => { if (e.target===$('ovl')) softClose(); };
  on(document, 'keydown', e => { if (e.key==='Escape' && !$('ovl').hidden) softClose(); });
  // 시트 안에서 Tab 이 뒤 화면으로 빠지지 않게 순환
  $('sheet').addEventListener('keydown', e => { if (e.key!=='Tab') return;
    const f = [...$('sheet').querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea')].filter(x => x.offsetParent!==null);
    if (!f.length) return; const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i<=0) { e.preventDefault(); f[f.length-1].focus(); } else if (!e.shiftKey && i===f.length-1) { e.preventDefault(); f[0].focus(); } });
  // 알림. undo 를 넘기면 8초 동안 버튼(기본 '되돌리기', label 로 바꿈)
  let toastT; function toast(m, undo, label='되돌리기'){
    const t = $('toast'); t.innerHTML = `<span>${esc(m)}</span>${undo?`<button type="button" id="toast-undo">${esc(label)}</button>`:''}`; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, undo ? 8000 : 2600);
    if (undo) $('toast-undo').onclick = () => { t.hidden = true; clearTimeout(toastT); undo(); };
  }
  // 수정 기록용 변경 요약
  function diffText(m, k, f){
    const d = [], tm = x => x.allday ? '종일' : `${x.start||''}${x.end?'–'+x.end:''}`;
    if (m.title!==f.title) d.push(`제목 ${m.title} → ${f.title}`);
    if (k!==f.date) d.push(`날짜 ${fmtD(k)} → ${fmtD(f.date)}`);
    if (tm(m)!==tm(f)) d.push(`시간 ${tm(m)} → ${tm(f)}`);
    if ((m.place||'')!==(f.place||'')) d.push(`장소 ${m.place||'없음'} → ${f.place||'없음'}`);
    if (names(m.people)!==names(f.people)) d.push(`참석 ${names(m.people)} → ${names(f.people)}`);
    if (f.mt && m.mt!==f.mt) d.push(`방식 ${MT[m.mt]||'-'} → ${MT[f.mt]}`);
    if (f.kind && m.kind!==f.kind) d.push(`성격 ${KIND[m.kind]?.label||'-'} → ${KIND[f.kind].label}`);
    if ((m.note||'')!==(f.note||'')) d.push('메모 변경');
    if ((m.repeat||'')!==(f.repeat||'') || (m.until||'')!==(f.until||'')) d.push('반복 변경');
    return d.join(', ') || '변경 없음';
  }

  // 근무지 '다른 장소' 입력 줄: 지도 검색이 맞도록 장소만 적게 하고, 시간이 정해진 방문은 미팅으로 보낸다 (2026-11-05 사용자 QA —
  //   장소 칸에 '나라장터 질의응답 14:00'처럼 적으면 하루 종일 그곳에 있는 것으로 보이고 지도 검색도 빗나간다)
  const placeRow = (show, val) => `<div class="fld" id="branch-row" ${show?'':'hidden'}><div class="lblrow"><label for="f-branch">장소</label><a class="maplink" id="f-map" target="_blank" rel="noopener" ${val?`href="https://map.naver.com/p/search/${encodeURIComponent(val)}"`:'hidden'}>지도에서 확인</a></div>
    <input id="f-branch" placeholder="이름이나 주소" value="${esc(val||'')}">
    <div class="hint">아침부터 그곳으로 바로 갈 때 고르세요. 사무실에 있다가 정해진 시각에 나가면 미팅으로 등록하세요. <button type="button" class="linkbtn" id="to-meeting">미팅으로 등록 ›</button></div></div>`;
  // '미팅 장소로 바로 출근' 기록(개인 근무지 other, 장소 = 미팅 장소)은 미팅과 따로 저장되므로, 미팅을 옮기거나 지우면 남아서 틀린다.
  //   반복 아닌 수동 미팅을 고치거나 지울 때 그 미팅에 묶인 기록(그날·참석자·장소 같음)을 함께 맞춘다. 위시켓 미팅은 워크룸에서 바뀌므로 대상 아님
  const directOf = m => m && m.type==='meeting' && !m.repeat && m.mt==='inperson' && m.autoOut && !m.allday && m.start
    ? personOverrides.filter(o => o.date===m.date && m.people.includes(o.person) && o.loc==='other' && o.branch===(m.place||m.title)) : [];
  async function syncDirect(m, f){
    const tied = directOf(m); if (!tied.length) return '';
    const still = f && f.date===m.date && f.mt==='inperson' && f.autoOut && !f.allday && f.start;
    const keep = still ? tied.filter(o => f.people.includes(o.person)) : [], drop = tied.filter(o => !keep.includes(o));
    const branch = f ? (f.place||f.title) : '';
    for (const o of keep) await db(() => sb.from(T.member).update({ branch, note:`${f.start} ${f.title}`, change_note:`${fmtD(o.date)} ${P(o.person).name} → ${branch} · ${f.start} ${f.title} 바로 출근 (미팅 변경)` }).eq('id', o.id));
    for (const o of drop) await db(() => sb.from(T.member).delete().eq('id', o.id));
    if (keep.length || drop.length) await reload(T.member);
    return drop.length ? ` · 바로 출근 ${names(drop.map(o=>o.person))} 표시도 지웠어요` : '';
  }
  // 미팅·일정 장소 칸: 근무지 '장소'와 같은 형식 — 칸 제목은 짧게, 설명은 placeholder, 오른쪽에 확인 링크.
  //   근무지와 달리 화상 회의 링크도 받는다: 방식이 화상이면 제목 '링크', 주소처럼 생긴 값이면 '링크 열기', 아니면 '지도에서 확인'
  const isUrl = x => /^(https?:\/\/|www\.)\S+$/i.test(x||'') || /(^|\.)(zoom\.us|meet\.google\.com|teams\.microsoft\.com)\//i.test(x||'');
  const PLACE_LBL = { inperson:['장소','이름이나 주소'], video:['링크','Google Meet·Zoom 주소'], phone:['장소 / 링크','비워도 돼요'], '':['장소','이름이나 주소, 화상이면 링크'] };
  const TYPES = [ ['meeting','미팅','var(--blue)'], ['event','일정','var(--accent2)'], ['loc','근무지','var(--green)'], ['leave','휴가','var(--red)'] ];
  // 추가·수정 공용 입력창. pre.edit = { ref, k } 이면 수정: 종류 탭을 숨기고 값을 채우며, 반복 일정이면 바꿀 범위를 고릅니다.
  function openAdd(type='meeting', pre={}){
    if (!ME) { toast('팀원 계정과 연결된 사람만 등록·수정할 수 있어요'); return; }
    const ed = pre.edit || null, m0 = ed?.ref;
    const pcheck = sel => PEOPLE.map(p=>`<button type="button" class="chip" data-pc="${p.id}" style="--c:var(--accent)" aria-pressed="${sel.includes(p.id)}">${av(p)}${esc(p.name)}</button>`).join('');
    const date = ed ? (type==='leave' ? m0.from : ed.k) : (pre.date || state.sel);
    const person = ed && type==='leave' ? m0.person : (pre.person || ME);
    const scope = pre.scope || 'team';
    let body = '';
    if (type==='event' || type==='meeting') {
      const rsRow = ed && m0.repeat ? `<div class="fld"><label>바꿀 범위</label><div class="sub" id="f-rs"><button type="button" data-rs="one" aria-pressed="true">이 회차만 · ${fmtD(ed.k)}</button><button type="button" data-rs="future" aria-pressed="false">이 회차부터 이후 전부</button></div></div>` : '';
      body = rsRow + `<div class="fld"><label for="f-title">제목</label><input id="f-title" placeholder="${type==='meeting'?'예: 가나다물류 킥오프':'예: 주간 회의, 제안서 마감'}"></div>
        ${type==='meeting' ? '' : `<div class="fld"><label for="f-kind">종류</label><select id="f-kind"><option value="internal">사내 (회의·행사)</option><option value="deadline">마감</option><option value="other">기타</option></select></div>`}
        ${type==='meeting' && !m0?.repeat ? `<div class="fld"><label for="f-date">날짜</label><input id="f-date" type="date" value="${date}"></div>`
          : `<div class="row2"><div class="fld"><label for="f-date">날짜</label><input id="f-date" type="date" value="${date}"></div>
          <div class="fld"><label for="f-repeat">반복</label><select id="f-repeat"><option value="">안 함</option><option value="weekly">매주 (공휴일 건너뜀)</option></select></div></div>
        <div class="fld" id="until-row" hidden><label for="f-until">반복 종료 (선택 · 비우면 계속)</label><input id="f-until" type="date"></div>`}
        <div class="fld"><div class="lblrow"><label for="f-start">시간</label><label class="tgl"><input type="checkbox" id="f-allday" role="switch"><i></i>종일</label></div>
          <div class="trow" id="timerow"><input id="f-start" class="tin" type="text" inputmode="none" autocomplete="off" value="10:00" aria-label="시작 시간"><span id="end-sep" aria-hidden="true" hidden>–</span><input id="f-end" class="tin" type="text" inputmode="none" autocomplete="off" value="" aria-label="끝나는 시간" hidden><button type="button" class="addend" id="end-add">＋ 끝나는 시간</button><button type="button" class="addend x" id="end-del" aria-label="끝나는 시간 빼기" hidden>✕</button></div>
          <div class="tpk" id="tpk" hidden></div>
          <div class="allday-box" id="allday-box" hidden>하루 종일</div></div>
        <div class="fld"><label>${type==='meeting'?'참석':'대상'}</label><div class="chips grid3" id="f-people">${pcheck(pre.people||[ME])}</div></div>
        ${type==='meeting' ? `<div class="fld"><label>방식</label><div class="seg full" id="f-mt">${Object.entries(MT).map(([k,v],i)=>`<button type="button" data-mt="${k}" aria-pressed="${i===1}">${v}</button>`).join('')}</div></div>`:''}
        ${type==='meeting' ? `<div class="fld" id="autoout-row"><label>어디서</label><div class="seg full" id="f-where"><button type="button" data-where="office" aria-pressed="false">우리 사무실</button><button type="button" data-where="out" aria-pressed="false">외부</button></div><div class="hint">외부면 참석자가 시작 시각부터 외근(종일이면 하루 전체)으로 보여요. 아침에 그곳으로 바로 가는 사람은 그날 '내 근무'에서 '미팅 장소로 바로 출근'을 누르세요.</div></div>`:''}
        <div class="fld"><div class="lblrow"><label for="f-place" id="f-place-lbl">장소</label><a class="maplink" id="f-pmap" target="_blank" rel="noopener" hidden></a></div><input id="f-place" placeholder="${PLACE_LBL[''][1]}"></div>
        ${type==='meeting' ? `<div class="fld"><label>미팅 성격</label><div class="kinds" id="f-kinds">${Object.entries(KIND).map(([k,v],i)=>`<button type="button" data-kind="${k}" style="--c:var(--blue)" aria-pressed="${i===0}">${v.label}${v.desc?`<small>${v.desc}</small>`:''}</button>`).join('')}</div></div>
          <div class="fld"><label for="f-proj">프로젝트 연결 (선택 · 수주 후 건만)</label><select id="f-proj"><option value="">연결 안 함</option>${PROJECTS.map(w=>`<option value="${w.slug}">${esc(w.title)}</option>`).join('')}</select><div class="hint">지원~미팅 단계(위시켓) 건의 수주 미팅은 워크룸에서 등록합니다. 여기서는 그 외 미팅(진행 중 프로젝트·직거래·입찰·협력사)을 등록합니다.</div></div>`:''}
        <div class="fld"><label for="f-note">메모</label><textarea id="f-note" rows="2" placeholder="준비물, 안건, 주의사항"></textarea></div>
        <div class="hint" id="ev-warn"></div>`;
    } else if (type==='loc') {
      const team = teamLoc(date), ov = personOverrides.find(o => o.person===person && o.date===date), om = outMeetingOf(person, date);
      const teamTab = `<div class="sub"><button type="button" data-scope="team" aria-pressed="${scope==='team'}">팀 근무지</button><button type="button" data-scope="person" aria-pressed="${scope==='person'}">개인 근무지</button></div>`;
      if (scope==='team') {
        body = teamTab +
          `<div class="fld"><label for="f-date">날짜 (하루)</label><input id="f-date" type="date" value="${date}"></div>
          <div class="fld"><label>근무지</label><div class="chips grid2" id="f-loc">${['cityhall','forest','other','home'].map(c=>`<button type="button" class="chip" data-loc="${c}" style="--c:${LOC[c].color}" aria-pressed="${team?.code===c}"><i class="sw"></i>${LOC[c].full}</button>`).join('')}</div></div>
          ${placeRow(team?.code==='other', team?.branch)}
          <div class="fld"><label for="f-note">사유·메모 (선택 · 팀에 공개)</label><input id="f-note" placeholder="예: 마감일이라 전원 재택" value="${esc(team?.note||'')}"></div>
          <div class="hint">이 날 하루만 바뀝니다. 매주 반복되는 근무지는 ⚙️ 설정의 '주간 근무 패턴'에서 바꿉니다.</div>`;
      } else {
        body = teamTab + `<div class="fld"><label for="f-person">누구</label><select id="f-person">${PEOPLE.map(p=>`<option value="${p.id}" ${p.id===person?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div>
          <div class="fld"><label for="f-date">날짜 (하루)</label><input id="f-date" type="date" value="${date}"></div>
          <div class="fld"><label>근무지</label><div class="chips grid2" id="f-loc"><button type="button" class="chip span2" data-loc="" style="--c:var(--text2)" aria-pressed="${!ov}">팀 근무지대로 · ${team?esc(teamLocName(team)):'휴무'}</button>${['cityhall','forest','other','home'].map(c=>`<button type="button" class="chip" data-loc="${c}" style="--c:${LOC[c].color}" aria-pressed="${ov?.loc===c || (c==='other' && ov?.loc==='out')}"><i class="sw"></i>${LOC[c].full}</button>`).join('')}</div></div>
          ${placeRow(ov?.loc==='other' || ov?.loc==='out', ov?.branch)}
          <div class="fld"><label for="f-note">사유·메모 (선택 · 팀에 공개)</label><input id="f-note" placeholder="예: 박람회 참관 후 바로 퇴근" value="${esc(ov?.note||'')}"></div>
          ${om ? `<div class="hint">${om.at ? `이 날 ${om.at} 대면 미팅(${esc(om.title)})이 있어 '팀 근무지대로'면 그 시각부터 외근으로 표시됩니다. 아침부터 밖이면 '다른 장소'를 고르세요.` : `이 날 종일 대면 미팅(${esc(om.title)})이 있어 '팀 근무지대로'면 자동으로 외근입니다. 사무실에 있다면 그 지점을 직접 고르세요.`}</div>` : ''}`;
      }
    } else {
      body = `<div class="fld"><label for="f-person">누구</label><select id="f-person">${PEOPLE.map(p=>`<option value="${p.id}" ${p.id===person?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div>
        <div class="row2"><div class="fld"><label for="f-date">시작</label><input id="f-date" type="date" value="${date}"></div><div class="fld"><label for="f-to">종료</label><input id="f-to" type="date" value="${ed?m0.to:date}"></div></div>
        <div class="fld"><label>종류</label><div class="chips grid4" id="f-lk">${['off','am','pm','sick'].map((c,i)=>`<button type="button" class="chip" data-lk="${c}" style="--c:${LOC[c].color}" aria-pressed="${ed ? m0.kind===c : i===0}">${LOC[c].label}</button>`).join('')}</div></div>
        <div class="fld"><label for="f-note">사유 (선택 · 팀에 공개)</label><input id="f-note" placeholder="비워도 됩니다" value="${esc(ed?m0.note||'':'')}"></div>
        <div class="hint" id="leave-days"></div><div class="hint" id="leave-warn"></div>`;
    }
    const title = ed ? { meeting:'미팅 수정', event:'일정 수정', leave:'휴가 수정' }[type]
      : type==='loc' ? (scope==='team'?'팀 근무지 변경':'개인 근무지') : type==='leave' ? '휴가 등록' : type==='meeting' ? '미팅 추가' : '일정 추가';
    openSheet(`<h2>${title}<button class="x" aria-label="닫기">✕</button></h2>
      ${ed ? '' : `<div class="types">${TYPES.map(([k,l,c])=>`<button type="button" data-t="${k}" style="--c:${c}" aria-pressed="${k===type}">${l}</button>`).join('')}</div>`}
      <form id="f"><div class="hint warn" id="past-hint" hidden>지난 날짜입니다. 정정한 내용은 변경 기록에 남습니다.</div>${body}
        <div class="hint warn" id="f-conflict" hidden></div>
        <div class="actions foot"><button type="button" class="btn" id="f-cancel">취소</button><button type="submit" class="btn primary">${ed?'수정 저장':'저장'}</button></div></form>`);
    const sh = $('sheet'); sh.classList.add('form');
    // 종류·범위 탭을 바꿔도 쓰던 내용(제목·날짜·시간·참석·장소·메모)을 옮겨 간다 — 전에는 확인 없이 사라졌다 (2026-11-03)
    const carryNow = () => ({ title:$('f-title')?.value, date:$('f-date')?.value, start:$('f-start')?.value, end:$('f-end')?.value, allday:$('f-allday')?.checked,
      place:$('f-place')?.value, note:$('f-note')?.value, people:[...sh.querySelectorAll('.chip[data-pc][aria-pressed="true"]')].map(x=>x.dataset.pc) });
    const switchTo = (t, extra={}) => { const c = carryNow(); openAdd(t, { ...pre, ...extra, date: c.date || pre.date, people: c.people.length ? c.people : pre.people, carry: c }); };
    sh.querySelectorAll('[data-t]').forEach(b => b.onclick = () => switchTo(b.dataset.t));
    sh.querySelectorAll('[data-scope]').forEach(b => b.onclick = () => switchTo('loc', { scope:b.dataset.scope }));
    const rsOne = () => sh.querySelector('[data-rs="one"]')?.getAttribute('aria-pressed')==='true';
    const syncAllday = () => { const on = !!$('f-allday')?.checked; if ($('timerow')) { $('timerow').hidden = on; $('allday-box').hidden = !on; } };
    const syncRepeat = () => { const rep = $('f-repeat'); if (!rep) return; rep.disabled = rsOne(); $('until-row').hidden = !rep.value || rsOne(); };
    sh.querySelectorAll('.chip[data-pc],.chip[data-loc],.chip[data-lk],[data-kind],[data-mt],[data-rs],[data-where]').forEach(b => b.onclick = () => {
      const multi = b.dataset.pc; if (!multi) b.parentElement.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed','false'));
      b.setAttribute('aria-pressed', multi ? String(b.getAttribute('aria-pressed')!=='true') : 'true');
      if (b.dataset.loc!==undefined && $('branch-row')) $('branch-row').hidden = b.dataset.loc!=='other';
      if (b.dataset.rs) syncRepeat();
      if (b.dataset.lk && sh._leaveWarn) sh._leaveWarn();
      if (b.dataset.mt || b.dataset.pc) evWarn(); });
    // 수정: 기존 값 채우기
    if (ed && (type==='meeting' || type==='event')) {
      $('f-title').value = m0.title;
      if (type==='meeting') { sh.querySelectorAll('[data-kind]').forEach(b => b.setAttribute('aria-pressed', b.dataset.kind===m0.kind)); $('f-proj').value = m0.project||''; sh.querySelectorAll('[data-mt]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mt===m0.mt));
        // 예전에 체크를 끈 대면 미팅(autoOut=false)은 '우리 사무실'로 본다
        if (m0.mt==='inperson') sh.querySelectorAll('[data-where]').forEach(b => b.setAttribute('aria-pressed', b.dataset.where===(m0.autoOut?'out':'office'))); }
      else $('f-kind').value = m0.type;
      $('f-allday').checked = !!m0.allday; syncAllday();
      if ($('f-repeat')) { $('f-repeat').value = m0.repeat||''; $('f-until').value = m0.until||''; }
      $('f-start').value = m0.start||'10:00'; $('f-end').value = m0.end||'';
      $('f-place').value = m0.place||''; $('f-note').value = m0.note||'';
      sh.querySelectorAll('[data-pc]').forEach(b => b.setAttribute('aria-pressed', m0.people.includes(b.dataset.pc)));
    }
    if (pre.carry && !ed) { const c = pre.carry;
      [['f-title','title'],['f-start','start'],['f-end','end'],['f-place','place'],['f-note','note']].forEach(([id,k]) => { if ($(id) && c[k]) $(id).value = c[k]; });
      if ($('f-allday') && c.allday) { $('f-allday').checked = true; syncAllday(); } }
    if (pre.where) sh.querySelectorAll('[data-where]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.where===pre.where)));
    // 끝나는 시간: 기본은 숨김 — '＋ 끝나는 시간'을 눌러야 나온다 (2026-11-05). 값이 있으면(수정·옮겨 옴) 보인다
    const showEnd = on => { $('f-end').hidden = !on; $('end-sep').hidden = !on; $('end-del').hidden = !on; $('end-add').hidden = on; if (!on) $('f-end').value = ''; };
    if ($('f-end')) { showEnd(!!$('f-end').value);
      $('end-add').onclick = () => { const st = $('f-start').value; if (/^\d\d:\d\d$/.test(st)) { const mm = Math.min(toMin(st)+60, 23*60+59); $('f-end').value = `${pad(Math.floor(mm/60))}:${pad(mm%60)}`; } showEnd(true); openTpk($('f-end')); evWarn(); };
      $('end-del').onclick = () => { showEnd(false); closeTpk(); evWarn(); }; }
    // 시간 고르기: 시(6~23) → 분(10분 단위) 두 번 누르면 끝. PC 는 키보드로 '1430'·'14:30'처럼 바로 쳐도 된다
    let tpkFor = null;
    function closeTpk(){ const t = $('tpk'); if (t) t.hidden = true; tpkFor = null; sh.querySelectorAll('.tin').forEach(x => x.classList.remove('on')); }
    function openTpk(inp){ const t = $('tpk'); if (!t) return; tpkFor = inp; sh.querySelectorAll('.tin').forEach(x => x.classList.toggle('on', x===inp));
      const [h, m] = (/^(\d\d):(\d\d)$/.exec(inp.value) || []).slice(1).map(Number);
      const hrs = Array.from({ length:18 }, (_, i) => i + 6), mins = [0,10,20,30,40,50];
      t.innerHTML = `<div class="tpk-h"><span>${inp.id==='f-end'?'끝나는 시간':'시작 시간'} · 시</span><button type="button" class="linkbtn" data-tclose>닫기</button></div>
        <div class="tpk-g hrs">${hrs.map(x => `<button type="button" data-th="${x}" aria-pressed="${x===h}">${x>12?x-12:x}<small>${x<12?'오전':'오후'}</small></button>`).join('')}</div>
        <div class="tpk-h"><span>분</span></div>
        <div class="tpk-g mins">${mins.map(x => `<button type="button" data-tm="${x}" aria-pressed="${x===m}">${pad(x)}</button>`).join('')}</div>`;
      t.hidden = false;
      const set = (hh, mm) => { inp.value = `${pad(hh)}:${pad(mm)}`; inp.dispatchEvent(new Event('input', { bubbles:true })); };
      t.querySelectorAll('[data-th]').forEach(b => b.onclick = () => { const cur = /^(\d\d):(\d\d)$/.exec(inp.value); set(+b.dataset.th, cur && mins.includes(+cur[2]) ? +cur[2] : 0);
        t.querySelectorAll('[data-th]').forEach(x => x.setAttribute('aria-pressed', String(x===b))); t.querySelectorAll('[data-tm]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.tm===String(+inp.value.slice(3))))); });
      t.querySelectorAll('[data-tm]').forEach(b => b.onclick = () => { const cur = /^(\d\d):/.exec(inp.value); set(cur ? +cur[1] : 10, +b.dataset.tm); closeTpk(); });
      t.querySelector('[data-tclose]').onclick = closeTpk;
      t.scrollIntoView?.({ block:'nearest', behavior:'smooth' }); }
    sh.querySelectorAll('.tin').forEach(inp => { let last = inp.value;
      inp.addEventListener('focus', () => { last = inp.value; openTpk(inp); try { inp.select(); } catch (_) {} });   // 치면 바로 바뀌게 전체 선택
      inp.addEventListener('click', () => { if (tpkFor!==inp) openTpk(inp); });
      inp.addEventListener('keydown', e => { if (e.key==='Escape' && tpkFor) { e.stopPropagation(); closeTpk(); } if (e.key==='Enter') { e.preventDefault(); inp.blur(); } });
      inp.addEventListener('change', () => { const n = normT(inp.value); if (inp.value && !n) { inp.value = last; toast('시간은 14:30 처럼 적어 주세요'); } else if (n && n!==inp.value) { inp.value = n; inp.dispatchEvent(new Event('input', { bubbles:true })); } last = inp.value; }); });
    // 바깥을 누르면 판을 닫는다. pointerdown 에서 닫으면 판이 접히며 화면이 당겨져 누른 버튼('외부' 등)의 클릭이 사라지므로 click 뒤에 닫는다
    sh.addEventListener('click', e => { if (tpkFor && !e.target.closest('#tpk') && !e.target.closest('.tin') && !e.target.closest('#end-add')) closeTpk(); });
    // 근무지 '다른 장소': 적은 장소로 지도 확인 링크를 바로 갱신, 시간 정해진 방문은 미팅 창으로 (날짜·사람·장소를 들고 '외부'로)
    if ($('f-branch')) { const upd = () => { const v2 = $('f-branch').value.trim(), a = $('f-map'); a.hidden = !v2; if (v2) a.href = `https://map.naver.com/p/search/${encodeURIComponent(v2)}`; };
      $('f-branch').addEventListener('input', upd); upd();
      $('to-meeting').onclick = () => { const who = $('f-person') ? [$('f-person').value] : PEOPLE.map(x => x.id);
        openAdd('meeting', { date:$('f-date').value, people:who, where:'out', carry:{ place:$('f-branch').value.trim(), note:$('f-note')?.value.trim() } }); }; }
    // 미팅·일정 장소 칸: 방식에 맞춘 칸 제목·placeholder, 적은 값에 맞춘 확인 링크(지도 / 링크 열기)
    const syncPlace = () => { const inp = $('f-place'); if (!inp) return;
      const mt = type==='meeting' ? (sh.querySelector('[data-mt][aria-pressed="true"]')?.dataset.mt || 'inperson') : '';
      const [lbl, ph] = PLACE_LBL[mt]; $('f-place-lbl').textContent = lbl; inp.placeholder = ph;
      const val = inp.value.trim(), a = $('f-pmap'), url = isUrl(val);
      a.hidden = !val || (!url && mt==='video');
      if (!a.hidden) { a.textContent = url ? '링크 열기' : '지도에서 확인'; a.href = url ? (/^https?:/i.test(val) ? val : 'https://' + val) : `https://map.naver.com/p/search/${encodeURIComponent(val)}`; } };
    if ($('f-place')) { $('f-place').addEventListener('input', syncPlace); sh.querySelectorAll('[data-mt]').forEach(b => b.addEventListener('click', syncPlace)); syncPlace(); }
    const ad = $('f-allday'); if (ad) ad.onchange = () => { syncAllday(); evWarn(); };
    if ($('f-repeat')) { $('f-repeat').onchange = syncRepeat; syncRepeat(); }
    ['f-date','f-start','f-end','f-place'].forEach(i => { if ($(i)) $(i).addEventListener('input', evWarn); });
    // 시작 시간을 옮기면 종료 시간도 같은 길이만큼 따라간다 (23:59 를 넘지 않게)
    if ($('f-start')) { let prevStart = $('f-start').value;
      $('f-start').addEventListener('input', () => { const s = $('f-start').value, en = $('f-end').value;
        if (s && en && prevStart) { const dur = toMin(en) - toMin(prevStart); if (dur > 0) { const mm = Math.min(toMin(s)+dur, 23*60+59); $('f-end').value = `${pad(Math.floor(mm/60))}:${pad(mm%60)}`; evWarn(); } }
        if (s) prevStart = s; }); }
    const ph = () => { $('past-hint').hidden = !($('f-date').value && $('f-date').value < TK); };
    $('f-date').addEventListener('input', ph); $('f-date').addEventListener('change', ph); ph();
    // 읽은 기간 밖 날짜를 고르면 그 기간을 읽고 나서 겹침·휴가 경고를 다시 계산
    ['f-date','f-to'].forEach(i => $(i)?.addEventListener('change', () => { const a = $('f-date').value, b = $('f-to')?.value || a; if (!a) return;
      const form = $('f'); ensureSpan(a < b ? a : b, a < b ? b : a).then(() => { if ($('f') !== form) return; render(); evWarn(); sh._leaveWarn?.(); }); }));
    function evWarn(){ const w = $('ev-warn'); if (!w) return;
      const k=$('f-date').value, people=[...sh.querySelectorAll('.chip[data-pc][aria-pressed="true"]')].map(b=>b.dataset.pc), mt=sh.querySelector('[data-mt][aria-pressed="true"]')?.dataset.mt;
      const me = { allday:$('f-allday').checked, start:$('f-start').value, end:$('f-end').value };
      const msgs = [];
      if (!me.allday && me.start && me.end && toMin(me.end) <= toMin(me.start)) msgs.push('종료 시간이 시작보다 늦어야 합니다');
      rawEventsOf(k).filter(e => (e.type==='wishket'||e.type==='meeting') && e.id!==m0?.id).forEach(e => { const who = e.people.filter(p=>people.includes(p)); if (who.length && overlaps(me,e)) msgs.push(`${names(who)} — ${e.start} ${e.title}과 시간이 겹칩니다`); });
      people.forEach(p => { const l = locOf(p,k), nm = P(p).name; if (!l) return;
        if (l.src==='leave') msgs.push(`${nm}${josa(nm,'은','는')} 이날 ${LOC[l.code].label}입니다`);
        else if (l.half && !me.allday && me.start) { const st = toMin(me.start); if ((l.half==='am' && st<780) || (l.half==='pm' && st>=780)) msgs.push(`${nm}${josa(nm,'은','는')} 이 시간에 ${LOC[l.half].label}입니다`); } });
      const t = teamLoc(k); if (mt==='inperson' && t?.code==='home') msgs.push('이날 팀은 재택입니다. 참석자 이동이 필요합니다');
      const ar = $('autoout-row'); if (ar) ar.hidden = mt!=='inperson';
      w.className = 'hint' + (msgs.length?' warn':''); w.innerHTML = msgs.map(esc).join('<br>'); }
    evWarn();
    if (type==='leave') { const warn = () => { const k=$('f-date').value, p=$('f-person').value, to=$('f-to').value||k, kind = sh.querySelector('[data-lk][aria-pressed="true"]')?.dataset.lk || 'off';
        const n = k && to>=k ? leaveDays(k, to, kind) : 0;
        $('leave-days').textContent = n ? `${LOC[kind].label} ${n}일 · 주말·공휴일 제외` : '';
        const clash = [...WORKROOM.filter(w=>w.status!=='meeting_done' && w.meeting_at.slice(0,10)>=k && w.meeting_at.slice(0,10)<=to && [w.main,w.sub].includes(p)).map(w=>w.title),
                       ...manual.filter(m=>m.type==='meeting' && m.people.includes(p)).filter(m => { for (let d=parse(k); key(d)<=to; d=addDays(d,1)) if (occursOn(m, key(d))) return true; return false; }).map(m=>m.title)];
        $('leave-warn').className = 'hint' + (clash.length?' warn':''); $('leave-warn').textContent = clash.length ? `이 기간에 참석 미팅이 있습니다: ${clash.join(', ')}` : '이 기간에 겹치는 미팅이 없습니다.'; };
      sh._leaveWarn = warn; ['f-date','f-to','f-person'].forEach(i=>$(i).addEventListener('change', warn)); warn(); }
    // 동시 수정 확인: 입력창을 연 뒤 다른 사람이 같은 대상을 바꿨으면 한 번 알리고, 다시 누르면 덮어씁니다.
    const baseOf = () => ed ? JSON.stringify((type==='leave' ? leaves : manual).find(x => x.id===m0.id) || null)
      : type==='loc' ? JSON.stringify(scope==='team' ? teamOverrides.find(o=>o.date===date)||null : personOverrides.find(o=>o.person===person && o.date===date)||null) : '';
    const base = baseOf();
    const conflict = () => { const f = $('f'); if (f.dataset.force || baseOf()===base) return false;
      const c = $('f-conflict'); c.hidden = false; c.textContent = `입력창을 연 뒤 다른 사람이 이 내용을 바꿨습니다. 화면 뒤 내용을 확인하고 한 번 더 저장하면 덮어씁니다.`;
      f.dataset.force = '1'; render(); return true; };
    $('f-cancel').onclick = closeSheet;
    $('f').onsubmit = e => { e.preventDefault(); save(type, scope, ed, conflict); };
    // 옮겨 온 내용이 있으면 처음부터 '작성 중'으로 본다 — 바깥 클릭·Esc 에 확인을 묻게
    const carried = pre.carry && !ed && ['title','place','note'].some(k => pre.carry[k]);
    sh._snap = carried ? '\u0000carried' : formSnap();
    setTimeout(() => sh.querySelector('form input:not([type=checkbox]):not([disabled]),form select:not([disabled])')?.focus(), 50);
  }
  // 저장: 값 검증은 화면에서 먼저, 최종 검증(겹치는 휴가·시간 순서 등)은 DB 제약이 한 번 더 합니다.
  function save(type, scope, ed, conflict){
    if (busy) return;
    const v = id => $(id)?.value?.trim();
    const pressed = sel => [...$('sheet').querySelectorAll(sel+'[aria-pressed="true"]')];
    const done = () => { closeSheet(); render(); };
    if (type==='event' || type==='meeting') {
      const title = v('f-title'); if (!title) { toast('제목을 입력해 주세요'); $('f-title').focus(); return; }
      const people = pressed('.chip[data-pc]').map(b=>b.dataset.pc);
      if (type==='meeting' && !people.length) { toast('참석자를 한 명 이상 고르세요'); return; }
      const allday = $('f-allday').checked, kind = pressed('[data-kind]')[0]?.dataset.kind, mt = type==='meeting' ? pressed('[data-mt]')[0]?.dataset.mt : undefined, date = v('f-date');
      const start = normT(v('f-start')) || v('f-start'), end = $('f-end').hidden ? '' : (normT(v('f-end')) || v('f-end')), one = ed && ed.ref.repeat && pressed('[data-rs]')[0]?.dataset.rs==='one';
      const repeat = one ? '' : v('f-repeat'), until = repeat ? v('f-until') : '';
      if (!date) { toast('날짜를 골라 주세요'); return; }
      if (!allday && !start) { toast('시작 시간을 넣어 주세요'); $('f-start').focus(); return; }
      if (!allday && start && end && toMin(end) <= toMin(start)) { toast('종료 시간이 시작보다 늦어야 해요'); $('f-end').focus(); return; }
      if (until && until < date) { toast('반복 종료일이 시작일보다 빨라요'); $('f-until').focus(); return; }
      if (conflict()) return;
      // 대면 미팅은 어디서 하는지 꼭 고른다 — 미리 골라 두면 고객이 찾아오는 미팅이 외근으로 잘못 들어간다 (2026-11-05 사용자 QA)
      const where = pressed('[data-where]')[0]?.dataset.where;
      if (type==='meeting' && mt==='inperson' && !where) { toast('대면 미팅은 어디서 하는지 골라 주세요 (우리 사무실 / 외부)'); $('f-where')?.scrollIntoView({ block:'center', behavior:'smooth' }); return; }
      const autoOut = type==='meeting' && mt==='inperson' && where==='out';
      const fields = { type: type==='meeting' ? 'meeting' : v('f-kind'), kind: type==='meeting' ? kind : undefined, title, date, allday, start: allday?undefined:start, end: allday?undefined:(end||undefined),
        mt, place:v('f-place'), people, note:v('f-note'), repeat: repeat||undefined, until: until||undefined, skipHoliday: true, project: v('f-proj')||undefined, autoOut };
      const what = type==='meeting' ? '미팅' : '일정';
      const saved = msg => toast(msg);
      run(async () => {
        if (ed) {
          const m = ed.ref, k = ed.k, rs = m.repeat ? (pressed('[data-rs]')[0]?.dataset.rs || 'one') : 'all', diff = diffText(m, k, fields);
          // 반복 나누기는 새 일정 추가 + 원래 반복 수정을 한 번에(calendar_split_event, 2026-11-06) — 따로 저장하다 두 번째가 실패하면 일정이 겹쳤다
          const split = (row, exdates, until, note) => db(() => sb.rpc('calendar_split_event', { p_parent:m.id, p_row:row, p_parent_exdates:exdates, p_parent_until:until, p_parent_note:note }));
          if (rs==='one') {
            await split({ ...eventRow({ ...fields, repeat:undefined, until:undefined, parent:m.id }), change_note:`${fmtD(k)} ${m.title} · 이 회차만 · ${diff}` },
              [...(m.exdates||[]), k], null, `${fmtD(k)} 회차를 따로 고침`);
          } else if (rs==='future' && k!==m.date) {
            await split({ ...eventRow({ ...fields, parent:m.id, exdates:(m.exdates||[]).filter(x=>x>=k) }), change_note:`${fmtD(k)}부터 ${m.title} · 이후 전부 · ${diff}` },
              (m.exdates||[]).filter(x=>x<k), key(addDays(parse(k),-1)), `${fmtD(k)}부터 새 반복으로 나눔`);
          } else {
            await db(() => sb.from(T.events).update({ ...eventRow({ ...fields, exdates:m.exdates, parent:m.parent }), change_note:`${fmtD(date)} ${title} · ${diff}` }).eq('id', m.id));
          }
          const extra = rs==='all' ? await syncDirect(m, fields) : '';
          await reload(T.events); done(); saved(`${what}을 고쳤어요${extra}`);
        } else {
          await db(() => sb.from(T.events).insert({ ...eventRow(fields), change_note:`${fmtD(date)} ${title}${kind?' ('+KIND[kind].label+')':''} · ${names(people)}${autoOut?' — 참석자 외근 표시':''}` }));
          await reload(T.events); done(); saved(`${what}을 추가했어요`);
        }
      });
    } else if (type==='loc' && scope==='team') {
      const loc = pressed('.chip[data-loc]')[0]?.dataset.loc; if (!loc) { toast('근무지를 선택해 주세요'); return; }
      const k = v('f-date'), branch = loc==='other' ? v('f-branch') : '', note = v('f-note');
      if (loc==='other' && !branch) { toast('장소를 입력해 주세요'); $('f-branch').focus(); return; }
      if (!k || isOffDay(k)) { toast('휴무일입니다'); return; }
      if (conflict()) return;
      const before = teamLoc(k), wd = parse(k).getDay();
      const label = `${fmtD(k)} ${teamLocName(before)} → ${branch||LOC[loc].label}${note?' ('+note+')':''}`;
      run(async () => {
        const pattern = routineAt(k);
        if ((pattern.days[wd]||'cityhall')!==loc || branch || note) await db(() => sb.from(T.team).upsert({ work_date:k, loc, branch:branch||null, note:note||null, change_note:label }, { onConflict:'work_date' }));
        else await db(() => sb.from(T.team).delete().eq('work_date', k));
        await reload(T.team); done();
        const v = teamView(k);
        toast(v?.empty ? `${fmtD(k)} 팀 근무지를 ${branch||LOC[loc].label}로 바꿨어요. 다만 모두 개인 근무지가 있어 이곳으로 오는 사람은 없어요` : `${fmtD(k)} 팀 근무지를 ${branch||LOC[loc].label}로 바꿨어요`);
      });
    } else if (type==='loc') {
      const loc = pressed('.chip[data-loc]')[0]?.dataset.loc ?? '', p = v('f-person'), k = v('f-date'), branch = loc==='other' ? v('f-branch') : '', note = v('f-note');
      if (!k || isOffDay(k)) { toast('휴무일입니다'); return; }
      if (loc==='other' && !branch) { toast('장소를 입력해 주세요'); $('f-branch').focus(); return; }
      if (conflict()) return;
      run(async () => {
        if (loc) await db(() => sb.from(T.member).upsert({ member_id:p, work_date:k, loc, branch:branch||null, note:note||null, change_note:`${fmtD(k)} ${P(p).name} → ${branch||LOC[loc].label}${note?' · '+note:''}` }, { onConflict:'member_id,work_date' }));
        else await db(() => sb.from(T.member).delete().eq('member_id', p).eq('work_date', k));
        await reload(T.member); done();
        const v = teamView(k), one = v?.empty && v.one && ['cityhall','forest','home','other'].includes(v.one.code) ? v.one : null;
        if (!one) { toast(`${P(p).name} · ${fmtD(k)} ${loc ? (branch||LOC[loc].label) : '팀 근무지대로'}`); return; }
        toast(`${fmtD(k)} 모두 ${one.nm}(으)로 가요. 팀 근무지도 ${one.nm}로 바꿀까요?`, () => run(async () => {
          const before = teamLoc(k), usual = routineAt(k).days[parse(k).getDay()] || 'cityhall';
          if (one.code===usual && one.code!=='other' && before.src==='override' && !before.note) await db(() => sb.from(T.team).delete().eq('work_date', k));
          else await db(() => sb.from(T.team).upsert({ work_date:k, loc:one.code, branch: one.code==='other' ? one.branch : null, note:before.src==='override' ? before.note||null : null,
            change_note:`${fmtD(k)} ${teamLocName(before)} → ${one.nm} (모두 ${one.nm})` }, { onConflict:'work_date' }));
          await reload(T.team); toast(`${fmtD(k)} 팀 근무지를 ${one.nm}로 바꿨어요`);
        }), '팀 근무지도 바꾸기');
      });
    } else {
      const kind = pressed('.chip[data-lk]')[0]?.dataset.lk, p = v('f-person'), from = v('f-date'), to = v('f-to')||from, note = v('f-note');
      if (!from) { toast('시작일을 골라 주세요'); return; }
      if (to < from) { toast('종료일이 시작일보다 빨라요'); return; }
      const clash = leaves.find(l => l.id!==ed?.ref?.id && l.person===p && l.from<=to && l.to>=from);
      if (clash) { const lb = LOC[clash.kind].label; toast(`${P(p).name}${josa(P(p).name,'은','는')} ${fmtD(clash.from)}${clash.to!==clash.from?'–'+fmtD(clash.to):''}에 이미 ${lb}${josa(lb,'이','가')} 있어요`); return; }
      if (!leaveDays(from, to, kind)) { toast('고른 기간이 모두 휴무일이에요'); return; }
      if (conflict()) return;
      const lb = LOC[kind].label, range = `${fmtD(from)}${to!==from?'–'+fmtD(to):''}`;
      const row = { member_id:p, from_date:from, to_date:to, kind, note:note||null };
      run(async () => {
        if (ed) await db(() => sb.from(T.leaves).update({ ...row, change_note:`${range} ${P(p).name} ${lb}` }).eq('id', ed.ref.id));
        else await db(() => sb.from(T.leaves).insert({ ...row, change_note:`${range} ${P(p).name} ${lb}` }));
        await reload(T.leaves); done();
        toast(ed ? `${lb}${josa(lb,'을','를')} 고쳤어요` : `${P(p).name} ${lb}${josa(lb,'을','를')} 등록했어요`);
      });
    }
  }
  function openDetail(id, k){
    const e = rawEventsOf(k).find(x=>x.id===id); if (!e) return;
    const t = EVTYPE[e.type], c = e.type==='leave' ? EVTYPE.leave.color : t.color, d = parse(k);
    const rows = [ ['일시', e.type==='leave' ? `${fmtD(e.ref.from)}${e.ref.to!==e.ref.from?' – '+fmtD(e.ref.to):''} · ${leaveDays(e.ref.from, e.ref.to, e.kind)}일` : `${d.getMonth()+1}월 ${d.getDate()}일 (${WD[d.getDay()]})${e.allday?' · 종일':` · ${e.start}${e.end?'–'+e.end:''}`}`],
      e.type==='meeting' ? ['성격', KIND[e.kind]?.label||'미팅'] : null,
      e.mt ? ['방식', e.type==='meeting' ? mtText(e) : MT[e.mt]] : null,
      e.place ? ['장소', e.place] : null,
      e.type==='wishket' ? ['상태', e.done?'미팅 완료':'미팅 예정'] : null,
      e.type==='wishket' ? ['경로', e.ref.client] : null,
      e.people.length ? [e.type==='wishket'?'담당':'참석', e.people.map(p=>P(p).name).join(', ') + (e.type==='wishket'&&e.people.length>1?' (주 · 보조)':'')] : null,
      e.repeat ? ['반복', '매주 '+WD[d.getDay()]+'요일'+(e.skipHoliday?' (공휴일 건너뜀)':'')+(e.until?` · ${fmtD(e.until)}까지`:'')] : null,
      (e.type==='meeting' && e.autoOut) || (e.type==='wishket' && e.mt==='inperson' && !atOffice(e.place)) ? ['근무지', '참석자 외근으로 표시됨'] : e.type==='meeting' && e.mt==='inperson' ? ['근무지', '그대로 (우리 사무실 미팅)'] : null,
      e.type==='leave' ? ['종류', LOC[e.kind].full] : null,
      e.project ? ['프로젝트', PROJECTS.find(w=>w.slug===e.project)?.title || '연결된 프로젝트 없음 (삭제됨)'] : null,
      e.note ? ['메모', e.note] : null ].filter(Boolean);
    const meta = e.by ? `<div class="meta">등록 ${esc(P(e.by).name)} · ${fmtAt(e.at)}${e.editedBy?` · 수정 ${esc(P(e.editedBy).name)} · ${fmtAt(e.editedAt)}`:''}</div>` : '';
    const editable = e.type==='leave' || e.type==='meeting' || ['internal','deadline','other'].includes(e.type);
    const actions = e.type==='wishket' ? `<div class="hint">워크룸 프로젝트에서 자동 반영된 미팅입니다. 일시·담당 변경은 워크룸에서 합니다.</div><div class="actions"><button class="btn primary" id="d-open">워크룸에서 열기</button><button class="btn ghost" id="d-close">닫기</button></div>`
      : !editable ? `<div class="actions"><button class="btn ghost" id="d-close">닫기</button></div>`
      : `<div class="actions"><button class="btn primary" id="d-edit">수정</button>${e.repeat?`<button class="btn danger" id="d-skip">이 회차만 삭제</button><button class="btn danger" id="d-del">반복 전체 삭제</button>`:`<button class="btn danger" id="d-del">삭제</button>`}<button class="btn ghost" id="d-close">닫기</button></div>`;
    openSheet(`<h2><span class="tag" style="font-size:.7rem;padding:.1rem .4rem;border-radius:4px;background:color-mix(in srgb,${c} 22%,transparent);color:${c}">${t.label}</span>${esc(e.title)}<button class="x" aria-label="닫기">✕</button></h2>
      <dl class="kv">${rows.map(([a,b])=>`<dt>${a}</dt><dd>${esc(b)}</dd>`).join('')}</dl>${meta}${actions}`);
    $('d-close').onclick = closeSheet;
    const edb = $('d-edit'); if (edb) edb.onclick = () => openAdd(e.type==='leave' ? 'leave' : e.ref.type==='meeting' ? 'meeting' : 'event', { edit:{ ref:e.ref, k } });
    const op = $('d-open'); if (op) op.onclick = () => { closeSheet(); ctx.onOpenProject?.(e.ref.slug); };
    const sk = $('d-skip'); if (sk) sk.onclick = () => { const prev = [...(e.ref.exdates||[])], what = `${fmtD(k)} ${e.title}`;
      run(async () => {
        await db(() => sb.from(T.events).update({ exdates:[...prev, k], change_note:`이 회차 삭제 · ${what}` }).eq('id', e.ref.id));
        await reload(T.events); closeSheet(); render();
        toast(`${fmtD(k)} 회차를 지웠어요`, () => run(async () => { await db(() => sb.from(T.events).update({ exdates:prev, change_note:`삭제 되돌림 · ${what}` }).eq('id', e.ref.id)); await reload(T.events); toast('되돌렸어요'); }));
      }); };
    const del = $('d-del'); if (del) del.onclick = () => {
      const tbl = e.type==='leave' ? T.leaves : T.events;
      const what = e.type==='leave' ? `${fmtD(e.ref.from)} ${e.title}` : `${e.repeat?'반복 전체 ':''}${fmtD(k)} ${e.title}`;
      // 삭제는 deleted_at 표시(soft delete) — 되돌리기·감사 추적이 가능하게
      const tied = e.type==='leave' ? [] : directOf(e.ref).map(o => ({ member_id:o.person, work_date:o.date, loc:o.loc, branch:o.branch, note:o.note }));
      const kids = [];
      if (e.type!=='leave' && e.repeat) { const walk = id => manual.filter(x => x.parent===id).forEach(x => { if (!kids.includes(x.id)) { kids.push(x.id); walk(x.id); } }); walk(e.ref.id); }
      run(async () => {
        await db(() => sb.from(tbl).update({ deleted_at:new Date().toISOString(), change_note:what }).eq('id', e.ref.id));
        if (kids.length) await db(() => sb.from(tbl).update({ deleted_at:new Date().toISOString(), change_note:`${what} (나뉜 일정 함께)` }).in('id', kids));
        const extra = e.type==='leave' ? '' : await syncDirect(e.ref, null);
        await reload(tbl); closeSheet(); render();
        toast(`삭제했어요${extra}`, () => run(async () => { await db(() => sb.from(tbl).update({ deleted_at:null, change_note:what }).eq('id', e.ref.id));
          if (kids.length) await db(() => sb.from(tbl).update({ deleted_at:null, change_note:`${what} (나뉜 일정 함께)` }).in('id', kids));
          for (const r of tied) await db(() => sb.from(T.member).upsert({ ...r, change_note:`${fmtD(r.work_date)} ${P(r.member_id).name} → ${r.branch} · 미팅 삭제 되돌림` }, { onConflict:'member_id,work_date' }));
          if (tied.length) await reload(T.member); await reload(tbl); toast('되돌렸어요'); }));
      }); };
  }

  // ───────── 네비 ─────────
  $('v-week').onclick = () => { state.view='week'; render(); };
  $('v-month').onclick = () => { state.view='month'; state.anchor=parse(state.sel); render(); };
  $('v-list').onclick = () => { state.view='list'; state.listDays=14; render(); };
  $('btn-today').onclick = () => { state.slide = dayDiff(state.sel, TK); state.sel=TK; state.anchor=new Date(TODAY); state.bweek=defaultBweek(); state.listDays=14; render(); };
  $('prev').onclick = () => step(-1); $('next').onclick = () => step(1);
  ['today','week','up'].forEach(s => $('s-'+s).onclick = () => { state.side = s; render(); });
  function step(n){ if (state.view==='week') { state.sel = key(addDays(parse(state.sel), 7*n)); state.anchor = parse(state.sel); }
    else if (state.view==='month') { state.anchor = new Date(state.anchor.getFullYear(), state.anchor.getMonth()+n, 1); state.sel = key(state.anchor); }
    else { state.sel = key(addDays(parse(state.sel), 14*n)); state.listDays = 14; } render(); }
  // 폰: 5일 카드 ‹ ›(5일씩 둘러보기), 하단 달력 월/주 전환, 월 이동(선택일은 유지)
  $('m-prev').onclick = () => stepStrip(-1); $('m-next').onclick = () => stepStrip(1);
  $('m-vmonth').onclick = () => { state.mview='month'; state.anchor=parse(state.sel); render(); };
  $('m-vweek').onclick = () => { state.mview='week'; state.anchor=parse(state.sel); render(); };
  // 하단 달력 이동: 월 모드는 한 달, 주 모드는 한 주 (위의 선택일은 그대로)
  const stepCal = n => { state.anchor = state.mview==='month' ? new Date(state.anchor.getFullYear(), state.anchor.getMonth()+n, 1) : addDays(state.anchor, 7*n); render(); };
  $('m-cprev').onclick = () => stepCal(-1); $('m-cnext').onclick = () => stepCal(1);
  $('log-open').onclick = openLog;
  $('btn-add-top').onclick = () => openAdd('meeting'); $('fab').onclick = () => openAdd('meeting');
  // 폰 ＋ 버튼 (2026-11-03): 아래로 스크롤하는 동안 숨기고 위로 올리면 다시 — 맨 오른쪽(일요일) 칸을 가리지 않게.
  // 하단 달력 화살표는 그 줄 오른쪽 여백(.calnav)으로 버튼 자리를 피한다.
  let fabY = window.scrollY;
  const fabAway = v => { const f = $('fab'); if (!f) return; f.classList.toggle('away', v); f.tabIndex = v ? -1 : 0; };
  on(window, 'scroll', () => { const y = window.scrollY, dy = y - fabY; if (y <= 120) { fabAway(false); fabY = y; return; }
    if (Math.abs(dy) < 6) return; fabAway(dy > 0); fabY = y; }, { passive:true });
  on(document, 'keydown', e => { if (e.metaKey || e.ctrlKey || e.altKey || e.target.matches('input,select,textarea') || !$('ovl').hidden) return;
    if (e.key==='ArrowLeft') step(-1); if (e.key==='ArrowRight') step(1); if (e.key==='t') $('btn-today').click(); if (e.key==='n') openAdd('meeting'); });

  // ───────── 푸시 알림 (아이폰 홈 화면 앱 · PC 브라우저) ─────────
  // 아이폰은 Safari 에서 '홈 화면에 추가'한 앱 안에서만 알림을 받을 수 있다 (iOS 16.4+). 권한 요청은 반드시 버튼 클릭 안에서.
  // 기기 등록은 register_push_subscription RPC — 팀원 연결은 서버가 로그인 계정으로 정한다. 발송은 엣지 함수 calendar-push.
  const VAPID_PUBLIC_KEY = 'BCaQ2NbcCki8sOC4t3vU860TtVGF82ljC8H2hUewWCQsJdEwLUhU3afAYuQLwuNQY26XsnYEv97OdM3s7J0WTkk';
  function pushEnv(){
    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    return { ios, standalone, supported, perm: supported ? Notification.permission : 'unsupported',
      platform: ios ? (standalone ? 'ios-home' : 'ios-safari') : /Android/i.test(ua) ? 'android' : 'desktop' };
  }
  const b64uToBytes = s => { const b = atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  let swPromise = null, pushRow = null;
  const swReg = () => (swPromise ||= ('serviceWorker' in navigator ? navigator.serviceWorker.register('sw.js').catch(e => { console.warn('서비스 워커 등록 실패:', e); swPromise = null; return null; }) : Promise.resolve(null)));
  async function currentSub(){ const reg = await swReg(); return reg ? reg.pushManager.getSubscription() : null; }
  async function saveSub(sub){
    const j = sub.toJSON(), env = pushEnv();
    const { data, error } = await sb.rpc('register_push_subscription', { p_endpoint:j.endpoint, p_p256dh:j.keys.p256dh, p_auth:j.keys.auth, p_platform:env.platform, p_user_agent:navigator.userAgent.slice(0,300) });
    if (error) throw error; pushRow = data; return data;
  }
  // 열 때마다: 이미 허용한 기기면 구독을 DB와 맞춘다 (구독 재발급·다른 계정 로그인 대비)
  async function syncPush(){
    const env = pushEnv(); if (!env.supported || env.perm !== 'granted' || !ME) return;
    try { const sub = await currentSub(); if (sub) await saveSub(sub); } catch (e) { console.warn('알림 동기화 실패:', e); }
  }
  async function enablePush(){
    if (!ME) { toast('팀원 계정과 연결된 사람만 알림을 켤 수 있어요'); return; }
    let perm;
    try { perm = await Notification.requestPermission(); } catch (_) { perm = 'denied'; }
    if (perm !== 'granted') { toast('알림이 허용되지 않았어요'); openPush(); return; }
    await run(async () => {
      const reg = await swReg(); if (!reg) throw new Error('서비스 워커를 등록하지 못했어요');
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:b64uToBytes(VAPID_PUBLIC_KEY) });
      await saveSub(sub); toast('이 기기에서 알림을 켰어요');
    });
    openPush();
  }
  async function disablePush(){
    await run(async () => {
      const sub = await currentSub();
      if (sub) { await db(() => sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)); await sub.unsubscribe(); }
      pushRow = null; toast('이 기기 알림을 껐어요');
    });
    openPush();
  }
  async function setPushPref(patch){
    if (!pushRow) return;
    await run(async () => { pushRow = await db(() => sb.from('push_subscriptions').update(patch).eq('id', pushRow.id).select().single()); });
    openPush();
  }
  async function testPush(){
    const sub = await currentSub();
    const { data, error } = await sb.functions.invoke('calendar-push', { body:{ test:true, endpoint: sub?.endpoint } });
    if (error) toast('테스트 알림을 보내지 못했어요');
    else toast(data?.sent ? '테스트 알림을 보냈어요. 잠시 후 도착합니다' : '이 기기를 찾지 못했어요. 알림을 껐다 다시 켜 주세요');
  }
  // 알림이 차단된 기기에서 푸는 방법 — 기기·브라우저·앱 창 여부마다 다르다 (2026-11-04: 맥 크롬 앱 창엔 주소창이 없어 '자물쇠' 안내로는 못 풀었음)
  function blockedHelp(env){
    const ua = navigator.userAgent, edge = /Edg\//.test(ua), chromium = edge || /Chrome\/|Chromium/.test(ua), mac = /Macintosh/.test(ua);
    const os = mac ? `맥 시스템 설정 → 알림 → ${edge ? 'Microsoft Edge' : 'Google Chrome'}` : `윈도우 설정 → 시스템 → 알림 → ${edge ? 'Microsoft Edge' : 'Google Chrome'}`;
    if (env.ios) return '아이폰 설정 → 알림 → 워크룸 → 알림 허용을 켠 뒤 앱을 다시 열어 주세요.';
    if (/Android/i.test(ua)) return '크롬 주소창 왼쪽 아이콘(또는 홈 화면 앱이면 휴대폰 설정 → 애플리케이션 → 워크룸 → 알림)에서 알림을 허용한 뒤 새로고침해 주세요.';
    if (chromium && env.standalone) return `앱 창 오른쪽 위 ⋮ → '앱 정보' → 알림을 '허용'으로 바꾼 뒤 새로고침해 주세요. 메뉴가 안 보이면 ${edge ? '엣지' : '크롬'} 주소창에 <b>${edge ? 'edge' : 'chrome'}://settings/content/notifications</b> 를 열고 차단 목록의 ${location.hostname} 를 허용으로 바꿉니다. ${os} 도 켜져 있어야 합니다.`;
    if (chromium) return `주소창 왼쪽 아이콘(사이트 정보) → 알림 → 허용으로 바꾼 뒤 새로고침해 주세요. ${os} 도 켜져 있어야 합니다.`;
    if (/Safari\//.test(ua) && env.standalone) return '맥 시스템 설정 → 알림 → 워크룸 → 알림 허용을 켠 뒤 앱을 다시 열어 주세요.';
    if (/Safari\//.test(ua)) return `Safari 메뉴 → 설정 → 웹사이트 → 알림 → ${location.hostname} 를 허용으로 바꾼 뒤 새로고침해 주세요.`;
    return '주소창 왼쪽 사이트 정보(자물쇠)에서 알림을 허용한 뒤 새로고침해 주세요.';
  }
  async function openPush(){
    const env = pushEnv();
    const head = `<h2>알림 설정<button class="x" aria-label="닫기">✕</button></h2>`;
    const what = `<div class="hint" style="margin-bottom:.9rem">받는 알림: 근무일 저녁 6시 다음 근무일 안내(내가 갈 곳·내 일정·팀원 모두의 근무지), 다음 근무일까지의 팀·팀원 근무지와 휴가가 바뀌었을 때, 남이 내 근무지·휴가·일정을 바꿨을 때(날짜 상관없이). 바꾼 사람에겐 가지 않고, 밤 10시~아침 7시 30분 변경은 아침에 옵니다.</div>`;
    const stat = (c, t) => `<div class="pstat" style="--c:${c}"><i></i>${t}</div>`;
    let body;
    if (env.ios && !env.standalone) {
      body = stat('var(--yellow)', '아이폰은 홈 화면 앱에서만 알림을 받을 수 있어요') + `<ol class="steps">
        <li>Safari 아래쪽 <b>공유 버튼</b>(네모에 화살표)을 누릅니다.</li>
        <li><b>홈 화면에 추가</b>를 누르고 이름 '워크룸'으로 추가합니다.</li>
        <li>홈 화면의 <b>워크룸</b> 아이콘으로 열고 로그인합니다. (Safari 와 로그인이 따로입니다)</li>
        <li>캘린더 오른쪽 위 🔔 를 눌러 <b>알림 켜기</b>를 누릅니다.</li></ol>
        <div class="hint">iOS 16.4 이상이 필요합니다. 크롬 앱이 아니라 Safari 에서 추가해야 합니다.</div>`;
    } else if (!env.supported) {
      body = stat('var(--text2)', '이 브라우저는 푸시 알림을 지원하지 않아요') + `<div class="hint">아이폰은 홈 화면 앱, PC 는 크롬·엣지·사파리에서 켤 수 있어요.</div>`;
    } else if (env.perm === 'denied') {
      body = stat('var(--red)', '이 기기에서 알림이 차단돼 있어요') + `<div class="hint">${blockedHelp(env)}</div>
        <div class="hint" style="margin-top:.4rem">한 번 차단하면 화면에서 다시 물어볼 수 없어 설정에서 직접 풀어야 해요. 푼 뒤 🔔 → '이 기기에서 알림 켜기'를 누르세요.</div>`;
    } else {
      // 열 때마다 구독 행을 새로 읽는다 — 마지막으로 받은 알림 시각이 페이지를 연 시점에 멈춰 있지 않게
      let sub = null; try { sub = await currentSub(); if (sub && env.perm === 'granted') await saveSub(sub); } catch (e) { console.warn(e); }
      if (sub && pushRow && env.perm === 'granted') {
        // morning_brief 컬럼 = '다음 근무일 안내' 켜기/끄기 (이름은 첫 설계 때 것)
        body = stat('var(--green)', '이 기기에서 알림을 받고 있어요') + `
          <div class="fld"><label class="ck"><input type="checkbox" id="p-brief" ${pushRow.morning_brief?'checked':''}>저녁 6시 다음 근무일 안내 <small style="color:var(--text2)">· 근무일마다 내가 갈 곳·내 일정·팀원 모두의 근무지 (안내 뒤 바뀌면 변경 알림)</small></label></div>
          <div class="fld"><label class="ck"><input type="checkbox" id="p-change" ${pushRow.change_alerts?'checked':''}>근무지·휴가·내 일정 변경 알림 <small style="color:var(--text2)">· 다음 근무일까지의 팀·팀원 근무지와 휴가, 남이 바꾼 내 근무지·휴가·일정 · 밤 10시~아침 7시 30분 변경은 아침에</small></label></div>
          <div class="hint">${pushRow.last_sent_at ? `이 기기가 마지막으로 받은 알림: <b>${esc(fmtAt(toKst(pushRow.last_sent_at)))}</b> · ` : '이 기기는 아직 받은 알림이 없어요 · '}다음 근무일 안내는 근무일 저녁 6시에 옵니다. 안 오면 '테스트 알림'으로 확인하세요.</div>
          <div class="hint">설정은 기기마다 따로입니다. 다른 기기에서도 받으려면 그 기기에서 켜 주세요.</div>
          <div class="actions"><button class="btn" id="p-test">테스트 알림</button><button class="btn danger" id="p-off">이 기기 알림 끄기</button></div>`;
      } else {
        body = stat('var(--text2)', '이 기기에서는 아직 알림이 꺼져 있어요') + what + `<div class="actions"><button class="btn primary" id="p-on">이 기기에서 알림 켜기</button></div>`;
      }
    }
    if (!ME) body = stat('var(--yellow)', '팀원 계정과 연결된 사람만 알림을 켤 수 있어요') + `<div class="hint">워크룸 메뉴의 팀 관리에서 로그인 계정을 연결해 주세요.</div>`;
    openSheet(head + body + `<div class="hint" id="p-health" style="margin-top:.6rem"></div>`);
    // 알림 서버(5분마다 실행) 상태 — '평소와 다를 때만' 오는 알림이라 멈춰도 모를 수 있어 마지막 실행 시각을 보여 주고 15분 넘으면 경고 (2026-11-03)
    sb.rpc('calendar_push_status').then(({ data, error }) => { const el = $('p-health'); if (!el || error || !data?.at) return;
      const m = Math.max(0, Math.round((Date.now() - Date.parse(data.at)) / 60000));
      if (m <= 15) el.textContent = `알림 서버 정상 · ${m < 1 ? '방금' : m + '분 전'} 실행`;
      else { el.className = 'hint warn'; el.textContent = `알림 서버가 ${m >= 120 ? Math.round(m / 60) + '시간' : m + '분'}째 실행되지 않았어요. 관리자에게 알려 주세요.`; } });
    const q = id => $(id);
    if (q('p-on')) q('p-on').onclick = enablePush;
    if (q('p-off')) q('p-off').onclick = disablePush;
    if (q('p-test')) q('p-test').onclick = testPush;
    if (q('p-brief')) q('p-brief').onchange = e => setPushPref({ morning_brief:e.target.checked });
    if (q('p-change')) q('p-change').onchange = e => setPushPref({ change_alerts:e.target.checked });
  }
  $('btn-push').onclick = () => openPush();
  // ───────── 설정: 팀 주간 근무 패턴 ─────────
  // 매주 반복되는 팀 근무지는 날짜 창이 아니라 여기서만 바꾼다 (2026-11-04 사용자 결정). 적용일부터 새 패턴, 그 전은 그대로.
  // 그날만 정한 근무지(team_work_overrides)는 패턴을 바꿔도 남는다.
  const PAT_LOCS = ['cityhall','forest','home'];
  function openSettings(){
    if (!ME) { toast('팀원 계정과 연결된 사람만 바꿀 수 있어요'); return; }
    // 적용일 기본값: 다음 주 월요일 (이번 주 중간에 바뀌지 않게)
    const k0 = key(addDays(monday(TODAY), 7));
    const days = { ...routineAt(k0).days };
    const head = `<h2>설정<button class="x" aria-label="닫기">✕</button></h2>`;
    // 지난 패턴 이력은 보여 주지 않는다('1/1~' 같은 시작일이 무슨 뜻인지 헷갈림 — 2026-11-04 사용자 QA). 앞으로 바뀔 예정만, 취소할 수 있게.
    const cur = routineAt(TK);
    const chg = r => { const c = [1,2,3,4,5].filter(w => (r.days[w]||'cityhall')!==(cur.days[w]||'cityhall'));
      return c.length ? '매주 ' + c.map(w => `${WD[w]} ${LOC[cur.days[w]||'cityhall'].label} → ${LOC[r.days[w]||'cityhall'].label}`).join(', ') : '지금과 같음'; };
    const futs = ROUTINES.filter(r => r.from > TK).sort((a,b)=>a.from<b.from?-1:1);
    const futH = futs.length ? `<div class="setsec" style="margin-top:1.1rem">예정된 변경</div><div class="phist">${futs.map(r =>
      `<div class="e"><b class="tnum">${fmtD(r.from)}부터</b><span>${esc(chg(r))}</span><button type="button" class="btn danger" data-delpat="${r.id}">취소</button></div>`).join('')}</div>` : '';
    openSheet(head + `<form id="f-set">
      <div class="setsec">팀 주간 근무 패턴</div>
      <div class="hint" style="margin-bottom:.6rem">요일마다 팀이 평소 일하는 곳입니다. 하루만 바꿀 때는 그 날짜를 눌러 '변경'을 쓰세요.</div>
      <div class="pat" id="pat">${[1,2,3,4,5].map(w => `<div class="pr"><b>${WD[w]}</b><div class="sub">${PAT_LOCS.map(c => `<button type="button" data-w="${w}" data-pl="${c}" style="--c:${LOC[c].color}" aria-pressed="${(days[w]||'cityhall')===c}">${LOC[c].label}</button>`).join('')}</div></div>`).join('')}</div>
      <div class="fld"><label for="f-from">적용 시작일</label><input id="f-from" type="date" min="${key(addDays(TODAY,1))}" value="${k0}"></div>
      <div class="hint" id="pat-diff"></div>
      <div class="actions"><button type="submit" class="btn primary" id="pat-save">패턴 저장</button></div>
    </form>
    ${futH}
    <div class="hint" style="margin-top:1.1rem">누가 언제 무엇을 바꿨는지는 <button type="button" class="lnk" id="set-log">변경 기록 보기</button></div>`);
    $('set-log').onclick = () => openLog();
    const base = () => routineAt($('f-from').value || k0).days;
    const sync = () => { const b = base(), ch = [1,2,3,4,5].filter(w => (b[w]||'cityhall')!==days[w]);
      $('pat').querySelectorAll('[data-pl]').forEach(x => x.classList.toggle('chg', x.getAttribute('aria-pressed')==='true' && ch.includes(Number(x.dataset.w))));
      $('pat-diff').innerHTML = ch.length ? `${esc(fmtD($('f-from').value||k0))}부터 매주 ${ch.map(w => `${WD[w]} ${LOC[b[w]||'cityhall'].label} → <b>${LOC[days[w]].label}</b>`).join(', ')}. 그 전 날짜와 그날만 정한 근무지는 그대로입니다. 변경은 <b>${esc(P(ME).name)}</b> 이름으로 기록되고 팀에 알림이 갑니다.` : '바뀐 요일이 없습니다.';
      $('pat-save').disabled = !ch.length; };
    [1,2,3,4,5].forEach(w => { days[w] = days[w] || 'cityhall'; });
    $('pat').querySelectorAll('[data-pl]').forEach(b => b.onclick = () => {
      b.parentElement.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed','false')); b.setAttribute('aria-pressed','true');
      days[b.dataset.w] = b.dataset.pl; sync(); });
    $('f-from').onchange = sync; sync();
    $('f-set').onsubmit = e => { e.preventDefault();
      const k = $('f-from').value; if (!k) { toast('적용 시작일을 골라 주세요'); return; }
      if (k <= TK) { toast('적용 시작일은 내일 이후로 골라 주세요'); return; }
      const b = base(), ch = [1,2,3,4,5].filter(w => (b[w]||'cityhall')!==days[w]); if (!ch.length) return;
      const note = `${fmtD(k)}부터 매주 ${ch.map(w => `${WD[w]} ${LOC[days[w]].label}`).join(', ')}`;
      run(async () => {
        await db(() => sb.from(T.routines).upsert({ valid_from:k, days:{ ...days }, change_note:note }, { onConflict:'valid_from' }));
        await reload(T.routines); toast('주간 근무 패턴을 저장했어요'); openSettings();
      });
    };
    $('sheet').querySelectorAll('[data-delpat]').forEach(b => b.onclick = () => {
      const r = ROUTINES.find(x => x.id===b.dataset.delpat); if (!r) return;
      if (!window.confirm(`${fmtD(r.from)}부터 적용 예정인 패턴을 취소할까요?`)) return;
      run(async () => { await db(() => sb.from(T.routines).delete().eq('id', r.id)); await reload(T.routines); toast('예정된 패턴을 취소했어요'); openSettings(); });
    });
  }
  $('btn-set').onclick = () => openSettings();

  // ───────── 시작·실시간·정리 ─────────
  // 폭 클래스: 컨테이너 밖(화면 고정) 요소용 — wide ≥900px(데스크톱 레이아웃), narrow ≤640px(시트를 아래에서)
  const ro = new ResizeObserver(([e]) => { const w = e.contentRect.width, was = root.classList.contains('wide'); root.classList.toggle('wide', w >= 900); root.classList.toggle('narrow', w <= 640);
    if (w >= 900 || was) onResize(); });   // 처음 넓다고 판정됐을 때도 창 높이에 맞춰 다시 그림
  ro.observe($('shell')); cleanups.push(() => ro.disconnect());
  // 세 명이 동시에 보고 있어도 바로 반영 — 바뀐 테이블만 다시 읽는다(잇단 이벤트는 묶어서)
  const pending = new Set(); let reloadT = null;
  const channel = sb.channel(`calendar-${Math.random().toString(36).slice(2,10)}`);
  Object.values(T).filter(t => t!==T.holidays).forEach(t => channel.on('postgres_changes', { event:'*', schema:'public', table:t }, () => {
    pending.add(t); clearTimeout(reloadT);
    reloadT = setTimeout(() => { const ts = [...pending]; pending.clear(); reload(...ts).catch(e => console.warn('실시간 갱신 실패:', e)); }, 250);
  }));
  // 연결이 끊겼다 다시 붙으면(절전·네트워크 전환) 그 사이 변경을 놓쳤을 수 있으니 한 번 다시 읽는다
  let chanBroken = false;
  channel.subscribe(status => {
    if (status==='SUBSCRIBED') { if (chanBroken && loaded && !setupNeeded) loadAll(); chanBroken = false; }
    else if (status==='CHANNEL_ERROR' || status==='TIMED_OUT' || status==='CLOSED') chanBroken = true; });
  cleanups.push(() => { clearTimeout(reloadT); sb.removeChannel(channel); });
  // 날짜가 바뀌면(자정을 넘겨 열어 둔 경우) 오늘 기준을 다시 잡고, 앱으로 돌아오면(아이폰 홈 화면 앱) 최신으로 다시 읽기
  // 공휴일 데이터가 곧 끝나면 경고 (2026-11-06) — calendar_holidays 는 정부가 다음 해 공휴일을 확정한 뒤 마이그레이션으로 넣는다.
  //   빠지면 그해 공휴일이 근무일로 계산돼 근무지가 보이고, 18시 안내가 가고, 반복 일정이 건너뛰지 않는다. 마지막 해 9월부터 알린다.
  function holidayWarn(){
    const el = $('hol-warn'); if (!el) return;
    const last = Object.keys(HOLIDAYS).sort().pop(); if (!last) { el.hidden = true; return; }
    const y = +last.slice(0, 4), soon = TK >= `${y}-09-01`;
    el.hidden = !soon;
    if (soon) el.textContent = `⚠ ${y + 1}년 공휴일이 아직 등록되지 않았어요. 이대로면 ${y + 1}년 공휴일도 근무일로 계산돼 근무지·알림이 나갑니다. 관리자에게 알려 주세요.`;
  }
  // 알림 서버(5분마다 실행)가 30분 넘게 멈추면 캘린더를 연 모두에게 경고 — 설정 창은 거의 안 열어서 거기만으로는 아무도 모른다 (2026-11-03)
  async function checkPushHealth(){
    const el = $('push-down'); if (!el || destroyed) return;
    try { const { data, error } = await sb.rpc('calendar_push_status'); if (destroyed) return;
      const m = !error && data?.at ? Math.round((Date.now() - Date.parse(data.at)) / 60000) : 0;
      el.hidden = m <= 30;
      if (m > 30) el.textContent = `⚠ 알림 서버가 ${m >= 120 ? Math.round(m / 60) + '시간' : m + '분'}째 멈춰 있어요. 그동안 근무지·일정 알림이 가지 않습니다. 관리자에게 알려 주세요.`;
    } catch (_) { el.hidden = true; }
  }
  let healthN = 0;
  const tick = setInterval(() => { if (++healthN % 5 === 0 && !HEADLESS) checkPushHealth(); const d = new Date(); d.setHours(0,0,0,0); if (key(d)!==TK) { const wasToday = state.sel===TK; TODAY = d; TK = key(d); if (wasToday) state.sel = TK; holidayWarn(); render(); } }, 60000);
  cleanups.push(() => clearInterval(tick));
  // 탭·앱으로 돌아올 때: 실시간 반영이 있으니 2분 넘게 숨겨져 있었을 때만 다시 읽는다 (아이폰 홈 화면 앱은 숨으면 연결이 멈춤)
  let hiddenAt = document.hidden ? Date.now() : 0;   // 백그라운드 탭에서 열렸으면 그때부터 숨김으로 친다
  on(document, 'visibilitychange', () => {
    if (document.visibilityState==='hidden') { hiddenAt = Date.now(); return; }
    if (loaded && !setupNeeded && hiddenAt && Date.now() - hiddenAt > 120000) { loadAll(); if (!HEADLESS) checkPushHealth(); } });
  setContext(ctx);
  if (!HEADLESS && pushEnv().supported) swReg();   // 미리 등록해 두면 '알림 켜기'가 빨라진다(캐시는 안 함)
  const cached = CAL_CACHE && CAL_CACHE.tk === TK && CAL_CACHE.me === ME && Date.now() - CAL_CACHE.at < 30*60000 ? CAL_CACHE : null;
  if (cached) {
    ({ ROUTINES, HOLIDAYS, manual, leaves, teamOverrides, personOverrides, span, have } = cached.data);
    Object.assign(state, cached.ui, { anchor:new Date(cached.ui.anchor) });
    loaded = true; $('cal-loading').hidden = true; $('cal-body').hidden = false; render();
  }
  // 워크룸에서 날짜를 눌러 들어온 경우(#calendar?d=YYYY-MM-DD): 그 날로 가서 PC는 날짜 창을 열고 폰은 그 날을 고른다 (2026-11-04)
  //   주소는 #calendar 로 되돌려 새로고침 때 창이 다시 열리지 않게 한다.
  const jump = !HEADLESS && /^\d{4}-\d{2}-\d{2}$/.test(ctx.initialDate || '') ? ctx.initialDate : null;
  let jumped = false;
  const doJump = () => { if (!jump || jumped || destroyed || !loaded || setupNeeded) return; jumped = true;
    requestAnimationFrame(() => { if (destroyed) return; if ($('shell').getBoundingClientRect().width >= 900) openDay(jump, true); else selectDay(jump); }); };
  if (jump) { state.sel = jump; state.anchor = parse(jump); state.slide = 0; if (state.view==='list') state.listDays = 14;
    try { history.replaceState(null, '', location.pathname + location.search + '#calendar'); } catch (_) {}
    if (loaded) { render(); doJump(); } }
  loadAll().then(() => { doJump(); if (HEADLESS) return; syncPush(); checkPushHealth(); });
  return { setContext, destroy(){
    if (loaded && !setupNeeded) CAL_CACHE = { at:Date.now(), tk:TK, me:ME, data:{ ROUTINES, HOLIDAYS, manual, leaves, teamOverrides, personOverrides, span, have },
      ui:{ view:state.view, mview:state.mview, anchor:state.anchor.getTime(), sel:state.sel, bweek:state.bweek, side:state.side, listDays:state.listDays } };
    destroyed = true; cleanups.splice(0).forEach(f => { try { f(); } catch (_) {} }); root.innerHTML = ''; } };
}
