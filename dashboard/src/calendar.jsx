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
const { useEffect: useEffectCal, useRef: useRefCal } = React;

const CAL_CSS = ".fpcal{--pink:#fd79a8;--teal:#00cec9;--avbg:#3a3f55;--avfg:#e4e6f0;color:var(--text);line-height:1.5;-webkit-tap-highlight-color:transparent}\n[data-theme=\"light\"] .fpcal{--pink:#db2777;--teal:#0891b2;--avbg:#d5d7e3;--avfg:#1a1d2e}\n.fpcal *,.fpcal *::before,.fpcal *::after{box-sizing:border-box;margin:0;padding:0}\n.fpcal button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}\n.fpcal input,.fpcal select,.fpcal textarea{font:inherit;color:var(--text);background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:.5rem .65rem;width:100%;min-width:0}\n.fpcal input:focus-visible,.fpcal select:focus-visible,.fpcal textarea:focus-visible,.fpcal button:focus-visible{outline:2px solid var(--accent2);outline-offset:1px}\n.fpcal .tnum{font-variant-numeric:tabular-nums}\n.fpcal [hidden]{display:none!important}\n.fpcal .shell{container-type:inline-size;container-name:app;position:relative}\n.fpcal .app{padding-bottom:calc(90px + env(safe-area-inset-bottom,0px))}\n.fpcal .top{position:sticky;top:0;z-index:20;background:var(--bg);padding:calc(.85rem + env(safe-area-inset-top,0px)) 0 .6rem;display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}\n.fpcal .top h1{font-size:1.25rem;font-weight:700;letter-spacing:-.02em;margin-right:auto;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}\n.fpcal .top h1 small{font-size:.72rem;font-weight:500;color:var(--text2);padding:.1rem .45rem;border:1px solid var(--border);border-radius:20px}\n.fpcal .seg{display:inline-flex;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:2px}\n.fpcal .seg button{padding:.35rem .7rem;border-radius:8px;font-size:.82rem;color:var(--text2);font-weight:500}\n.fpcal .seg button[aria-pressed=\"true\"]{background:var(--surface);color:var(--text);font-weight:600;box-shadow:0 1px 3px var(--shadow)}\n.fpcal .btn{padding:.42rem .8rem;border-radius:8px;font-size:.84rem;font-weight:600;border:1px solid var(--border);background:var(--surface2)}\n.fpcal .btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}\n.fpcal .btn.danger{color:var(--red);border-color:color-mix(in srgb,var(--red) 40%,transparent)}\n.fpcal .btn.ghost{border-color:transparent;background:transparent;color:var(--text2)}\n.fpcal .btn:disabled{opacity:.5;cursor:not-allowed}\n.fpcal .nav{display:flex;align-items:center;gap:.5rem;margin:.4rem 0 .8rem;flex-wrap:wrap}\n.fpcal .nav .range{font-weight:700;font-size:1.05rem;letter-spacing:-.01em}\n.fpcal .nav .arrow{width:34px;height:34px;border-radius:8px;border:1px solid var(--border);background:var(--surface);font-size:1rem;display:grid;place-items:center}\n.fpcal .nav .spacer{flex:1}\n.fpcal .role{display:inline-flex;align-items:center;gap:.4rem;font-size:.76rem;color:var(--text2)}\n.fpcal .layout{display:none;grid-template-columns:300px minmax(0,1fr);gap:1rem;align-items:start}\n.fpcal .mobile{display:flex;flex-direction:column;gap:.75rem}\n@container app (min-width: 900px){.fpcal .layout{display:grid}\n.fpcal .mobile,.fpcal .fab{display:none}}\n@container app (max-width: 899px){.fpcal .nav,.fpcal .top .seg,.fpcal .top h1 small,.fpcal #btn-add-top{display:none}}\n.fpcal .mobile{max-width:640px;width:100%;margin:0 auto}\n@container app (min-width: 900px){.fpcal .side{position:sticky;top:70px;max-height:calc(100vh - 82px);overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;padding-bottom:6px}}\n.fpcal .wnav{display:flex;align-items:center;gap:.5rem}\n.fpcal .wnav .range{font-weight:700;font-size:1rem;letter-spacing:-.01em;flex:1}\n.fpcal .wnav .arrow{width:32px;height:32px;border-radius:8px;border:1px solid var(--border);background:var(--surface);display:grid;place-items:center}\n.fpcal .wnav .seg button{padding:.3rem .65rem}\n.fpcal .mday .today-head{margin-bottom:.6rem}\n.fpcal .mday .now{font-size:.74rem;font-weight:700;color:var(--accent2)}\n.fpcal .mday .cnt{font-size:.78rem;color:var(--text2);margin-left:auto}\n.fpcal .mday .evlist{margin-top:.75rem;padding-top:.7rem;border-top:1px dashed var(--border)}\n.fpcal .mday .ev{padding:.6rem .7rem}\n.fpcal .mday .ev .ti{font-size:.9rem;white-space:normal}\n.fpcal .mday .ev .su{font-size:.76rem;white-space:normal;flex-wrap:wrap}\n.fpcal .mday .ev .t{font-size:.8rem;width:3.4rem}\n.fpcal .side{display:flex;flex-direction:column;gap:.9rem}\n.fpcal .card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:.85rem .95rem}\n.fpcal .card h3{font-size:.76rem;font-weight:600;color:var(--text2);letter-spacing:.04em;text-transform:uppercase;margin-bottom:.55rem;display:flex;align-items:center;gap:.4rem}\n.fpcal .card h3 .r{margin-left:auto;font-weight:500;letter-spacing:0;text-transform:none;font-size:.72rem;color:var(--text2)}\n.fpcal .teamloc{display:flex;align-items:center;gap:.6rem;padding:.6rem .75rem;border-radius:10px;border:1px solid;min-width:0}\n.fpcal .teamloc .ic{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;font-size:1.1rem;flex-shrink:0;background:color-mix(in srgb,currentColor 18%,transparent)}\n.fpcal .teamloc .tx{min-width:0;flex:1}\n.fpcal .teamloc .tx>span{display:block}\n.fpcal .teamloc .tx .l2{white-space:normal;word-break:keep-all}\n.fpcal .teamloc .l1{font-size:.66rem;font-weight:600;letter-spacing:.04em;opacity:.8}\n.fpcal .teamloc .l2{font-size:.98rem;font-weight:700;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)}\n.fpcal .teamloc .l3{font-size:.7rem;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.fpcal .teamloc .edit{font-size:.74rem;color:var(--text2);padding:.25rem .5rem;border:1px solid var(--border);border-radius:6px;flex-shrink:0;background:var(--surface)}\n.fpcal .today-head{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin-bottom:.6rem}\n.fpcal .sheet .today-head .x{margin-left:.1rem}\n.fpcal .today-head .d{font-size:1.15rem;font-weight:700}\n.fpcal .today-head .hol{color:var(--red);font-weight:600;font-size:.85rem}\n.fpcal .people{display:flex;flex-direction:column;gap:.4rem;margin-top:.6rem}\n.fpcal .prow{display:flex;align-items:center;gap:.6rem;min-width:0}\n.fpcal .prow .nm{font-weight:600;font-size:.88rem;width:3.6rem;flex-shrink:0}\n.fpcal .prow .nm small{display:block;font-size:.62rem;font-weight:500;color:var(--text2);line-height:1}\n.fpcal .prow .note{color:var(--text2);font-size:.74rem;margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}\n.fpcal .av{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-size:.72rem;font-weight:700;color:var(--avfg);background:var(--avbg);flex-shrink:0}\n.fpcal .av.me{outline:2px solid var(--accent);outline-offset:-1px}\n.fpcal .loc{display:inline-flex;align-items:center;gap:.3rem;padding:.15rem .5rem;border-radius:20px;font-size:.76rem;font-weight:600;border:1px solid;white-space:nowrap}\n.fpcal .loc i{width:7px;height:7px;border-radius:50%;background:currentColor}\n.fpcal .loc.editable{cursor:pointer}\n.fpcal .loc.same{color:var(--text2);border-color:var(--border);background:transparent}\n.fpcal .loc.same i{opacity:.9}\n.fpcal .mystat{margin-top:.75rem;display:flex;flex-direction:column;gap:.35rem}\n.fpcal .mystat .h{font-size:.74rem;font-weight:700;color:var(--text)}\n.fpcal .mystat .h small{font-weight:500;color:var(--text2);font-size:.68rem}\n.fpcal .mystat .opts{display:flex;gap:3px;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:3px}\n.fpcal .mystat .opts button{flex:1 1 auto;padding:.5rem .45rem;border-radius:8px;font-size:.8rem;font-weight:600;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}\n.fpcal .mystat .opts button[aria-pressed=\"true\"]{background:var(--surface);color:var(--c);box-shadow:0 1px 3px var(--shadow);outline:1.5px solid color-mix(in srgb,var(--c) 55%,transparent);outline-offset:-1.5px}\n.fpcal .mystat .opts button[data-q=\"more\"]{color:var(--text2);font-weight:500}\n.fpcal .offday{font-size:.86rem;font-weight:600;color:var(--text2);padding:.5rem .1rem .1rem}\n.fpcal .mystat .leave{font-size:.84rem;font-weight:600;color:var(--red)}\n.fpcal .addday{align-self:flex-start;padding:.3rem .4rem}\n.fpcal .wb-h{display:flex;align-items:center;gap:.35rem;margin-bottom:.6rem}\n.fpcal .wb-h h3{margin:0}\n.fpcal .wb-h .r{margin-left:auto;font-size:.74rem;color:var(--text2)}\n.fpcal .wb-h .arrow{width:26px;height:26px;border-radius:7px;border:1px solid var(--border);background:var(--surface2);display:grid;place-items:center;font-size:.9rem}\n.fpcal .wb{display:flex;flex-direction:column;gap:3px}\n.fpcal .wb-row{display:grid;grid-template-columns:2.4rem minmax(0,1fr);gap:.5rem;align-items:start;padding:.4rem .45rem;border-radius:10px;border:1px solid transparent}\n.fpcal .wb-row.today{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 7%,transparent)}\n.fpcal .wb-row.past{opacity:.5}\n.fpcal .wb-d{display:flex;flex-direction:column;align-items:center;line-height:1.15;padding-top:2px;border-radius:6px}\n.fpcal .wb-d:hover{background:var(--surface2)}\n.fpcal .wb-d .w{font-size:.68rem;color:var(--text2)}\n.fpcal .wb-d .n{font-size:1.05rem;font-weight:700}\n.fpcal .wb-row.today .wb-d .n{color:var(--accent2)}\n.fpcal .wb-main{min-width:0;display:flex;flex-direction:column;gap:3px}\n.fpcal .wb-team{display:flex;align-items:center;gap:.4rem;padding:.38rem .55rem;border-radius:8px;font-size:.86rem;font-weight:700;text-align:left;width:100%;min-width:0;color:var(--c);background:color-mix(in srgb,var(--c) 12%,transparent);border:1px solid color-mix(in srgb,var(--c) 35%,transparent)}\n.fpcal .wb-team:hover{background:color-mix(in srgb,var(--c) 20%,transparent)}\n.fpcal .wb-team .ic{font-size:.9rem;flex-shrink:0}\n.fpcal .wb-team .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)}\n.fpcal .wb-team em{font-style:normal;font-size:.66rem;font-weight:600;margin-left:auto;flex-shrink:0;white-space:nowrap}\n.fpcal .wb-ex{display:flex;align-items:center;gap:.35rem;font-size:.78rem;padding:2px .3rem;border-radius:6px;text-align:left;width:100%;min-width:0}\n.fpcal .wb-ex:hover{background:var(--surface2)}\n.fpcal .wb-ex .av{width:18px;height:18px;font-size:.56rem}\n.fpcal .wb-ex span{font-weight:600;flex-shrink:0}\n.fpcal .wb-ex b{font-weight:700;color:var(--c);flex-shrink:0}\n.fpcal .wb-ex small{color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:.72rem}\n.fpcal .wb-hol{display:block;color:var(--text2);font-weight:600;font-size:.84rem;padding:.38rem .2rem}\n.fpcal .wb-foot{margin-top:.6rem;padding-top:.55rem;border-top:1px dashed var(--border);font-size:.72rem;color:var(--text2);line-height:1.5}\n.fpcal .strip-vp{position:relative;overflow:hidden;touch-action:pan-y;margin:0 -2px;padding:0 2px}\n.fpcal .strip{display:grid;grid-template-columns:repeat(5,1fr);gap:5px;transition:transform .32s cubic-bezier(.22,.8,.26,1);will-change:transform}\n.fpcal .strip.entering{position:absolute;inset:0 2px}\n.fpcal .strip.leaving{pointer-events:none}\n@media (prefers-reduced-motion: reduce){.fpcal .strip{transition:none}}\n.fpcal .strip button.off{background:color-mix(in srgb,var(--surface) 55%,var(--bg))}\n.fpcal .strip button{display:flex;flex-direction:column;align-items:center;gap:3px;padding:.45rem 0 .4rem;border-radius:10px;border:1px solid transparent;background:var(--surface);min-width:0}\n.fpcal .strip .wd{font-size:.68rem;color:var(--text2)}\n.fpcal .strip .dn{font-size:1rem;font-weight:700;line-height:1.1}\n.fpcal .strip .lb{font-size:.6rem;font-weight:700;line-height:1;padding:2px 5px;border-radius:4px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.fpcal .strip .who{display:flex;gap:1px;height:16px;align-items:center}\n.fpcal .strip .who .av{width:16px;height:16px;font-size:.52rem;border:1.5px solid var(--c)}\n.fpcal .strip button.past{opacity:.55}\n.fpcal .strip button.past[aria-pressed=\"true\"]{opacity:.85}\n.fpcal .strip-vp.dragging .strip{transition:none}\n.fpcal .strip-vp{cursor:grab;user-select:none;-webkit-user-select:none}\n.fpcal .strip button[aria-pressed=\"true\"]{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 14%,var(--surface))}\n.fpcal .strip button.today .dn,.fpcal .strip button.today .wd{color:var(--accent2);font-weight:700}\n.fpcal .strip .wd.sat{color:var(--blue)}\n.fpcal .strip .wd.sun{color:var(--red)}\n.fpcal .strip .cnt{font-size:.62rem;color:var(--text2);height:.9rem}\n.fpcal .week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}\n.fpcal .col{background:var(--surface);border:1px solid var(--border);border-radius:12px;min-height:300px;display:flex;flex-direction:column;overflow:hidden;min-width:0}\n.fpcal .col.today{border-color:var(--accent)}\n.fpcal .col.wknd{background:color-mix(in srgb,var(--surface) 70%,var(--bg))}\n.fpcal .col.past{opacity:.6}\n.fpcal .col .ch{padding:.55rem .6rem .4rem;display:flex;align-items:baseline;gap:.4rem;border-bottom:1px solid var(--border);width:100%;text-align:left;min-width:0}\n.fpcal .col .ch:hover{background:var(--surface2)}\n.fpcal .col .ch .dn{font-size:1.15rem;font-weight:700;line-height:1}\n.fpcal .col.today .ch .dn{color:var(--accent2)}\n.fpcal .col .ch .wd{font-size:.75rem;color:var(--text2)}\n.fpcal .col .ch .hol{font-size:.72rem;color:var(--red);font-weight:600;margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.fpcal .col .tl{display:flex;align-items:center;gap:.35rem;padding:.4rem .5rem;font-size:.76rem;font-weight:700;border-bottom:1px solid var(--border);min-width:0;width:100%;text-align:left}\n.fpcal .col .tl i{width:8px;height:8px;border-radius:50%;background:currentColor;flex-shrink:0}\n.fpcal .col .tl span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.fpcal .col .tl em{font-style:normal;font-size:.6rem;color:var(--text2);font-weight:500;margin-left:auto;flex-shrink:0}\n.fpcal .col .exc{display:flex;flex-direction:column;gap:3px;padding:.35rem .5rem;border-bottom:1px solid var(--border);background:color-mix(in srgb,var(--surface2) 50%,transparent)}\n.fpcal .locrow{display:flex;align-items:center;gap:.35rem;font-size:.72rem;min-width:0;border-radius:6px;padding:1px 2px;width:100%;text-align:left}\n.fpcal .locrow:hover{background:var(--surface2)}\n.fpcal .locrow .av{width:18px;height:18px;font-size:.58rem}\n.fpcal .locrow .lb{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.fpcal .locrow .lb::before{content:\"\";display:inline-block;width:7px;height:7px;border-radius:50%;background:currentColor;margin-right:4px;vertical-align:1px}\n.fpcal .col .evs{padding:.45rem .5rem;display:flex;flex-direction:column;gap:4px;flex:1}\n.fpcal .col .add{color:var(--text2);font-size:.75rem;padding:.4rem .5rem;text-align:left;opacity:0;transition:opacity .15s}\n.fpcal .col:hover .add{opacity:1}\n.fpcal .ev{display:flex;gap:.45rem;align-items:flex-start;padding:.4rem .5rem;border-radius:8px;background:var(--surface2);border-left:3px solid var(--c,var(--accent));text-align:left;min-width:0;width:100%}\n.fpcal .ev .t{font-size:.72rem;color:var(--text2);white-space:nowrap;flex-shrink:0;padding-top:1px}\n.fpcal .ev .b{min-width:0;flex:1}\n.fpcal .ev .ti{font-size:.8rem;font-weight:600;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.fpcal .ev .su{font-size:.7rem;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:.3rem}\n.fpcal .ev .su .who{color:var(--text);font-weight:500}\n.fpcal .ev.allday{background:color-mix(in srgb,var(--c,var(--accent)) 16%,var(--surface2))}\n.fpcal .ev.done{opacity:.55}\n.fpcal .ev .tag{font-size:.62rem;font-weight:700;padding:0 .3rem;border-radius:4px;background:color-mix(in srgb,var(--c) 22%,transparent);color:var(--c);margin-right:.25rem;vertical-align:1px;white-space:nowrap}\n.fpcal .ev .pp{display:inline-flex;vertical-align:middle;flex-shrink:0}\n.fpcal .ev .pp .av{width:14px;height:14px;font-size:.5rem;margin-left:-4px;border:1.5px solid var(--surface2)}\n.fpcal .ev .pp .av:first-child{margin-left:0}\n.fpcal .daydetail .ev,.fpcal .agenda .ev{padding:.6rem .7rem}\n.fpcal .agenda.on{display:flex}\n.fpcal .daydetail .ev .ti,.fpcal .agenda .ev .ti{font-size:.9rem;white-space:normal}\n.fpcal .daydetail .ev .su,.fpcal .agenda .ev .su{font-size:.76rem;white-space:normal;flex-wrap:wrap}\n.fpcal .daydetail .ev .t,.fpcal .agenda .ev .t{font-size:.8rem;width:3.4rem}\n.fpcal .daydetail{display:flex;flex-direction:column;gap:.8rem}\n.fpcal .dd-head{display:flex;align-items:baseline;gap:.5rem;flex-wrap:wrap}\n.fpcal .dd-head .d{font-size:1.05rem;font-weight:700}\n.fpcal .dd-head .hol{color:var(--red);font-size:.82rem;font-weight:600}\n.fpcal .evlist{display:flex;flex-direction:column;gap:6px}\n.fpcal .empty{color:var(--text2);font-size:.82rem;padding:.6rem .2rem}\n.fpcal .agenda{display:none;flex-direction:column;gap:.5rem}\n.fpcal .agenda.on{display:flex}\n.fpcal .ag-day{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:.6rem .8rem;display:flex;flex-direction:column;gap:.4rem}\n.fpcal .ag-day.today{border-color:var(--accent)}\n.fpcal .ag-day.off{opacity:.7}\n.fpcal .ag-h{display:flex;align-items:center;gap:.5rem;min-width:0;flex-wrap:wrap}\n.fpcal .ag-h .d{font-weight:700;font-size:.95rem;cursor:pointer}\n.fpcal .ag-h .d.today{color:var(--accent2)}\n.fpcal .ag-h .hol{color:var(--red);font-size:.78rem;font-weight:600}\n.fpcal .ag-h .tl{display:inline-flex;align-items:center;gap:.3rem;font-size:.74rem;font-weight:700;padding:.1rem .5rem;border-radius:20px;border:1px solid}\n.fpcal .ag-h .tl i{width:7px;height:7px;border-radius:50%;background:currentColor}\n.fpcal .ag-h .ex{display:inline-flex;gap:.3rem;font-size:.72rem;color:var(--text2);flex-wrap:wrap}\n.fpcal .ag-h .ex b{font-weight:600}\n.fpcal .ag-h .add{margin-left:auto;color:var(--text2);font-size:.78rem}\n.fpcal .ag-more{text-align:center}\n.fpcal .month{display:none}\n.fpcal .month.on{display:block}\n.fpcal .mgrid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px}\n.fpcal .mgrid .wh{font-size:.72rem;color:var(--text2);text-align:center;padding:.2rem 0 .4rem}\n.fpcal .mgrid .wh.sat{color:var(--blue)}\n.fpcal .mgrid .wh.sun{color:var(--red)}\n.fpcal .mc{background:var(--surface);border:1px solid var(--border);border-radius:8px;min-height:58px;padding:.3rem .3rem;text-align:left;display:flex;flex-direction:column;gap:2px;min-width:0}\n@container app (min-width: 900px){.fpcal .mc{min-height:108px;padding:.35rem .4rem}}\n.fpcal .mc.out{opacity:.4}\n.fpcal .mc.past{opacity:.6}\n.fpcal .mc.sel{border-color:var(--accent);opacity:1}\n.fpcal .mc.today{background:color-mix(in srgb,var(--accent) 8%,var(--surface))}\n.fpcal .mc.today .n{color:var(--accent2)}\n.fpcal .mc .n{font-size:.8rem;font-weight:700;line-height:1.1;display:flex;justify-content:space-between;align-items:center;min-width:0}\n.fpcal .mc .n .h{font-size:.58rem;color:var(--red);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:3px}\n.fpcal .mc .n .ex{display:flex;gap:1px}\n.fpcal .mc .n .ex .av{width:13px;height:13px;font-size:.48rem;border:1px solid var(--c)}\n.fpcal .mc .tloc.dim{background:transparent;padding-left:1px;font-weight:600;opacity:.75}\n.fpcal .mc .tloc{font-size:.6rem;font-weight:700;line-height:1.2;padding:1px 4px;border-radius:4px;align-self:flex-start;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.fpcal .mc .li{font-size:.66rem;line-height:1.3;padding:0 .25rem;border-radius:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-left:2px solid var(--c);background:color-mix(in srgb,var(--c) 14%,transparent)}\n.fpcal .mc .li b{font-weight:600}\n.fpcal .mc .li .k{color:var(--c);font-weight:700;margin-right:2px}\n.fpcal .mc .more{font-size:.62rem;color:var(--text2)}\n.fpcal .mc .bars{display:none;flex-direction:column;gap:2px;margin-top:1px}\n.fpcal .mc .bars i{display:block;height:4px;border-radius:2px;background:var(--c);max-width:100%}\n@container app (max-width: 899px){.fpcal .mc .li,.fpcal .mc .more{display:none}\n.fpcal .mc .bars{display:flex}}\n.fpcal .chips{display:flex;flex-wrap:wrap;gap:.35rem}\n.fpcal .chip{display:inline-flex;align-items:center;gap:.35rem;padding:.3rem .6rem;border-radius:20px;border:1px solid var(--border);font-size:.78rem;font-weight:500;color:var(--text2);background:var(--surface2);white-space:nowrap}\n.fpcal .chip[aria-pressed=\"true\"]{color:var(--text);border-color:var(--c,var(--accent));background:color-mix(in srgb,var(--c,var(--accent)) 16%,var(--surface2))}\n.fpcal .chip .av{width:16px;height:16px;font-size:.55rem}\n.fpcal .chip i.sw{width:8px;height:8px;border-radius:2px;background:var(--c)}\n.fpcal .log{display:flex;flex-direction:column;gap:.45rem;font-size:.8rem}\n.fpcal .log .e{display:grid;grid-template-columns:auto 1fr;gap:.4rem;align-items:start;min-width:0}\n.fpcal .log .e .av{width:18px;height:18px;font-size:.55rem;margin-top:2px}\n.fpcal .log .e .m{min-width:0;line-height:1.35}\n.fpcal .log .e .m b{font-weight:600}\n.fpcal .log .e .m small{display:block;color:var(--text2);font-size:.68rem}\n.fpcal .fab{position:fixed;right:calc(16px + env(safe-area-inset-right,0px));bottom:calc(18px + env(safe-area-inset-bottom,0px));width:54px;height:54px;border-radius:50%;background:var(--accent);color:#fff;font-size:1.7rem;display:grid;place-items:center;box-shadow:0 6px 18px var(--shadow);z-index:25;line-height:1}\n@container app (min-width: 900px){.fpcal .fab{display:none}}\n.fpcal .ovl{position:fixed;inset:0;background:var(--overlay);z-index:40;display:flex;align-items:center;justify-content:center;padding:1rem}\n.fpcal .ovl[hidden]{display:none!important}\n.fpcal .sheet{background:var(--surface);border:1px solid var(--border);border-radius:16px;width:min(520px,100%);max-height:90%;overflow:auto;padding:1.1rem 1.1rem calc(1.1rem + env(safe-area-inset-bottom,0px));box-shadow:0 12px 40px var(--shadow)}\n@container app (max-width: 640px){.fpcal .ovl{align-items:flex-end;padding:0}\n.fpcal .sheet{width:100%;border-radius:16px 16px 0 0;max-height:94%;animation:fpcal-up .22s ease-out}\n.fpcal input,.fpcal select,.fpcal textarea{font-size:16px}}\n@keyframes fpcal-up{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}\n@media (prefers-reduced-motion: reduce){.fpcal .sheet{animation:none}}\n.fpcal .sheet h2{font-size:1.05rem;font-weight:700;margin-bottom:.8rem;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}\n.fpcal .sheet .x{margin-left:auto;width:30px;height:30px;border-radius:8px;display:grid;place-items:center;color:var(--text2)}\n.fpcal .types{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-bottom:.9rem}\n.fpcal .types button{padding:.5rem .2rem;border-radius:8px;border:1px solid var(--border);background:var(--surface2);font-size:.8rem;font-weight:600;color:var(--text2)}\n.fpcal .types button[aria-pressed=\"true\"]{border-color:var(--c);color:var(--c);background:color-mix(in srgb,var(--c) 14%,var(--surface2))}\n.fpcal .sub{display:inline-flex;gap:4px;margin-bottom:.8rem}\n.fpcal .sub button{padding:.35rem .7rem;border-radius:8px;border:1px solid var(--border);font-size:.8rem;font-weight:600;color:var(--text2);background:var(--surface2)}\n.fpcal .sub button[aria-pressed=\"true\"]{color:var(--text);border-color:var(--accent);background:color-mix(in srgb,var(--accent) 14%,var(--surface2))}\n.fpcal .fld{display:flex;flex-direction:column;gap:.25rem;margin-bottom:.7rem}\n.fpcal .fld label{font-size:.76rem;font-weight:600;color:var(--text2)}\n.fpcal .fld label.ck{display:flex;align-items:center;gap:.4rem;color:var(--text);font-weight:500}\n.fpcal .fld label.ck input{width:auto}\n.fpcal .row2{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}\n.fpcal .hint{font-size:.74rem;color:var(--text2);line-height:1.45}\n.fpcal .hint.warn{color:var(--yellow)}\n.fpcal .hint.warn::before{content:\"⚠ \"}\n.fpcal .kinds{display:grid;grid-template-columns:repeat(3,1fr);gap:4px}\n.fpcal .kinds button{padding:.4rem .3rem;border-radius:8px;border:1px solid var(--border);background:var(--surface2);font-size:.74rem;font-weight:600;color:var(--text2);text-align:left;line-height:1.25}\n.fpcal .kinds button small{display:block;font-weight:400;font-size:.62rem;opacity:.8}\n.fpcal .kinds button[aria-pressed=\"true\"]{border-color:var(--c);color:var(--c);background:color-mix(in srgb,var(--c) 14%,var(--surface2))}\n.fpcal .actions{display:flex;gap:.5rem;justify-content:flex-end;margin-top:.5rem;flex-wrap:wrap}\n.fpcal .actions .btn{padding:.55rem 1rem}\n.fpcal .kv{display:grid;grid-template-columns:5rem 1fr;gap:.35rem .6rem;font-size:.86rem;margin-bottom:.8rem}\n.fpcal .kv dt{color:var(--text2)}\n.fpcal .kv dd{min-width:0;word-break:break-word}\n.fpcal .meta{font-size:.72rem;color:var(--text2);margin-bottom:.6rem;padding-top:.5rem;border-top:1px dashed var(--border)}\n.fpcal .toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(84px + env(safe-area-inset-bottom,0px));background:var(--text);color:var(--bg);padding:.55rem .9rem;border-radius:10px;font-size:.84rem;font-weight:600;z-index:60;box-shadow:0 6px 18px var(--shadow);max-width:calc(100% - 32px);text-align:center}\n.fpcal .toast{display:flex;align-items:center;gap:.8rem;justify-content:center}\n.fpcal .toast button{color:inherit;font-weight:700;text-decoration:underline;font-size:.84rem;padding:.1rem .2rem}\n.fpcal .toast[hidden]{display:none!important}\n.fpcal .demo{font-size:.72rem;color:var(--text2);text-align:center;padding:1rem 0 0;line-height:1.5}\n.fpcal .demo button{color:var(--text2);text-decoration:underline;font-size:inherit}\n.fpcal .fab{z-index:900}\n.fpcal .ovl{z-index:1000}\n.fpcal .toast{z-index:1001}\n.fpcal.wide .fab{display:none}\n.fpcal.narrow .ovl{align-items:flex-end;padding:0}\n.fpcal.narrow .sheet{width:100%;border-radius:16px 16px 0 0;max-height:94%;animation:fpcal-up .22s ease-out}\n.fpcal.narrow .sheet input,.fpcal.narrow .sheet select,.fpcal.narrow .sheet textarea{font-size:16px}\n@media (prefers-reduced-motion: reduce){ .fpcal.narrow .sheet{animation:none} }\n.fpcal .top .back{padding:.35rem .55rem;font-size:.84rem;color:var(--text2);border:1px solid var(--border);border-radius:8px}\n.fpcal .ro{margin:.2rem 0 .8rem;padding:.6rem .8rem;border-radius:10px;border:1px solid color-mix(in srgb,var(--yellow) 45%,transparent);background:color-mix(in srgb,var(--yellow) 10%,transparent);font-size:.82rem;line-height:1.5}\n.fpcal .steps{display:flex;flex-direction:column;gap:.5rem;margin:.2rem 0 .9rem;padding-left:1.2rem;font-size:.88rem;line-height:1.5}\n.fpcal .steps b{font-weight:700}\n.fpcal .pstat{display:flex;align-items:center;gap:.5rem;padding:.6rem .75rem;border-radius:10px;margin-bottom:.9rem;font-size:.86rem;font-weight:600;border:1px solid color-mix(in srgb,var(--c) 45%,transparent);background:color-mix(in srgb,var(--c) 10%,transparent);color:var(--text)}\n.fpcal .pstat i{width:8px;height:8px;border-radius:50%;background:var(--c);flex-shrink:0}\n.fpcal .ovl:not([hidden]) ~ .toast{top:calc(16px + env(safe-area-inset-top,0px));bottom:auto}\n.fpcal .loading{padding:3rem 0;text-align:center;color:var(--text2)}";

export function CalendarPage(props) {
  const ref = useRefCal(null);
  const ctl = useRefCal(null);
  useEffectCal(() => {
    ctl.current = mountCalendar(ref.current, props);
    return () => ctl.current?.destroy();
  }, []);
  useEffectCal(() => { ctl.current?.setContext(props); }, [props.teamMembers, props.projects, props.currentMember]);
  return (
    <>
      <style>{CAL_CSS}</style>
      <div ref={ref} className="fpcal" />
    </>
  );
}

function mountCalendar(root, ctx) {
  root.innerHTML = "<div class=\"shell\" id=\"shell\"><div class=\"app\">\n  <header class=\"top\">\n    <button class=\"back\" id=\"btn-back\" aria-label=\"워크룸으로 돌아가기\">← 워크룸</button>\n    <h1>사내 캘린더</h1>\n    <div class=\"seg\" role=\"group\" aria-label=\"보기\">\n      <button id=\"v-month\" aria-pressed=\"true\">월</button>\n      <button id=\"v-week\" aria-pressed=\"false\">주</button>\n      <button id=\"v-list\" aria-pressed=\"false\">목록</button>\n    </div>\n    <button class=\"btn\" id=\"btn-push\" aria-label=\"알림 설정\" title=\"알림 설정\">🔔</button>\n    <button class=\"btn\" id=\"btn-today\">오늘</button>\n    <button class=\"btn primary\" id=\"btn-add-top\">＋ 추가</button>\n  </header>\n  <div class=\"ro\" id=\"ro-banner\" hidden></div>\n  <div class=\"loading\" id=\"cal-loading\">불러오는 중…</div>\n  <div id=\"cal-body\" hidden>\n  <div class=\"nav\">\n    <button class=\"arrow\" id=\"prev\" aria-label=\"이전\">‹</button>\n    <div class=\"range tnum\" id=\"range\"></div>\n    <button class=\"arrow\" id=\"next\" aria-label=\"다음\">›</button>\n  </div>\n  <section class=\"mobile\" id=\"mobile\">\n    <div class=\"wnav\"><button class=\"arrow\" id=\"m-prev\" aria-label=\"5일 전\">‹</button><span class=\"range tnum\" id=\"m-range\"></span><button class=\"arrow\" id=\"m-next\" aria-label=\"5일 후\">›</button></div>\n    <div class=\"strip-vp\" id=\"m-strip\"></div>\n    <section class=\"card mday\" id=\"m-day\"></section>\n    <div class=\"wnav\" style=\"margin-top:.25rem\">\n      <div class=\"seg\" role=\"group\" aria-label=\"달력 보기\"><button id=\"m-vmonth\" aria-pressed=\"true\">월</button><button id=\"m-vweek\" aria-pressed=\"false\">주</button></div>\n      <span class=\"range tnum\" id=\"m-crange\" style=\"text-align:right\"></span>\n      <button class=\"arrow\" id=\"m-cprev\" aria-label=\"이전 달\">‹</button><button class=\"arrow\" id=\"m-cnext\" aria-label=\"다음 달\">›</button>\n    </div>\n    <div class=\"mgrid\" id=\"m-mgrid\"></div>\n    <div class=\"agenda\" id=\"m-week\"></div>\n  </section>\n  <div class=\"layout\">\n    <aside class=\"side\">\n      <section class=\"card mday\" id=\"todaycard\"></section>\n      <section class=\"card\" id=\"weekboard\"></section>\n      <section class=\"card\" id=\"upcard\"></section>\n    </aside>\n    <main style=\"min-width:0\">\n      <div class=\"month on\" id=\"monthview\"><div class=\"mgrid\" id=\"mgrid\"></div></div>\n      <div id=\"weekview\" style=\"display:none\"><div class=\"week\" id=\"week\"></div></div>\n      <div class=\"agenda\" id=\"listview\"></div>\n    </main>\n  </div>\n  <p class=\"demo\"><button type=\"button\" id=\"log-open\">변경 기록 보기</button></p>\n  </div>\n</div></div>\n<button class=\"fab\" id=\"fab\" aria-label=\"일정 추가\">＋</button>\n<div class=\"ovl\" id=\"ovl\" hidden><div class=\"sheet\" id=\"sheet\" role=\"dialog\" aria-modal=\"true\" tabindex=\"-1\"></div></div>\n<div class=\"toast\" id=\"toast\" hidden></div>";
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
  const LOADERS = {
    [T.routines]: async () => { const { data, error } = await sb.from(T.routines).select('*').order('valid_from'); if (error) throw error; ROUTINES = data.map(MAP.routine); },
    [T.team]:     async () => { const { data, error } = await sb.from(T.team).select('*'); if (error) throw error; teamOverrides = data.map(MAP.team); },
    [T.member]:   async () => { const { data, error } = await sb.from(T.member).select('*'); if (error) throw error; personOverrides = data.map(MAP.member); },
    [T.leaves]:   async () => { const { data, error } = await sb.from(T.leaves).select('*').is('deleted_at', null); if (error) throw error; leaves = data.map(MAP.leave); },
    [T.events]:   async () => { const { data, error } = await sb.from(T.events).select('*').is('deleted_at', null); if (error) throw error; manual = data.map(MAP.event); },
    [T.holidays]: async () => { const { data, error } = await sb.from(T.holidays).select('holiday_date,name'); if (error) throw error; HOLIDAYS = Object.fromEntries(data.map(h => [h.holiday_date, h.name])); },
  };
  async function reload(...tables){ await Promise.all(tables.map(t => LOADERS[t]())); render(); }
  async function loadAll(){
    try { await Promise.all(Object.values(LOADERS).map(f => f())); setupNeeded = false; }
    catch (e) { if (missing(e)) setupNeeded = true; else { console.warn('캘린더 로드 실패:', e); toast(friendly(e)); } }
    loaded = true; $('cal-loading').hidden = true; $('cal-body').hidden = setupNeeded; render();
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
    $('btn-add-top').hidden = !ME || setupNeeded; $('fab').hidden = !ME || setupNeeded;
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
    other:   { label:'기타지점', full:'패스트파이브 기타 지점',   color:'var(--teal)',    kind:'office', ic:'📍' },
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
  let ROUTINES = [], HOLIDAYS = {}, manual = [], leaves = [], teamOverrides = [], personOverrides = [];
  // 패턴이 하나도 없을 때(마이그레이션 직후 등) 쓰는 기본값: 월~금 시청역
  const DEFAULT_ROUTINE = { from:'1970-01-01', days:{ 1:'cityhall', 2:'cityhall', 3:'cityhall', 4:'cityhall', 5:'cityhall' } };

  // ───────── 유틸 ─────────
  const pad = n => String(n).padStart(2,'0');
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
  // 반복 일정이 k 날짜에 열리는지 (건너뛴 회차·종료일·공휴일 건너뜀 반영)
  function occursOn(m, k){
    if ((m.exdates||[]).includes(k)) return false;
    if (m.date===k) return true;
    return m.repeat==='weekly' && m.date<k && (!m.until || k<=m.until) && parse(m.date).getDay()===parse(k).getDay() && !(m.skipHoliday && HOLIDAYS[k]);
  }
  // 대면 미팅 장소가 우리 사무실이면 외근이 아님
  const atOffice = place => !!place && ['패스트파이브','시청역','서울숲','사무실'].some(w => place.includes(w));
  // pid 가 k 날 사무실 밖 대면 미팅에 가는지. 수동 미팅은 '외근 표시' 체크한 것, 위시켓은 대면이면서 장소가 사무실이 아닌 것.
  function outMeetingOf(pid, k){
    const w = WORKROOM.find(w => w.meeting_type==='inperson' && w.meeting_at.slice(0,10)===k && [w.main,w.sub].includes(pid) && !atOffice(w.place));
    if (w) return { title:w.title };
    const m = manual.find(m => m.type==='meeting' && m.mt==='inperson' && m.autoOut && m.people.includes(pid) && occursOn(m,k));
    return m ? { title:m.title } : null;
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
    else { const om = outMeetingOf(pid, k); r = om ? { code:'out', src:'meeting', auto:true, note:om.title } : { code:t.code, src:'team', same:true }; }
    if (lv) r = { ...r, same:false, half:lv.kind, leaveRef:lv, note:[lv.note, r.note].filter(Boolean).join(' · ') };
    return r;
  }
  // 표시용 장소명과 색. 반차면 "오후반차 · 시청역"
  function placeName(l, k){ return l.src==='team' ? teamLocName(teamLoc(k)) : (l.code==='other' && l.branch) ? l.branch.replace('패스트파이브 ','') : LOC[l.code].label; }
  const locText = (l, k) => l.half ? `${LOC[l.half].label} · ${placeName(l,k)}` : placeName(l,k);
  const locColor = l => l.half ? 'var(--red)' : LOC[l.code].color;
  const leaveDays = (from, to, kind) => { let n = 0; for (let d=parse(from); key(d)<=to; d=addDays(d,1)) if (!isOffDay(key(d))) n++; return HALF[kind] ? n/2 : n; };
  function rawEventsOf(k){
    const out = [];
    if (HOLIDAYS[k]) out.push({ id:'h'+k, type:'holiday', title:HOLIDAYS[k], allday:true, people:[] });
    // 휴가는 근무일에만 표시 (주말·공휴일 칸에는 안 뜸)
    if (!isOffDay(k)) leaves.forEach(l => { if (l.from<=k && l.to>=k) out.push({ id:l.id, type:'leave', title:`${P(l.person).name} ${LOC[l.kind].label}`, allday:true, people:[l.person], note:l.note, ref:l, kind:l.kind, by:l.by, at:l.at, editedBy:l.editedBy, editedAt:l.editedAt }); });
    WORKROOM.forEach(w => { if (w.meeting_at.slice(0,10)===k) out.push({ id:'w'+w.slug, type:'wishket', title:w.title, start:w.meeting_at.slice(11,16), mt:w.meeting_type, people:[w.main, w.sub].filter(Boolean), place:w.place, done:w.status==='meeting_done', ref:w }); });
    const nowMin = new Date().getHours()*60 + new Date().getMinutes();
    manual.forEach(m => { if (occursOn(m,k)) out.push({ ...m, ref:m, done: m.type==='meeting' && (k<TK || (k===TK && m.end && toMin(m.end) < nowMin)) }); });
    return out.sort((a,b) => (a.allday?0:1)-(b.allday?0:1) || (a.start||'').localeCompare(b.start||''));
  }
  const eventsOf = rawEventsOf; // 보기 필터 제거: 항상 전원·전체 일정

  // ───────── 상태 ─────────
  const defaultBweek = () => key(addDays(monday(TODAY), [0,6].includes(TODAY.getDay()) ? 7 : 0));
  // view: 데스크톱(월/주/목록), mview: 폰 하단 달력(월/주)
  // slide: 폰 5일 카드가 이번 렌더에서 밀려날 일수(+면 왼쪽으로), bweek: 데스크톱 주간 근무 보드의 월요일, dayModal/ret: 날짜 모달과 되돌아갈 날짜
  const state = { view:'month', mview:'month', anchor:new Date(TODAY), sel:TK, slide:0, bweek:defaultBweek(), dayModal:null, ret:null, listDays:14 };
  const $ = id => root.querySelector('#'+id);

  // ───────── 렌더 ─────────
  function render(){
    if (!loaded) return;
    renderBanner(); renderHeader(); renderMobile();
    // 데스크톱: 사이드바(오늘 · 주간 근무 · 다가오는 미팅) + 월/주/목록
    renderDayInto($('todaycard'), TK); renderWeekBoard(); renderUpcoming();
    $('weekview').style.display = state.view==='week' ? '' : 'none';
    $('monthview').classList.toggle('on', state.view==='month');
    $('listview').classList.toggle('on', state.view==='list');
    if (state.view==='week') renderWeek();
    else if (state.view==='month') monthGrid($('mgrid'));
    else renderList();
    // 날짜 모달이 열려 있으면 내용 갱신(스크롤 유지)
    if (state.dayModal && !$('ovl').hidden) { const sh = $('sheet'), sc = sh.scrollTop, inSheet = sh.contains(document.activeElement) || document.activeElement===sh;
      sh.innerHTML = `<div class="mday">${dayHtml(state.dayModal, true)}</div>`; bindDay(sh, state.dayModal); const x = sh.querySelector('.x'); x.onclick = closeSheet; sh.scrollTop = sc;
      if (inSheet) x.focus({ preventScroll:true }); }
  }
  // ───────── 폰: 5일 카드(선택일 -1 ~ +3일) → 선택일 카드 → 월/주 달력 ─────────
  // 선택일은 항상 두 번째 카드. 어디서 고르든(카드·달력·오늘·‹ ›) 이 규칙 하나로 창이 정해집니다.
  const stripStart = () => addDays(parse(state.sel), -1);
  const dayDiff = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
  function selectDay(k){
    state.slide = dayDiff(state.sel, k);
    state.sel = k; state.anchor = parse(k); render();
  }
  // ‹ › : 5일씩 이동
  const stepStrip = dir => selectDay(key(addDays(parse(state.sel), 5*dir)));
  function renderMobile(){
    const s = stripStart(), e = addDays(s,4);
    $('m-range').textContent = s.getMonth()===e.getMonth() ? `${s.getMonth()+1}월 ${s.getDate()}–${e.getDate()}일` : `${s.getMonth()+1}월 ${s.getDate()}일 – ${e.getMonth()+1}월 ${e.getDate()}일`;
    renderStrip($('m-strip'), s, state.slide); state.slide = 0;
    renderDayInto($('m-day'), state.sel);
    ['month','week'].forEach(v => $('m-v'+v).setAttribute('aria-pressed', state.mview===v));
    const isM = state.mview==='month';
    $('m-mgrid').style.display = isM ? '' : 'none'; $('m-week').classList.toggle('on', !isM);
    $('m-cprev').setAttribute('aria-label', isM?'이전 달':'지난주'); $('m-cnext').setAttribute('aria-label', isM?'다음 달':'다음주');
    if (isM) { $('m-crange').textContent = `${state.anchor.getFullYear()}년 ${state.anchor.getMonth()+1}월`; monthGrid($('m-mgrid'), true); }
    else { const ws = monday(state.anchor), we = addDays(ws,6); $('m-crange').textContent = `${ws.getMonth()+1}/${ws.getDate()} – ${we.getMonth()+1}/${we.getDate()}`;
      $('m-week').innerHTML = agendaDays(ws, 7); bindAgenda($('m-week'));
      $('m-week').querySelectorAll('.ag-h .d').forEach(el => el.onclick = () => { selectDay(el.closest('[data-k]').dataset.k); scrollToTop(); }); }
  }
  function renderHeader(){
    ['month','week','list'].forEach(v => $('v-'+v).setAttribute('aria-pressed', state.view===v));
    if (state.view==='week') { const s = monday(state.anchor), e = addDays(s,6);
      $('range').textContent = s.getMonth()===e.getMonth() ? `${s.getFullYear()}년 ${s.getMonth()+1}월 ${s.getDate()}–${e.getDate()}일` : `${s.getMonth()+1}월 ${s.getDate()}일 – ${e.getMonth()+1}월 ${e.getDate()}일`; }
    else if (state.view==='month') $('range').textContent = `${state.anchor.getFullYear()}년 ${state.anchor.getMonth()+1}월`;
    else { const s = parse(state.sel), e = addDays(s, state.listDays-1); $('range').textContent = `${s.getMonth()+1}월 ${s.getDate()}일 – ${e.getMonth()+1}월 ${e.getDate()}일`; }
  }
  function teamBanner(k){
    const t = teamLoc(k);
    if (!t) return `<div class="teamloc" style="color:var(--text2);border-color:var(--border)"><span class="ic">－</span><span class="tx"><span class="l1">팀 근무지</span><span class="l2">휴무</span></span></div>`;
    const L = LOC[t.code];
    const l3 = t.note ? esc(t.note) : t.src==='override' ? `${esc(P(t.ref.by).name)} 변경 · ${fmtAt(t.ref.at)}` : `주간 패턴 (${fmtD(t.ref.from).slice(0,-4)}부터)`;
    return `<div class="teamloc" style="color:${L.color};border-color:color-mix(in srgb,${L.color} 45%,transparent);background:color-mix(in srgb,${L.color} 9%,transparent)">
      <span class="ic">${L.ic}</span><span class="tx"><span class="l1">${t.src==='override'?'팀 근무지 · 이날만':'팀 근무지'}</span><span class="l2">${esc(teamLocFull(t))}</span><span class="l3">${l3}</span></span>
      <button class="edit" data-tl="${k}">변경</button></div>`;
  }
  // 사람별 위치 칩: 팀과 같으면 실제 장소명을 흐린 칩으로, 다르면(반차 포함) 색 칩으로
  function locChip(l, k){ if (!l) return `<span class="loc same"><i></i>휴무</span>`;
    if (l.same) { const t = teamLoc(k); return `<span class="loc same editable" title="팀 근무지와 같음 · 눌러서 이 사람만 바꾸기"><i style="background:${LOC[t.code].color}"></i>${esc(teamLocName(t))}</span>`; }
    const c = locColor(l); return `<span class="loc editable" style="color:${c};border-color:color-mix(in srgb,${c} 45%,transparent);background:color-mix(in srgb,${c} 12%,transparent)"><i></i>${esc(locText(l,k))}${l.auto?' · 미팅':''}</span>`; }
  function peopleRows(k){
    return PEOPLE.map(p => { const l = locOf(p.id,k);
      return `<div class="prow">${av(p)}<span class="nm">${esc(p.name)}${p.role?`<small>${esc(p.role)}</small>`:''}</span>${locChip(l,k)}<span class="note">${esc(l?.note||'')}</span></div>`; }).join('');
  }
  function bindPeopleRows(root, k){ root.querySelectorAll('.loc.editable').forEach((el,i) => el.onclick = () => openAdd('loc', { person:PEOPLE[i].id, date:k, scope:'person' })); root.querySelectorAll('[data-tl]').forEach(b => b.onclick = () => openAdd('loc', { date:b.dataset.tl, scope:'team' })); }
  // 다가오는 미팅: 오늘부터 60일 안의 회차를 실제로 펼쳐서(반복 미팅 포함) 앞에서 n개
  function upcomingMeetings(n=4){
    const out = [];
    for (let i=0; i<60 && out.length<n; i++){ const k = key(addDays(TODAY,i));
      rawEventsOf(k).filter(e => (e.type==='wishket' || e.type==='meeting') && !e.done).forEach(e => out.push({ k, t:e.start||'종일', title:e.title, people:e.people,
        tag: e.type==='wishket' ? '수주' : (KIND[e.kind]?.label||'미팅'), place: e.type==='wishket' ? (e.place||MT[e.mt]) : [e.mt?MT[e.mt]:'', e.place].filter(Boolean).join(' · ') })); }
    return out.slice(0,n);
  }
  // 내 근무 선택: [팀 근무지 출근 | 외근 | 재택 | 다른 곳…]. 오늘 이후 평일에만. 팀 근무지는 그대로 두고 내 근무지만 바꿉니다.
  // 반차인 날은 나머지 반나절 근무지를, 대면 미팅이 있는 날은 자동 외근을 보여 줍니다.
  function myStatus(k){
    if (isOffDay(k) || k<TK) return '';
    const l = locOf(ME,k), t = teamLoc(k), when = k===TK ? '오늘' : fmtD(k);
    if (l.src==='leave') return `<div class="mystat"><span class="h">${when} 내 근무</span><div class="leave">${LOC[l.code].label}${l.note?' · '+esc(l.note):''}</div></div>`;
    const head = l.half ? `${when} ${l.half==='pm'?'오전':'오후'} 근무지` : `${when} 내 근무`;
    const sub = l.half ? `${LOC[l.half].label}라 나머지 반나절만 정합니다` : l.auto ? `대면 미팅(${esc(l.note)})이 있어 자동으로 외근입니다` : '팀 근무지는 그대로, 나만 바뀝니다';
    const cur = l.src==='team' ? 'team' : l.code;
    const opts = [['team', t.code==='home' ? '재택' : `${teamLocName(t)} 출근`, LOC[t.code].color]];
    if (t.code!=='out') opts.push(['out','외근','var(--yellow)']);
    if (t.code!=='home') opts.push(['home','재택','var(--green)']);
    if (!opts.some(o=>o[0]===cur)) opts.push([cur, `${placeName(l,k)} 출근`, LOC[cur].color]);
    opts.push(['more','다른 곳…','var(--text)']);
    return `<div class="mystat"><span class="h">${head} <small>· ${sub}</small></span><div class="opts" role="group" aria-label="${head}">${opts.map(([c,lb,col])=>`<button data-q="${c}" style="--c:${col}" aria-pressed="${c===cur}">${esc(lb)}</button>`).join('')}</div></div>`;
  }
  function bindQuick(root,k){ root.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { const c=b.dataset.q, t=teamLoc(k), when = k===TK?'오늘':fmtD(k);
    if (c==='more') return openAdd('loc', { person:ME, date:k, scope:'person' });
    if (b.getAttribute('aria-pressed')==='true' || !ME) return;
    const auto = outMeetingOf(ME,k);
    const lb = c==='team' ? (t.code==='home' ? '재택' : `${teamLocName(t)} 출근`) : LOC[c].label;
    // 팀 근무지로 돌아갈 때 대면 미팅 자동 외근이 있으면 '사무실에 있음'을 직접 기록해 둡니다.
    const keep = c==='team' ? !!auto : !(c==='out' && auto);
    const note = `${fmtD(k)} ${P(ME).name} → ${lb}`;
    run(async () => {
      if (keep) await db(() => sb.from(T.member).upsert({ member_id:ME, work_date:k, loc: c==='team' ? t.code : c, branch: c==='team' ? (t.branch||null) : null, note:null, change_note:note }, { onConflict:'member_id,work_date' }));
      else await db(() => sb.from(T.member).delete().eq('member_id', ME).eq('work_date', k));
      await reload(T.member); toast(`${when} ${lb}으로 바꿨어요`);
    }); }); }
  // 하루 카드: 폰 선택일 카드 · 데스크톱 오늘 카드 · 데스크톱 날짜 모달이 같은 내용을 씁니다.
  function dayHtml(k, modal=false){
    const d=parse(k), hol=HOLIDAYS[k], off=isOffDay(k), evs=eventsOf(k).filter(e=>e.type!=='holiday'), n=evs.length;
    return `<div class="today-head"><span class="d tnum">${d.getMonth()+1}월 ${d.getDate()}일 (${WD[d.getDay()]})</span>${k===TK?'<span class="now">오늘</span>':''}${hol?`<span class="hol">${esc(hol)}</span>`:''}<span class="cnt">일정 ${n}건</span>${modal?'<button class="x" aria-label="닫기">✕</button>':''}</div>
      ${off ? `<div class="offday">${hol ? esc(hol)+' · 휴무' : '주말 · 휴무'}</div>` : teamBanner(k) + `<div class="people">${peopleRows(k)}</div>` + myStatus(k)}
      <div class="evlist">${evs.length ? evs.map(e=>evCard(e)).join('') : '<div class="empty">등록된 일정이 없습니다.</div>'}<button class="btn ghost addday" data-add="${k}">＋ 이 날에 일정 추가</button></div>`;
  }
  function bindDay(root, k){
    root.dataset.k = k;
    bindEv(root); bindPeopleRows(root, k); bindQuick(root, k);
    root.querySelector('[data-add]').onclick = () => openAdd('meeting', { date:k });
  }
  function renderDayInto(root, k){ root.innerHTML = dayHtml(k); bindDay(root, k); }
  // 데스크톱: 날짜 모달. 모달 안에서 추가·수정 시트를 열었다 닫으면 같은 날짜 모달로 돌아옵니다.
  function openDay(k){ state.sel = k; openSheet('', k); render(); }
  function renderUpcoming(){
    const up = upcomingMeetings(4);
    $('upcard').innerHTML = `<h3>다가오는 미팅</h3><div class="evlist">${up.length?up.map(u=>`<button class="ev" style="--c:${u.tag==='수주'?'var(--yellow)':'var(--blue)'}" data-day="${u.k}"><span class="t tnum">${fmtD(u.k).slice(0,-4)}<br>${u.t}</span><span class="b"><span class="ti"><span class="tag">${u.tag}</span>${esc(u.title)}</span><span class="su"><span class="who">${names(u.people)}</span>${u.place?'· '+esc(u.place):''}</span></span></button>`).join(''):'<div class="empty">예정된 미팅이 없습니다.</div>'}</div>`;
    $('upcard').querySelectorAll('[data-day]').forEach(b => b.onclick = () => openDay(b.dataset.day));
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
      const L = LOC[t.code], ex = PEOPLE.map(p=>({p,l:locOf(p.id,k)})).filter(x=>x.l && !x.l.same);
      const pill = `<button class="wb-team" data-tl="${k}" style="--c:${L.color}" title="${esc(teamLocFull(t))}${t.note?' · '+esc(t.note):''} · 눌러서 이날 팀 근무지 변경"><span class="ic">${L.ic}</span><span class="nm">${esc(teamLocFull(t).replace('패스트파이브 ',''))}</span><em>${t.src==='override'?'이날만 · ':''}${ex.length?`${PEOPLE.length-ex.length}명`:'전원'}</em></button>`;
      const exH = ex.map(({p,l}) => `<button class="wb-ex" data-p="${p.id}" data-k="${k}" style="--c:${locColor(l)}">${av(p)}<span>${esc(p.name)}</span><b>${esc(locText(l,k))}</b>${l.note?`<small>${esc(l.note)}</small>`:''}</button>`).join('');
      h += `<div class="wb-row ${k===TK?'today':''} ${k<TK?'past':''}">${dcol}<div class="wb-main">${pill}${exH}</div></div>`; }
    h += `</div><div class="wb-foot">기본 ${esc(routineSummary(routineAt(state.bweek)))}<br>근무지를 누르면 그날만 바꿉니다.</div>`;
    const root = $('weekboard'); root.innerHTML = h;
    root.querySelectorAll('[data-wb]').forEach(b => b.onclick = () => { state.bweek = key(addDays(parse(state.bweek), 7*Number(b.dataset.wb))); render(); });
    root.querySelectorAll('[data-tl]').forEach(b => b.onclick = () => openAdd('loc', { date:b.dataset.tl, scope:'team' }));
    root.querySelectorAll('.wb-ex').forEach(b => b.onclick = () => openAdd('loc', { person:b.dataset.p, date:b.dataset.k, scope:'person' }));
    root.querySelectorAll('[data-day]').forEach(b => b.onclick = () => openDay(b.dataset.day));
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
    else if (e.type==='meeting') { tag = `<span class="tag">${KIND[e.kind]?.label||'미팅'}${e.mt?' · '+MT[e.mt]:''}</span>`; sub = `<span class="who">${names(e.people)}</span>${e.place?'· '+esc(e.place):''}${e.end?' · ~'+e.end:''}`; }
    else if (e.type==='leave') { sub = esc(e.note||LOC[e.kind].full); }
    else { sub = [e.people.length&&e.people.length<PEOPLE.length?`<span class="who">${names(e.people)}</span>`:'', e.place?esc(e.place):'', e.end?`~${e.end}`:''].filter(Boolean).join(' · '); }
    return `<button class="ev ${e.allday?'allday':''} ${e.done?'done':''}" style="--c:${c}" data-ev="${e.id}">
      <span class="t tnum">${e.allday?'종일':e.start}</span>
      <span class="b"><span class="ti">${tag}${esc(e.title)}</span>${sub?`<span class="su">${sub}${e.people.length&&e.type!=='leave'?avs(e.people):''}</span>`:''}</span></button>`;
  }
  function bindEv(root){ root.querySelectorAll('[data-ev]').forEach(b => b.onclick = ev => { ev.stopPropagation(); openDetail(b.dataset.ev, b.closest('[data-k]')?.dataset.k || state.sel); }); }
  function renderStrip(vp, s, dir){
    // 5일 카드: 선택일 -1 ~ +3일(주말·공휴일 포함). dir(이동 일수)이 있으면 그만큼 칸 단위로 슬라이드.
    const html = [0,1,2,3,4].map(i => { const d=addDays(s,i), k=key(d), dw=d.getDay(), hol=HOLIDAYS[k], t=teamLoc(k);
      const n = eventsOf(k).filter(e=>e.type!=='holiday').length;
      const lb = t ? `<span class="lb" style="background:color-mix(in srgb,${LOC[t.code].color} 22%,transparent);color:${LOC[t.code].color}">${esc(teamLocName(t))}</span>`
        : `<span class="lb" style="color:${hol?'var(--red)':'var(--text2)'}">${esc(hol||'휴무')}</span>`;
      // 팀과 다른 곳에 있는 사람: 이니셜 + 장소색 테두리
      const who = PEOPLE.map(p => { const l=locOf(p.id,k); return (l && !l.same) ? `<span class="av" style="--c:${locColor(l)}" title="${esc(p.name)} ${esc(locText(l,k))}">${esc(p.name.slice(1,2))}</span>` : ''; }).join('');
      return `<button data-k="${k}" aria-pressed="${k===state.sel}" class="${k===TK?'today':''} ${t?'':'off'} ${k<TK?'past':''}" aria-label="${d.getMonth()+1}월 ${d.getDate()}일 ${WD[dw]}요일${hol?' '+hol:''}"><span class="wd ${dw===6?'sat':(dw===0||hol)?'sun':''}">${k===TK?'오늘':WD[dw]}</span><span class="dn tnum">${d.getDate()===1?(d.getMonth()+1)+'/':''}${d.getDate()}</span>${lb}<span class="who">${who}</span><span class="cnt">${n?n+'건':''}</span></button>`; }).join('');
    vp.querySelectorAll('.strip.leaving').forEach(x => x.remove());
    const cur = vp.querySelector('.strip');
    const nu = document.createElement('div'); nu.className = 'strip'; nu.innerHTML = html;
    nu.querySelectorAll('button').forEach(b => b.onclick = () => selectDay(b.dataset.k));
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!dir || !cur || reduce) { vp.replaceChildren(nu); return; }
    cur.classList.add('leaving'); cur.classList.remove('entering');
    // 카드 한 칸 = (폭 + 간격 5px) / 5. 이동한 일수만큼 칸 단위로 밀고, 5일 넘게 건너뛰면 한 화면만큼만 밉니다.
    // 손가락으로 끌다 놓은 경우 그 위치(px)에서 이어서 움직입니다.
    const px = state.dragPx || 0; state.dragPx = 0;
    const n = Math.max(-5, Math.min(5, dir)), shift = (m, add=0) => `translateX(calc(${m} * (100% + 5px) / 5 + ${add}px))`;
    nu.classList.add('entering'); nu.style.transform = shift(n, px);
    vp.appendChild(nu); void nu.offsetWidth;
    cur.style.transform = shift(-n); nu.style.transform = 'translateX(0)';
    setTimeout(() => { cur.remove(); if (nu.isConnected && !nu.classList.contains('leaving')) { nu.classList.remove('entering'); nu.style.transform = ''; } }, 320);
  }
  function renderWeek(){
    const s = monday(parse(state.sel));
    $('week').innerHTML = [0,1,2,3,4,5,6].map(i => { const d=addDays(s,i), k=key(d), hol=HOLIDAYS[k], off=isOffDay(k), t=teamLoc(k);
      const tl = off ? '' : `<button class="tl" data-tl="${k}" style="color:${LOC[t.code].color}" title="${esc(teamLocFull(t))}${t.note?' · '+esc(t.note):''} · 눌러서 변경"><i></i><span>${LOC[t.code].ic} ${esc(teamLocName(t))}</span>${t.src==='override'?'<em>이날만</em>':''}</button>`;
      const exc = PEOPLE.map(p=>({p,l:locOf(p.id,k)})).filter(x=>x.l && !x.l.same);
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
    for (let i=0;i<42;i++){ const d=addDays(start,i), k=key(d); if (i>=35 && d.getMonth()!==a.getMonth()) break;
      const hol=HOLIDAYS[k], off=isOffDay(k), evs=eventsOf(k).filter(e=>e.type!=='holiday'), t=teamLoc(k);
      const tloc = off ? '' : t.src==='override'
        ? `<span class="tloc" style="background:color-mix(in srgb,${LOC[t.code].color} 24%,transparent);color:${LOC[t.code].color}" title="이날만 바뀐 팀 근무지">${esc(teamLocName(t))}</span>`
        : `<span class="tloc dim" style="color:${LOC[t.code].color}" title="주간 패턴">${esc(teamLocName(t))}</span>`;
      const ex = off ? '' : PEOPLE.map(p=>{ const l=locOf(p.id,k); return (l&&!l.same)?`<span class="av" style="--c:${locColor(l)}" title="${esc(p.name)} ${esc(locText(l,k))}">${esc(p.name.slice(1,2))}</span>`:''; }).join('');
      const colorOf = e => e.type==='leave'?EVTYPE.leave.color:EVTYPE[e.type].color;
      const items = evs.slice(0,3).map(e=>`<span class="li" style="--c:${colorOf(e)}">${e.allday?'':`<b>${e.start}</b> `}${e.type==='wishket'?'<span class="k">수주</span>':e.type==='meeting'?`<span class="k">${KIND[e.kind]?.label||'미팅'}</span>`:''}${esc(e.title)}${(e.type==='wishket'||e.type==='meeting')?` <span style="opacity:.75">· ${names(e.people)}</span>`:''}</span>`).join('') + (evs.length>3?`<span class="more">+${evs.length-3}</span>`:'');
      const bars = `<span class="bars">${evs.slice(0,3).map(e=>`<i style="--c:${colorOf(e)}"></i>`).join('')}</span>`;
      h += `<button class="mc tnum ${d.getMonth()!==a.getMonth()?'out':''} ${k===state.sel?'sel':''} ${k===TK?'today':''} ${k<TK?'past':''}" data-k="${k}"><span class="n"><span>${d.getDate()}</span>${hol?`<span class="h">${esc(hol)}</span>`:ex?`<span class="ex">${ex}</span>`:''}</span>${tloc}${items}${bars}</button>`; }
    root.innerHTML = h;
    root.querySelectorAll('.mc').forEach(b => b.onclick = () => { const k = b.dataset.k;
      if (phone) { selectDay(k); scrollToTop(); } else openDay(k); });
  }
  // 날짜별 블록(팀 근무지·개인 예외·일정) n일치. 데스크톱 목록 보기와 폰 '주' 달력이 공용.
  function agendaDays(s, n){
    let h = '';
    for (let i=0;i<n;i++){ const d=addDays(s,i), k=key(d), hol=HOLIDAYS[k], off=isOffDay(k), t=teamLoc(k), evs=eventsOf(k).filter(e=>e.type!=='holiday');
      if (off && !evs.length && !hol) continue;
      const tl = t ? `<span class="tl" style="color:${LOC[t.code].color};border-color:color-mix(in srgb,${LOC[t.code].color} 45%,transparent)"><i></i>${LOC[t.code].ic} ${esc(teamLocName(t))}${t.src==='override'?' ·이날만':''}</span>` : '';
      const ex = off ? '' : PEOPLE.map(p=>{ const l=locOf(p.id,k); return (l&&!l.same)?`<span><b>${esc(p.name)}</b> <span style="color:${locColor(l)}">${esc(locText(l,k))}</span></span>`:''; }).filter(Boolean).join('');
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
    const sh = $('sheet'); sh.innerHTML = html; $('ovl').hidden = false; sh.scrollTop = 0;
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
  $('ovl').onclick = e => { if (e.target===$('ovl')) closeSheet(); };
  on(document, 'keydown', e => { if (e.key==='Escape' && !$('ovl').hidden) closeSheet(); });
  // 시트 안에서 Tab 이 뒤 화면으로 빠지지 않게 순환
  $('sheet').addEventListener('keydown', e => { if (e.key!=='Tab') return;
    const f = [...$('sheet').querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea')].filter(x => x.offsetParent!==null);
    if (!f.length) return; const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i<=0) { e.preventDefault(); f[f.length-1].focus(); } else if (!e.shiftKey && i===f.length-1) { e.preventDefault(); f[0].focus(); } });
  // 알림. undo 를 넘기면 6초 동안 '되돌리기' 버튼
  let toastT; function toast(m, undo){
    const t = $('toast'); t.innerHTML = `<span>${esc(m)}</span>${undo?'<button type="button" id="toast-undo">되돌리기</button>':''}`; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, undo ? 6000 : 2600);
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
        ${type==='meeting' ? `<div class="fld"><label>미팅 성격</label><div class="kinds" id="f-kinds">${Object.entries(KIND).map(([k,v],i)=>`<button type="button" data-kind="${k}" style="--c:var(--blue)" aria-pressed="${i===0}">${v.label}${v.desc?`<small>${v.desc}</small>`:''}</button>`).join('')}</div></div>
          <div class="fld"><label for="f-proj">프로젝트 연결 (선택 · 수주 후 건만)</label><select id="f-proj"><option value="">연결 안 함</option>${PROJECTS.map(w=>`<option value="${w.slug}">${esc(w.title)}</option>`).join('')}</select><div class="hint">지원~미팅 단계(위시켓) 건의 수주 미팅은 워크룸에서 등록합니다. 여기서는 그 외 미팅(진행 중 프로젝트·직거래·입찰·협력사)을 등록합니다.</div></div>`
          : `<div class="fld"><label for="f-kind">종류</label><select id="f-kind"><option value="internal">사내 (회의·행사)</option><option value="deadline">마감</option><option value="other">기타</option></select></div>`}
        <div class="row2"><div class="fld"><label for="f-date">날짜</label><input id="f-date" type="date" value="${date}"></div>
          <div class="fld"><label class="ck"><input type="checkbox" id="f-allday">종일</label><label for="f-repeat">반복</label><select id="f-repeat"><option value="">없음</option><option value="weekly">매주 (공휴일 건너뜀)</option></select></div></div>
        <div class="fld" id="until-row" hidden><label for="f-until">반복 종료 (선택 · 비우면 계속)</label><input id="f-until" type="date"></div>
        <div class="row2" id="timerow"><div class="fld"><label for="f-start">시작</label><input id="f-start" type="time" value="10:00"></div><div class="fld"><label for="f-end">종료</label><input id="f-end" type="time" value="11:00"></div></div>
        ${type==='meeting' ? `<div class="fld"><label>방식</label><div class="seg" id="f-mt">${Object.entries(MT).map(([k,v],i)=>`<button type="button" data-mt="${k}" aria-pressed="${i===1}">${v}</button>`).join('')}</div></div>`:''}
        <div class="fld"><label for="f-place">장소 / 링크</label><input id="f-place" placeholder="예: 고객사 (강남), 시청역2호점 미팅룸, Google Meet"></div>
        <div class="fld"><label>${type==='meeting'?'참석':'대상'}</label><div class="chips" id="f-people">${pcheck(pre.people||[ME])}</div></div>
        ${type==='meeting' ? `<div class="fld" id="autoout-row"><label class="ck"><input type="checkbox" id="f-autoout" checked>참석자를 그날 <b>외근</b>으로 표시 (대면 · 사무실 밖)</label></div>`:''}
        <div class="fld"><label for="f-note">메모</label><textarea id="f-note" rows="2" placeholder="준비물, 안건, 주의사항"></textarea></div>
        <div class="hint" id="ev-warn"></div>`;
    } else if (type==='loc') {
      const team = teamLoc(date), ov = personOverrides.find(o => o.person===person && o.date===date), om = outMeetingOf(person, date);
      const teamTab = `<div class="sub"><button type="button" data-scope="team" aria-pressed="${scope==='team'}">팀 전체</button><button type="button" data-scope="person" aria-pressed="${scope==='person'}">개인 근무지</button></div>`;
      if (scope==='team') {
        const r = routineAt(date);
        body = teamTab +
          `<div class="fld"><label for="f-date">날짜 (하루)</label><input id="f-date" type="date" value="${date}"></div>
          <div class="fld"><label>팀 근무지</label><div class="chips" id="f-loc">${['cityhall','forest','other','home'].map(c=>`<button type="button" class="chip" data-loc="${c}" style="--c:${LOC[c].color}" aria-pressed="${team?.code===c}"><i class="sw"></i>${LOC[c].full}</button>`).join('')}</div></div>
          <div class="fld" id="branch-row" ${team?.code==='other'?'':'hidden'}><label for="f-branch">지점명</label><input id="f-branch" placeholder="예: 패스트파이브 강남 3호점" value="${esc(team?.branch||'')}"></div>
          <div class="fld"><label for="f-note">사유 (선택 · 팀에 공개)</label><input id="f-note" placeholder="예: 마감일이라 전원 재택" value="${esc(team?.note||'')}"></div>
          <div class="fld"><label class="ck"><input type="checkbox" id="f-routine">이 날부터 매주 ${WD[parse(date).getDay()]}요일 기본으로 (주간 패턴 변경)</label><div class="hint">현재 이 날: ${team?teamLocFull(team)+(team.src==='routine'?' (주간 패턴)':' (이날만)'):'휴무'} · 지금 패턴: ${[1,2,3,4,5].map(w=>WD[w]+' '+LOC[r.days[w]].label).join(', ')}<br>패턴을 바꿔도 이 날 이전은 그대로입니다. 변경은 <b>${esc(P(ME).name)}</b> 이름으로 기록됩니다.</div></div>`;
      } else {
        body = teamTab + `<div class="fld"><label for="f-person">누구</label><select id="f-person">${PEOPLE.map(p=>`<option value="${p.id}" ${p.id===person?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div>
          <div class="fld"><label for="f-date">날짜 (하루)</label><input id="f-date" type="date" value="${date}"></div>
          <div class="fld"><label>이 날 근무지</label><div class="chips" id="f-loc"><button type="button" class="chip" data-loc="" style="--c:var(--text2)" aria-pressed="${!ov}">팀 근무지대로 · ${team?esc(teamLocName(team)):'휴무'}</button>${['out','cityhall','forest','other','home'].map(c=>`<button type="button" class="chip" data-loc="${c}" style="--c:${LOC[c].color}" aria-pressed="${ov?.loc===c}"><i class="sw"></i>${LOC[c].full}</button>`).join('')}</div></div>
          <div class="fld" id="branch-row" ${ov?.loc==='other'?'':'hidden'}><label for="f-branch">지점명</label><input id="f-branch" placeholder="예: 패스트파이브 강남 3호점" value="${esc(ov?.branch||'')}"></div>
          <div class="fld"><label for="f-note">사유 (선택 · 팀에 공개)</label><input id="f-note" placeholder="예: 고객사 방문 후 시청역 복귀" value="${esc(ov?.note||'')}"></div>
          <div class="hint">팀 근무지: ${team?teamLocFull(team):'휴무'}. 연차·반차는 '휴가'에서 등록합니다.${om?`<br>이 날 대면 미팅(${esc(om.title)})이 있어 '팀 근무지대로'면 자동으로 외근입니다. 사무실에 있다면 그 지점을 직접 고르세요.`:''}</div>`;
      }
    } else {
      body = `<div class="fld"><label for="f-person">누구</label><select id="f-person">${PEOPLE.map(p=>`<option value="${p.id}" ${p.id===person?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div>
        <div class="row2"><div class="fld"><label for="f-date">시작</label><input id="f-date" type="date" value="${date}"></div><div class="fld"><label for="f-to">종료</label><input id="f-to" type="date" value="${ed?m0.to:date}"></div></div>
        <div class="fld"><label>종류</label><div class="chips" id="f-lk">${['off','am','pm','sick'].map((c,i)=>`<button type="button" class="chip" data-lk="${c}" style="--c:${LOC[c].color}" aria-pressed="${ed ? m0.kind===c : i===0}">${LOC[c].label}</button>`).join('')}</div></div>
        <div class="fld"><label for="f-note">사유 (선택 · 팀에 공개)</label><input id="f-note" placeholder="비워도 됩니다" value="${esc(ed?m0.note||'':'')}"></div>
        <div class="hint" id="leave-days"></div><div class="hint" id="leave-warn"></div>`;
    }
    const title = ed ? { meeting:'미팅 수정', event:'일정 수정', leave:'휴가 수정' }[type]
      : type==='loc' ? (scope==='team'?'팀 근무지 변경':'개인 근무지') : type==='leave' ? '휴가 등록' : type==='meeting' ? '미팅 추가' : '일정 추가';
    openSheet(`<h2>${title}<button class="x" aria-label="닫기">✕</button></h2>
      ${ed ? '' : `<div class="types">${TYPES.map(([k,l,c])=>`<button type="button" data-t="${k}" style="--c:${c}" aria-pressed="${k===type}">${l}</button>`).join('')}</div>`}
      <form id="f"><div class="hint warn" id="past-hint" hidden>지난 날짜입니다. 정정한 내용은 변경 기록에 남습니다.</div>${body}
        <div class="hint warn" id="f-conflict" hidden></div>
        <div class="actions"><button type="button" class="btn" id="f-cancel">취소</button><button type="submit" class="btn primary">${ed?'수정 저장':'저장'}</button></div></form>`);
    const sh = $('sheet');
    sh.querySelectorAll('[data-t]').forEach(b => b.onclick = () => openAdd(b.dataset.t, pre));
    sh.querySelectorAll('[data-scope]').forEach(b => b.onclick = () => openAdd('loc', { ...pre, scope:b.dataset.scope }));
    const rsOne = () => sh.querySelector('[data-rs="one"]')?.getAttribute('aria-pressed')==='true';
    const syncRepeat = () => { const rep = $('f-repeat'); if (!rep) return; rep.disabled = rsOne(); $('until-row').hidden = !rep.value || rsOne(); };
    sh.querySelectorAll('.chip[data-pc],.chip[data-loc],.chip[data-lk],[data-kind],[data-mt],[data-rs]').forEach(b => b.onclick = () => {
      const multi = b.dataset.pc; if (!multi) b.parentElement.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed','false'));
      b.setAttribute('aria-pressed', multi ? String(b.getAttribute('aria-pressed')!=='true') : 'true');
      if (b.dataset.loc!==undefined && $('branch-row')) $('branch-row').hidden = b.dataset.loc!=='other';
      if (b.dataset.rs) syncRepeat();
      if (b.dataset.lk && sh._leaveWarn) sh._leaveWarn();
      if (b.dataset.mt || b.dataset.pc) evWarn(); });
    // 수정: 기존 값 채우기
    if (ed && (type==='meeting' || type==='event')) {
      $('f-title').value = m0.title;
      if (type==='meeting') { sh.querySelectorAll('[data-kind]').forEach(b => b.setAttribute('aria-pressed', b.dataset.kind===m0.kind)); $('f-proj').value = m0.project||''; sh.querySelectorAll('[data-mt]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mt===m0.mt)); $('f-autoout').checked = !!m0.autoOut; }
      else $('f-kind').value = m0.type;
      $('f-allday').checked = !!m0.allday; $('timerow').style.display = m0.allday ? 'none' : '';
      $('f-repeat').value = m0.repeat||''; $('f-until').value = m0.until||'';
      $('f-start').value = m0.start||'10:00'; $('f-end').value = m0.end||'';
      $('f-place').value = m0.place||''; $('f-note').value = m0.note||'';
      sh.querySelectorAll('[data-pc]').forEach(b => b.setAttribute('aria-pressed', m0.people.includes(b.dataset.pc)));
    }
    const ad = $('f-allday'); if (ad) ad.onchange = () => { $('timerow').style.display = ad.checked ? 'none' : ''; evWarn(); };
    if ($('f-repeat')) { $('f-repeat').onchange = syncRepeat; syncRepeat(); }
    ['f-date','f-start','f-end','f-place'].forEach(i => { if ($(i)) $(i).addEventListener('input', evWarn); });
    const ph = () => { $('past-hint').hidden = !($('f-date').value && $('f-date').value < TK); };
    $('f-date').addEventListener('input', ph); $('f-date').addEventListener('change', ph); ph();
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
    const baseOf = () => ed ? JSON.stringify(m0)
      : type==='loc' ? JSON.stringify(scope==='team' ? teamOverrides.find(o=>o.date===date)||null : personOverrides.find(o=>o.person===person && o.date===date)||null) : '';
    const base = baseOf();
    const conflict = () => { const f = $('f'); if (f.dataset.force || baseOf()===base) return false;
      const c = $('f-conflict'); c.hidden = false; c.textContent = `입력창을 연 뒤 다른 사람이 이 내용을 바꿨습니다. 화면 뒤 내용을 확인하고 한 번 더 저장하면 덮어씁니다.`;
      f.dataset.force = '1'; render(); return true; };
    $('f-cancel').onclick = closeSheet;
    $('f').onsubmit = e => { e.preventDefault(); save(type, scope, ed, conflict); };
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
      const start = v('f-start'), end = v('f-end'), one = ed && ed.ref.repeat && pressed('[data-rs]')[0]?.dataset.rs==='one';
      const repeat = one ? '' : v('f-repeat'), until = repeat ? v('f-until') : '';
      if (!date) { toast('날짜를 골라 주세요'); return; }
      if (!allday && !start) { toast('시작 시간을 넣어 주세요'); $('f-start').focus(); return; }
      if (!allday && start && end && toMin(end) <= toMin(start)) { toast('종료 시간이 시작보다 늦어야 해요'); $('f-end').focus(); return; }
      if (until && until < date) { toast('반복 종료일이 시작일보다 빨라요'); $('f-until').focus(); return; }
      if (conflict()) return;
      const autoOut = type==='meeting' && mt==='inperson' && $('f-autoout').checked;
      const fields = { type: type==='meeting' ? 'meeting' : v('f-kind'), kind: type==='meeting' ? kind : undefined, title, date, allday, start: allday?undefined:start, end: allday?undefined:(end||undefined),
        mt, place:v('f-place'), people, note:v('f-note'), repeat: repeat||undefined, until: until||undefined, skipHoliday: true, project: v('f-proj')||undefined, autoOut };
      const what = type==='meeting' ? '미팅' : '일정';
      run(async () => {
        if (ed) {
          const m = ed.ref, k = ed.k, rs = m.repeat ? (pressed('[data-rs]')[0]?.dataset.rs || 'one') : 'all', diff = diffText(m, k, fields);
          if (rs==='one') {
            await db(() => sb.from(T.events).insert({ ...eventRow({ ...fields, repeat:undefined, until:undefined, parent:m.id }), change_note:`${fmtD(k)} ${m.title} · 이 회차만 · ${diff}` }));
            await db(() => sb.from(T.events).update({ exdates:[...(m.exdates||[]), k], change_note:`${fmtD(k)} 회차를 따로 고침` }).eq('id', m.id));
          } else if (rs==='future' && k!==m.date) {
            await db(() => sb.from(T.events).insert({ ...eventRow({ ...fields, parent:m.id, exdates:(m.exdates||[]).filter(x=>x>=k) }), change_note:`${fmtD(k)}부터 ${m.title} · 이후 전부 · ${diff}` }));
            await db(() => sb.from(T.events).update({ repeat_until:key(addDays(parse(k),-1)), exdates:(m.exdates||[]).filter(x=>x<k), change_note:`${fmtD(k)}부터 새 반복으로 나눔` }).eq('id', m.id));
          } else {
            await db(() => sb.from(T.events).update({ ...eventRow({ ...fields, exdates:m.exdates, parent:m.parent }), change_note:`${fmtD(date)} ${title} · ${diff}` }).eq('id', m.id));
          }
          await reload(T.events); done(); toast(`${what}을 고쳤어요`);
        } else {
          await db(() => sb.from(T.events).insert({ ...eventRow(fields), change_note:`${fmtD(date)} ${title}${kind?' ('+KIND[kind].label+')':''} · ${names(people)}${autoOut?' — 참석자 외근 표시':''}` }));
          await reload(T.events); done(); toast(`${what}을 추가했어요`);
        }
      });
    } else if (type==='loc' && scope==='team') {
      const loc = pressed('.chip[data-loc]')[0]?.dataset.loc; if (!loc) { toast('근무지를 선택해 주세요'); return; }
      const k = v('f-date'), branch = loc==='other' ? v('f-branch') : '', note = v('f-note'), routine = $('f-routine').checked;
      if (loc==='other' && !branch) { toast('지점명을 입력해 주세요'); $('f-branch').focus(); return; }
      if (!k || isOffDay(k)) { toast('휴무일입니다'); return; }
      if (conflict()) return;
      const before = teamLoc(k), wd = parse(k).getDay();
      const label = `${fmtD(k)} ${teamLocName(before)} → ${branch||LOC[loc].label}${note?' ('+note+')':''}`;
      run(async () => {
        let pattern = routineAt(k);
        if (routine) {
          const days = { ...pattern.days, [wd]:loc };
          await db(() => sb.from(T.routines).upsert({ valid_from:k, days, change_note:`${fmtD(k)}부터 매주 ${WD[wd]}요일 ${LOC[loc].label}` }, { onConflict:'valid_from' }));
          pattern = { days };
        }
        if (pattern.days[wd]!==loc || branch || note) await db(() => sb.from(T.team).upsert({ work_date:k, loc, branch:branch||null, note:note||null, change_note:label }, { onConflict:'work_date' }));
        else await db(() => sb.from(T.team).delete().eq('work_date', k));
        await reload(T.routines, T.team); done(); toast(`${fmtD(k)} 팀 근무지를 ${branch||LOC[loc].label}로 바꿨어요`);
      });
    } else if (type==='loc') {
      const loc = pressed('.chip[data-loc]')[0]?.dataset.loc ?? '', p = v('f-person'), k = v('f-date'), branch = loc==='other' ? v('f-branch') : '', note = v('f-note');
      if (!k || isOffDay(k)) { toast('휴무일입니다'); return; }
      if (loc==='other' && !branch) { toast('지점명을 입력해 주세요'); $('f-branch').focus(); return; }
      if (conflict()) return;
      run(async () => {
        if (loc) await db(() => sb.from(T.member).upsert({ member_id:p, work_date:k, loc, branch:branch||null, note:note||null, change_note:`${fmtD(k)} ${P(p).name} → ${branch||LOC[loc].label}${note?' · '+note:''}` }, { onConflict:'member_id,work_date' }));
        else await db(() => sb.from(T.member).delete().eq('member_id', p).eq('work_date', k));
        await reload(T.member); done(); toast(`${P(p).name} · ${fmtD(k)} ${loc ? (branch||LOC[loc].label) : '팀 근무지대로'}`);
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
      e.mt ? ['방식', MT[e.mt]] : null,
      e.place ? ['장소', e.place] : null,
      e.type==='wishket' ? ['상태', e.done?'미팅 완료':'미팅 예정'] : null,
      e.type==='wishket' ? ['경로', e.ref.client] : null,
      e.people.length ? [e.type==='wishket'?'담당':'참석', e.people.map(p=>P(p).name).join(', ') + (e.type==='wishket'&&e.people.length>1?' (주 · 보조)':'')] : null,
      e.repeat ? ['반복', '매주 '+WD[d.getDay()]+'요일'+(e.skipHoliday?' (공휴일 건너뜀)':'')+(e.until?` · ${fmtD(e.until)}까지`:'')] : null,
      (e.type==='meeting' && e.autoOut) || (e.type==='wishket' && e.mt==='inperson' && !atOffice(e.place)) ? ['근무지', '참석자 외근으로 표시됨'] : null,
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
      run(async () => {
        await db(() => sb.from(tbl).update({ deleted_at:new Date().toISOString(), change_note:what }).eq('id', e.ref.id));
        await reload(tbl); closeSheet(); render();
        toast('삭제했어요', () => run(async () => { await db(() => sb.from(tbl).update({ deleted_at:null, change_note:what }).eq('id', e.ref.id)); await reload(tbl); toast('되돌렸어요'); }));
      }); };
  }

  // ───────── 네비 ─────────
  $('v-week').onclick = () => { state.view='week'; render(); };
  $('v-month').onclick = () => { state.view='month'; state.anchor=parse(state.sel); render(); };
  $('v-list').onclick = () => { state.view='list'; state.listDays=14; render(); };
  $('btn-today').onclick = () => { state.slide = dayDiff(state.sel, TK); state.sel=TK; state.anchor=new Date(TODAY); state.bweek=defaultBweek(); state.listDays=14; render(); };
  $('prev').onclick = () => step(-1); $('next').onclick = () => step(1);
  function step(n){ if (state.view==='week') { state.sel = key(addDays(parse(state.sel), 7*n)); state.anchor = parse(state.sel); }
    else if (state.view==='month') { state.anchor = new Date(state.anchor.getFullYear(), state.anchor.getMonth()+n, 1); state.sel = key(state.anchor); }
    else { state.sel = key(addDays(parse(state.sel), 14*n)); state.listDays = 14; } render(); }
  // 폰: 주간 스트립 이동(선택일 ±7일), 하단 달력 월/주 전환, 월 이동(선택일은 유지)
  $('m-prev').onclick = () => stepStrip(-1); $('m-next').onclick = () => stepStrip(1);
  // 5일 카드 끌어서 넘기기: 손가락(또는 마우스)을 따라 움직이고, 놓으면 끈 칸 수만큼 날짜가 바뀝니다.
  // 가로로 확실히 움직일 때만 잡고, 세로 스크롤은 그대로 둡니다. 화면 왼쪽 가장자리는 Safari 뒤로 가기 제스처에 양보합니다.
  (() => { const vp = $('m-strip'); let x0=null, y0=0, dx=0, drag=false, moved=false, pid=null;
    vp.addEventListener('pointerdown', e => { moved = false; if (e.pointerType==='mouse' && e.button!==0) return; if (e.clientX < 24) return;
      x0 = e.clientX; y0 = e.clientY; dx = 0; drag = false; pid = e.pointerId; });
    vp.addEventListener('pointermove', e => { if (x0===null || e.pointerId!==pid) return; dx = e.clientX - x0; const dy = e.clientY - y0;
      if (!drag) { if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)*1.3) { drag = true; moved = true; try { vp.setPointerCapture(pid); } catch(_){} vp.classList.add('dragging'); }
        else { if (Math.abs(dy) > 10) x0 = null; return; } }
      const cur = vp.querySelector('.strip:not(.leaving)'); if (cur) cur.style.transform = `translateX(${dx}px)`; });
    const end = () => { if (x0===null) return; x0 = null; vp.classList.remove('dragging'); if (!drag) return; drag = false;
      const pitch = (vp.clientWidth + 5) / 5; let days = Math.round(-dx / pitch);
      if (!days && Math.abs(dx) > pitch*0.35) days = dx < 0 ? 1 : -1;
      if (days) { state.dragPx = dx; selectDay(key(addDays(parse(state.sel), days))); }
      else { const cur = vp.querySelector('.strip'); if (cur) cur.style.transform = ''; } };
    vp.addEventListener('pointerup', end); vp.addEventListener('pointercancel', end);
    // 끌기가 끝난 직후의 클릭은 날짜 선택으로 치지 않음
    vp.addEventListener('click', e => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
  })();
  $('m-vmonth').onclick = () => { state.mview='month'; state.anchor=parse(state.sel); render(); };
  $('m-vweek').onclick = () => { state.mview='week'; state.anchor=parse(state.sel); render(); };
  // 하단 달력 이동: 월 모드는 한 달, 주 모드는 한 주 (위의 선택일은 그대로)
  const stepCal = n => { state.anchor = state.mview==='month' ? new Date(state.anchor.getFullYear(), state.anchor.getMonth()+n, 1) : addDays(state.anchor, 7*n); render(); };
  $('m-cprev').onclick = () => stepCal(-1); $('m-cnext').onclick = () => stepCal(1);
  $('log-open').onclick = openLog;
  $('btn-back').onclick = () => ctx.onBack?.();
  $('btn-add-top').onclick = () => openAdd('meeting'); $('fab').onclick = () => openAdd('meeting');
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
  async function openPush(){
    const env = pushEnv();
    const head = `<h2>알림 설정<button class="x" aria-label="닫기">✕</button></h2>`;
    const what = `<div class="hint" style="margin-bottom:.9rem">받는 알림: 근무일 저녁 6:30 다음 근무일 안내(평소와 다를 때만), 오늘·내일 팀 근무지와 내 일정이 바뀌었을 때(바꾼 사람 제외, 밤 10시~아침 7시 30분 변경은 아침에).</div>`;
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
      body = stat('var(--red)', '이 기기에서 알림이 차단돼 있어요') + `<div class="hint">${env.ios ? '아이폰 설정 → 알림 → 워크룸 → 알림 허용을 켠 뒤 다시 열어 주세요.' : '주소창 왼쪽 사이트 설정(자물쇠)에서 알림을 허용한 뒤 새로고침해 주세요.'}</div>`;
    } else {
      let sub = null; try { sub = await currentSub(); if (sub && env.perm === 'granted' && (!pushRow || pushRow.endpoint !== sub.endpoint)) await saveSub(sub); } catch (e) { console.warn(e); }
      if (sub && pushRow && env.perm === 'granted') {
        // morning_brief 컬럼 = '저녁 안내' 켜기/끄기 (이름은 첫 설계 때 것)
        body = stat('var(--green)', '이 기기에서 알림을 받고 있어요') + `
          <div class="fld"><label class="ck"><input type="checkbox" id="p-brief" ${pushRow.morning_brief?'checked':''}>저녁 6:30 다음 근무일 안내 <small style="color:var(--text2)">· 근무지가 평소와 다르거나 일정·팀원 부재가 있을 때만</small></label></div>
          <div class="fld"><label class="ck"><input type="checkbox" id="p-change" ${pushRow.change_alerts?'checked':''}>팀 근무지·내 일정 변경 알림 <small style="color:var(--text2)">· 밤 10시~아침 7시 30분 변경은 아침에</small></label></div>
          <div class="hint">설정은 기기마다 따로입니다. 다른 기기에서도 받으려면 그 기기에서 켜 주세요.</div>
          <div class="actions"><button class="btn" id="p-test">테스트 알림</button><button class="btn danger" id="p-off">이 기기 알림 끄기</button></div>`;
      } else {
        body = stat('var(--text2)', '이 기기에서는 아직 알림이 꺼져 있어요') + what + `<div class="actions"><button class="btn primary" id="p-on">이 기기에서 알림 켜기</button></div>`;
      }
    }
    if (!ME) body = stat('var(--yellow)', '팀원 계정과 연결된 사람만 알림을 켤 수 있어요') + `<div class="hint">워크룸 메뉴의 팀 관리에서 로그인 계정을 연결해 주세요.</div>`;
    openSheet(head + body);
    const q = id => $(id);
    if (q('p-on')) q('p-on').onclick = enablePush;
    if (q('p-off')) q('p-off').onclick = disablePush;
    if (q('p-test')) q('p-test').onclick = testPush;
    if (q('p-brief')) q('p-brief').onchange = e => setPushPref({ morning_brief:e.target.checked });
    if (q('p-change')) q('p-change').onchange = e => setPushPref({ change_alerts:e.target.checked });
  }
  $('btn-push').onclick = () => openPush();

  // ───────── 시작·실시간·정리 ─────────
  // 폭 클래스: 컨테이너 밖(화면 고정) 요소용 — wide ≥900px(데스크톱 레이아웃), narrow ≤640px(시트를 아래에서)
  const ro = new ResizeObserver(([e]) => { const w = e.contentRect.width; root.classList.toggle('wide', w >= 900); root.classList.toggle('narrow', w <= 640); });
  ro.observe($('shell')); cleanups.push(() => ro.disconnect());
  // 세 명이 동시에 보고 있어도 바로 반영 — 바뀐 테이블만 다시 읽는다(잇단 이벤트는 묶어서)
  const pending = new Set(); let reloadT = null;
  const channel = sb.channel(`calendar-${Math.random().toString(36).slice(2,10)}`);
  Object.values(T).filter(t => t!==T.holidays).forEach(t => channel.on('postgres_changes', { event:'*', schema:'public', table:t }, () => {
    pending.add(t); clearTimeout(reloadT);
    reloadT = setTimeout(() => { const ts = [...pending]; pending.clear(); reload(...ts).catch(e => console.warn('실시간 갱신 실패:', e)); }, 250);
  }));
  channel.subscribe();
  cleanups.push(() => { clearTimeout(reloadT); sb.removeChannel(channel); });
  // 날짜가 바뀌면(자정을 넘겨 열어 둔 경우) 오늘 기준을 다시 잡고, 앱으로 돌아오면(아이폰 홈 화면 앱) 최신으로 다시 읽기
  const tick = setInterval(() => { const d = new Date(); d.setHours(0,0,0,0); if (key(d)!==TK) { const wasToday = state.sel===TK; TODAY = d; TK = key(d); if (wasToday) state.sel = TK; render(); } }, 60000);
  cleanups.push(() => clearInterval(tick));
  on(document, 'visibilitychange', () => { if (document.visibilityState==='visible' && loaded && !setupNeeded) loadAll(); });
  setContext(ctx);
  if (pushEnv().supported) swReg();   // 미리 등록해 두면 '알림 켜기'가 빨라진다(캐시는 안 함)
  loadAll().then(syncPush);
  return { setContext, destroy(){ cleanups.splice(0).forEach(f => { try { f(); } catch (_) {} }); root.innerHTML = ''; } };
}
