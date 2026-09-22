/* 국토교통부 공사기간 산정 기준 원문 데이터
   - 2019 「공공 건설공사의 공사기간 산정기준」(국토교통부 훈령 제1140호, data/gosi_period_2019.pdf)
   - 2024 「적정 공사기간 확보를 위한 가이드라인」(국토교통부, data/guide_period_2024.pdf)
   page 는 PDF 뷰어 페이지(#page=N). 값은 원문 표를 그대로 옮긴 것이며 계산 로직은 index.html 에 있다. */
window.MOLIT = {
 docs:{
  gosi:{title:'공공 건설공사의 공사기간 산정기준 (국토부 훈령, 2019)',file:'data/gosi_period_2019.pdf'},
  guide:{title:'2024년 적정 공사기간 확보를 위한 가이드라인 (국토부)',file:'data/guide_period_2024.pdf'},
 },
 /* 제2장 (1) 준비기간 — <참고> 건설공사 유형별 준비기간(예시), 2024 가이드라인 p.13 (PDF 19) */
 prep:{page:19,src:'2024 가이드라인 제2장 <참고> 유형별 준비기간(예시)',
  types:[
   {id:'apt',label:'공동주택',days:45},
   {id:'expressway',label:'고속도로공사',days:180},
   {id:'rail',label:'철도공사',days:90},
   {id:'pave_new',label:'포장공사(신설)',days:50},
   {id:'pave_repair',label:'포장공사(수선)',days:60},
   {id:'utility',label:'공동구공사',days:80},
   {id:'water',label:'상수도공사',days:60},
   {id:'river',label:'하천공사',days:40},
   {id:'port',label:'항만공사',days:40},
   {id:'steel_bridge',label:'강교가설공사',days:90},
   {id:'pc_bridge',label:'PC교량 공사',days:70},
   {id:'bridge_repair',label:'교량보수공사',days:60},
  ]},
 /* 제2장 (5) 정리기간 — 주요공종 마무리 후 준공 전 1개월 범위 (2024 가이드라인 PDF 23 / 2019 훈령 제11조 PDF 9) */
 cleanup:{page:23,gosiPage:9,maxDays:30,src:'2024 가이드라인 제2장 (5) 정리기간 · 2019 훈령 제11조'},
 /* 제2장 (3) 비작업일수 산식 — 비작업일수 = A + B − C, C = A×B÷달력일수(반올림), 주40시간 하한(월 8일) (2024 가이드라인 PDF 19 / 2019 훈령 제7조 PDF 8) */
 formulaNW:{page:19,gosiPage:8,weeklyFloorPerMonth:8,src:'2024 가이드라인 제2장 (3) 비작업일수 · 2019 훈령 제7조'},
 /* <참고> 비작업일수 산정을 위한 기상조건 적용 기준 설정(예시) — 2024 가이드라인 PDF 20 */
 wxPreset:{page:20,src:'2024 가이드라인 제2장 <참고> 기상조건 적용 기준(예시)',
  rules:{rain:{value:3,note:'일강수량 3mm 이상 (옥외·구조물), 5mm 기준도 예시'},heat:{value:33,note:'체감온도 33℃ 이상 (혹서기)'},cold:{value:0,note:'최저기온 0℃ 이하 (동절기, 콘크리트 타설)'},wind:{value:15,note:'최대순간풍속 15m/s 이상 (타워크레인 운행 제한, 산안규칙 제37조)'},snow:{value:5,note:'신적설 5cm 이상'}},
  scopes:{rain:['earth','concrete','height','general'],heat:['earth','concrete','height','general'],cold:['concrete'],wind:['height'],snow:['earth','concrete','height','general']}},
 /* 부록 3 기상조건별·지역별 비작업일수 (2014~2023 월평균, 일) — 지점별 13개 조건. 페이지는 조건 (1)의 시작 PDF 페이지 */
 regional:{page:49,years:'2014~2023',src:'2024 가이드라인 부록 3',
  conds:[
   {id:1,label:'혹서기 체감온도 33℃ 이상',page:49},{id:2,label:'혹서기 체감온도 35℃ 이상',page:53},{id:3,label:'혹서기 일최고기온 33℃ 이상',page:57},{id:4,label:'혹서기 일최고기온 35℃ 이상',page:61},
   {id:5,label:'동절기 일최고기온 0℃ 이하',page:65},{id:6,label:'동절기 일최심신적설 5cm 이상',page:69},{id:7,label:'동절기 최고기온 0℃ 이하 또는 신적설 5cm 이상',page:73},{id:8,label:'동절기 일최저기온 −12℃ 이하',page:77},
   {id:9,label:'일강수량 3mm 이상',page:81},{id:10,label:'일강수량 5mm 이상',page:85},{id:11,label:'일강수량 10mm 이상',page:89},{id:12,label:'일강수량 20mm 이상',page:93},{id:13,label:'일최대순간풍속 15m/s 이상',page:97}],
  stations:{
   '143':{name:'대구',rows:{
    1:[0,0,0,0,0,1.3,10.4,13.1,0,0,0,0],2:[0,0,0,0,0,0.1,2.8,5.4,0,0,0,0],3:[0,0,0,0,1.4,4.3,11.3,13.2,0.1,0,0,0],4:[0,0,0,0,0.4,1.2,5.6,6.9,0,0,0,0],
    5:[2.0,0.5,0,0,0,0,0,0,0,0,0,1.6],6:[0.1,0,0.1,0,0,0,0,0,0,0,0,0],7:[2.1,0.5,0.1,0,0,0,0,0,0,0,0,1.6],8:[0.9,0,0,0,0,0,0,0,0,0,0,0],
    9:[1.5,1.7,4.6,5.4,4.1,5.3,8.3,9.1,6.4,3.1,2.2,1.4],10:[1.3,1.3,3.8,4.4,3.5,4.0,7.0,7.7,4.6,2.6,2.0,1.1],11:[0.6,0.6,2.3,2.8,2.2,3.1,5.8,5.8,3.0,2.2,1.2,0.9],12:[0.1,0.2,0.5,0.8,0.6,1.7,3.2,3.9,2.2,1.1,0.3,0.4],
    13:[0.8,0.6,0.4,0.2,0.5,0,0.4,0.4,0.2,0.2,0.2,0.9]}},
   '279':{name:'구미',rows:{
    1:[0,0,0,0,0,0.8,11.8,14.3,0.1,0,0,0],2:[0,0,0,0,0,0,4.2,6.4,0,0,0,0],3:[0,0,0,0,0.8,2.4,9.7,10.6,0,0,0,0],4:[0,0,0,0,0.2,0.3,3.1,5.3,0,0,0,0],
    5:[2.2,0.5,0,0,0,0,0,0,0,0,0,1.4],6:[0,0,0,0,0,0,0,0,0,0,0,0],7:[2.2,0.5,0,0,0,0,0,0,0,0,0,1.4],8:[0.8,0,0,0,0,0,0,0,0,0,0,0],
    9:[1.5,1.6,3.7,5.5,4.2,5.2,9.0,9.5,5.5,3.3,2.4,1.4],10:[0.9,1.3,2.8,4.5,3.2,4.6,8.1,7.6,5.0,2.9,2.1,1.0],11:[0.6,0.7,1.5,3.6,2.3,3.2,6.0,5.9,3.0,1.9,1.3,0.9],12:[0.1,0.2,0.9,1.1,1.0,1.9,4.1,4.1,2.4,1.4,0.6,0.2],
    13:[0,0,0.2,0.1,0.2,0,0,0,0,0,0,0]}},
  }},
 /* 부록 1 법정 공휴일수 (2025~2034) — PDF 33 */
 holidays:{page:33,src:'2024 가이드라인 부록 1',years:{2025:[8,4,7,4,6,6,4,6,4,9,5,5],2026:[5,7,6,4,7,5,4,7,7,7,5,5],2027:[6,7,5,4,7,4,4,6,7,8,4,6],2028:[9,4,5,5,6,5,5,5,4,10,4,6],2029:[5,7,5,5,7,5,5,5,8,6,4,6],2030:[5,7,6,4,6,6,4,5,8,6,4,6]}},
 /* 부록 5 시설물별 공사기간 산정공식 (PDF 124~126). Y=공사기간(일), 산정값에 준비·정리기간을 합산. 비작업일수 포함값.
    vars: C_eok=총공사비(억원), C_mil=총공사비(백만원), G=지상층수, B=지하층수, A=연면적(100㎡), L=도로연장(m), W=도로폭원(m), BL=교량연장(m), S=양수장/배수장/가압장 개수, D=관경(mm), SL=하수도연장(m), RL=궤도연장(m) */
 formulas:{page:124,src:'2024 가이드라인 부록 5 (제3장 (3) 실적 공사기간을 활용한 적정성 검토: ±20% 이탈 시 재검토)',reviewPage:30,tolerance:0.2,
  list:[
   {id:'school',group:'건축물',label:'학교',vars:['C_eok'],range:'총공사비 200억원 이하',expr:'Y = 129.06·x^0.2557',f:v=>129.06*Math.pow(v.C_eok,0.2557),page:124},
   {id:'office',group:'건축물',label:'청사',vars:['C_eok'],range:'총공사비 500억원 이하',expr:'Y = 155.94·ln(x) − 82.355',f:v=>155.94*Math.log(v.C_eok)-82.355,page:124},
   {id:'medical',group:'건축물',label:'의료시설',vars:['C_eok'],range:'총공사비 200억원 이하',expr:'Y = −0.0385x² + 8.9084x + 140.87',f:v=>-0.0385*v.C_eok**2+8.9084*v.C_eok+140.87,page:124},
   {id:'police',group:'건축물',label:'경찰서',vars:['C_eok'],range:'총공사비 300억원 이하',expr:'Y = −0.0154x² + 7.9986x + 145.51',f:v=>-0.0154*v.C_eok**2+7.9986*v.C_eok+145.51,page:124},
   {id:'univ',group:'건축물',label:'대학·연구시설',vars:['C_eok'],range:'총공사비 5억원 이상 300억원 이하',expr:'Y = 201.62·ln(x) − 175.51',f:v=>201.62*Math.log(v.C_eok)-175.51,page:124},
   {id:'culture',group:'건축물',label:'공연·전시시설',vars:['C_eok'],range:'총공사비 5억원 이상 300억원 이하',expr:'Y = −205.7·ln(x) + 1375.4',f:v=>-205.7*Math.log(v.C_eok)+1375.4,page:124},
   {id:'dorm',group:'건축물',label:'기숙사',vars:['C_eok'],range:'총공사비 200억원 이하',expr:'Y = −0.0204x² + 6.6742x + 166.51',f:v=>-0.0204*v.C_eok**2+6.6742*v.C_eok+166.51,page:124},
   {id:'factory',group:'건축물',label:'공장·창고',vars:['C_eok'],range:'총공사비 200억원 이하',expr:'Y = −0.0271x² + 6.9664x + 146.97',f:v=>-0.0271*v.C_eok**2+6.9664*v.C_eok+146.97,page:124},
   {id:'sports',group:'건축물',label:'체육시설',vars:['C_eok'],range:'총공사비 300억원 이하',expr:'Y = 112.19·x^0.3719',f:v=>112.19*Math.pow(v.C_eok,0.3719),page:124},
   {id:'fire',group:'건축물',label:'소방시설',vars:['C_eok'],range:'총공사비 200억원 이하',expr:'Y = −0.0497x² + 10.744x + 114.94',f:v=>-0.0497*v.C_eok**2+10.744*v.C_eok+114.94,page:124},
   {id:'apt',group:'건축물',label:'공동주택',vars:['G','C_eok'],range:'총공사비 10억원 이상',expr:'Y = −21.674 + 7.953·G + 116.835·ln(C)',f:v=>-21.674+7.953*v.G+116.835*Math.log(v.C_eok),page:124},
   {id:'other_bldg',group:'건축물',label:'기타 건축물',vars:['B','G','A','C_eok'],range:'총공사비 10억원 이상',expr:'Y = −68.550 + 18.192·B + 12.079·G − 5.25·ln(A) + 167.632·ln(C)',f:v=>-68.550+18.192*v.B+12.079*v.G-5.25*Math.log(v.A)+167.632*Math.log(v.C_eok),page:124},
   {id:'road_pave',group:'토목',label:'도로포장 (토공 포함)',vars:['L','C_mil'],range:'총공사비 350억원 이하',expr:'Y = −637.009 + 173.198·ln(L) + 0.049·C',f:v=>-637.009+173.198*Math.log(v.L)+0.049*v.C_mil,page:125},
   {id:'road_bridge',group:'토목',label:'도로 (토공+교량)',vars:['W','L','BL','C_mil'],range:'총공사비 350억원 이하',expr:'Y = −160.855 − 14.288·W + 164.473·ln(L) − 1.474·BL + 0.052·C',f:v=>-160.855-14.288*v.W+164.473*Math.log(v.L)-1.474*v.BL+0.052*v.C_mil,page:125},
   {id:'agri_water',group:'토목',label:'농업용수',vars:['C_mil'],range:'총공사비 10~200억원',expr:'Y = −2251.569 + 415.137·ln(C)',f:v=>-2251.569+415.137*Math.log(v.C_mil),page:125},
   {id:'water',group:'토목',label:'상수도 (지방상수도)',vars:['S','D','C_mil'],range:'총공사비 80억원 이하',expr:'Y = −1175.174 + 119.731·S − 0.273·D + 222.426·ln(C)',f:v=>-1175.174+119.731*v.S-0.273*v.D+222.426*Math.log(v.C_mil),page:125},
   {id:'sewer',group:'토목',label:'하수도',vars:['SL','C_mil'],range:'총공사비 150억원 이하',expr:'Y = −452.433 + 98.364·ln(SL) + 0.083·C',f:v=>-452.433+98.364*Math.log(v.SL)+0.083*v.C_mil,page:125},
   {id:'rail_track',group:'토목',label:'철도(궤도)',vars:['RL','C_mil'],range:'총공사비 1,200억원 이하',expr:'Y = −1723.316 − 74.260·ln(RL) + 372.266·ln(C)',f:v=>-1723.316-74.260*Math.log(v.RL)+372.266*Math.log(v.C_mil),page:125},
  ],
  varLabels:{C_eok:'총공사비 (억원)',C_mil:'총공사비 (백만원)',G:'지상층수 (층)',B:'지하층수 (층)',A:'연면적 (100㎡ 단위)',L:'도로연장 (m)',W:'도로폭원 (m)',BL:'교량연장 (m)',S:'양수·배수·가압장 개수',D:'관경 (mm)',SL:'하수도 연장 (m)',RL:'궤도연장 (m)'}},
 /* 제3장 (2) 산정근거 명시 항목 — 2019 훈령 제15조 */
 basisItems:['준비기간','작업일수 (표준작업량 등 근거)','비작업일수 산정 시 적용한 기상조건','정리기간','보정 사유 및 기간','시공조건'],
};

/* 부록 4 「1일 작업량」(2024 가이드라인) — 건축 분야 대표 항목. 표준품셈 항목(STD_ITEMS)과 같은 스키마로 매핑 후보에 합류한다.
   prod 는 원문 1일 작업량, crew 는 원문 산출근거(조 편성). src:'guide' 로 표시하고 guidePage 로 원문 위치를 링크한다. */
window.STD_GUIDE = [
 {code:'G-01',name:'강관비계 설치 (높이 10m 이하, 쌍줄)',cat:'가설공사',unit:'m²',prod:60,nc:1,crew:'비계공 3 + 보통인부 1',ref:'2024 가이드라인 부록4 건축 1) 가설공사',syn:['강관비계','쌍줄비계','외부비계'],scope:'height',src:'guide',guidePage:111},
 {code:'G-02',name:'시스템비계 설치 및 해체 (10m 이하)',cat:'가설공사',unit:'m²',prod:100,nc:1,crew:'비계공 4 + 보통인부 1',ref:'2024 가이드라인 부록4 건축 1) 가설공사',syn:['시스템비계'],scope:'height',src:'guide',guidePage:111},
 {code:'G-03',name:'가설울타리 (EGI 휀스) 설치',cat:'가설공사',unit:'m',prod:115,nc:1,crew:'비계공 3 + 보통인부 1',ref:'2024 가이드라인 부록4 건축 1) 가설공사',syn:['가설울타리','egi휀스','가설휀스','가설펜스'],scope:'general',src:'guide',guidePage:111},
 {code:'G-04',name:'강관동바리 설치 및 해체 (건축, 3.5m 이하)',cat:'가설공사',unit:'m²',prod:100,nc:1,crew:'형틀목공 5 + 보통인부 1',ref:'2024 가이드라인 부록4 건축 1) 가설공사',syn:['동바리','강관동바리','서포트'],scope:'general',src:'guide',guidePage:111},
 {code:'G-05',name:'토사 굴착 (터파기, 굴삭기 1.0㎥, 난이도 보통)',cat:'토공사',unit:'m³',prod:514,nc:1,crew:'굴삭기 1.0㎥ 1대',ref:'2024 가이드라인 부록4 건축 2) 토공사',syn:['터파기','토사굴착','굴착'],scope:'earth',src:'guide',guidePage:112},
 {code:'G-06',name:'토사 굴착 (터파기, 굴삭기 1.0㎥, 지장물 발생)',cat:'토공사',unit:'m³',prod:380,nc:1,crew:'굴삭기 1.0㎥ 1대',ref:'2024 가이드라인 부록4 건축 2) 토공사',syn:['터파기 지장물','지장물 굴착'],scope:'earth',src:'guide',guidePage:112},
 {code:'G-07',name:'기초지정 (모래지정, 고르기·다짐 포함)',cat:'토공사',unit:'m³',prod:65,nc:1,crew:'보통인부 1 + 굴삭기 0.2㎥ 1 + 플레이트콤팩터 1',ref:'2024 가이드라인 부록4 건축 2) 토공사',syn:['잡석지정','모래지정','기초지정'],scope:'earth',src:'guide',guidePage:112},
 {code:'G-08',name:'기성말뚝 기초 (PHC D508, L=12m)',cat:'기초공사',unit:'본',prod:15,nc:1,crew:'보링공 1 + 기계설비공 1 + 특별인부 2 + 보통인부 1 + 용접공 1 + 파일천공장비 100ton 등',ref:'2024 가이드라인 부록4 건축 3) 기초공사',syn:['phc파일','기성말뚝','파일항타','말뚝기초'],scope:'earth',src:'guide',guidePage:113},
 {code:'G-09',name:'벽돌쌓기 (시멘트벽돌 0.5B, 3.6m 이하)',cat:'조적공사',unit:'m²',prod:27,nc:1,crew:'조적공 3 + 보통인부 1',ref:'2024 가이드라인 부록4 건축 6) 마감공사 가. 조적',syn:['벽돌쌓기','조적','시멘트벽돌'],scope:'interior',src:'guide',guidePage:118},
 {code:'G-10',name:'블록 보강쌓기 (콘크리트블록 190)',cat:'조적공사',unit:'m²',prod:14,nc:1,crew:'조적공 2 + 보통인부 1',ref:'2024 가이드라인 부록4 건축 6) 마감공사 가. 조적',syn:['블록쌓기','보강블록'],scope:'interior',src:'guide',guidePage:118},
 {code:'G-11',name:'시멘트 모르타르 바름 (24mm 이하 2회)',cat:'미장공사',unit:'m²',prod:42,nc:1,crew:'미장공 3 + 보통인부 1',ref:'2024 가이드라인 부록4 건축 6) 마감공사 나. 미장',syn:['미장','모르타르바름','시멘트모르타르'],scope:'interior',src:'guide',guidePage:118},
 {code:'G-12',name:'콘크리트면 마무리 (견출)',cat:'미장공사',unit:'m²',prod:17,nc:1,crew:'미장공 3 + 견출공 1 + 보통인부 1',ref:'2024 가이드라인 부록4 건축 6) 마감공사 나. 미장',syn:['견출','콘크리트면정리'],scope:'interior',src:'guide',guidePage:118},
 {code:'G-13',name:'경량기포콘크리트 타설',cat:'미장공사',unit:'m³',prod:113,nc:1,crew:'일반기계운전사 1 + 미장공 5 + 보통인부 3 + 타설장비 1',ref:'2024 가이드라인 부록4 건축 6) 마감공사 나. 미장',syn:['기포콘크리트','경량기포'],scope:'interior',src:'guide',guidePage:118},
 {code:'G-14',name:'도막방수 (바닥, 1층)',cat:'방수공사',unit:'m²',prod:200,nc:1,crew:'방수공 3 + 보통인부 1',ref:'2024 가이드라인 부록4 건축 6) 마감공사 다. 방수',syn:['도막방수','우레탄방수'],scope:'interior',src:'guide',guidePage:119},
 {code:'G-15',name:'시트방수 (접착식 1겹, 바닥)',cat:'방수공사',unit:'m²',prod:88,nc:1,crew:'방수공 3 + 보통인부 1',ref:'2024 가이드라인 부록4 건축 6) 마감공사 다. 방수',syn:['시트방수','아스팔트시트'],scope:'interior',src:'guide',guidePage:119},
 {code:'G-16',name:'시멘트 액체방수 (바닥, 1·2차)',cat:'방수공사',unit:'m²',prod:40,nc:1,crew:'방수공 3 + 보통인부 1',ref:'2024 가이드라인 부록4 건축 6) 마감공사 다. 방수',syn:['액체방수','액방'],scope:'interior',src:'guide',guidePage:119},
 {code:'G-17',name:'합성수지 창호 설치 (이중창 미서기)',cat:'창호공사',unit:'개소',prod:8,nc:1,crew:'창호공 4 + 보통인부 1',ref:'2024 가이드라인 부록4 건축 6) 마감공사 마. 창호',syn:['창호설치','pvc창호','하이샤시'],scope:'interior',src:'guide',guidePage:120},
 {code:'G-18',name:'창호유리 설치 (복층유리 18mm 이하)',cat:'창호공사',unit:'m²',prod:42,nc:1,crew:'유리공 5 + 보통인부 1',ref:'2024 가이드라인 부록4 건축 6) 마감공사 마. 창호',syn:['유리설치','복층유리','유리끼우기'],scope:'interior',src:'guide',guidePage:120},
 {code:'G-19',name:'타일 떠붙이기 (벽)',cat:'타일공사',unit:'m²',prod:21,nc:1,crew:'타일공 3 + 보통인부 1 + 줄눈공 1',ref:'2024 가이드라인 부록4 건축 6) 마감공사 바. 타일',syn:['벽타일','떠붙임','타일붙이기'],scope:'interior',src:'guide',guidePage:120},
 {code:'G-20',name:'타일 압착붙이기 (바닥)',cat:'타일공사',unit:'m²',prod:27,nc:1,crew:'타일공 3 + 보통인부 1 + 줄눈공 1',ref:'2024 가이드라인 부록4 건축 6) 마감공사 바. 타일',syn:['바닥타일','압착붙임'],scope:'interior',src:'guide',guidePage:120},
 {code:'G-21',name:'석고판 설치 (벽, 2겹)',cat:'수장공사',unit:'m²',prod:45,nc:1,crew:'내장공 2 + 보통인부 1',ref:'2024 가이드라인 부록4 건축 6) 마감공사 사. 수장',syn:['석고보드','석고판','벽석고'],scope:'interior',src:'guide',guidePage:121},
 {code:'G-22',name:'경량벽체틀 설치 (스터드 150mm 이하)',cat:'수장공사',unit:'m²',prod:65,nc:1,crew:'내장공 2 + 보통인부 1',ref:'2024 가이드라인 부록4 건축 6) 마감공사 사. 수장',syn:['경량벽체','경량철골벽','스터드'],scope:'interior',src:'guide',guidePage:121},
 {code:'G-23',name:'단열재 설치 (벽, 100mm 이하)',cat:'수장공사',unit:'m²',prod:70,nc:1,crew:'내장공 4 + 보통인부 1',ref:'2024 가이드라인 부록4 건축 6) 마감공사 사. 수장',syn:['단열재','단열재붙임','비드법단열재'],scope:'interior',src:'guide',guidePage:120},
 {code:'G-24',name:'수목 식재 (흉고 10~17cm, 기계시공)',cat:'조경공사',unit:'주',prod:12,nc:1,crew:'조경공 3 + 보통인부 1 + 굴삭기 0.4㎥',ref:'2024 가이드라인 부록4 건축 7) 조경공사',syn:['수목식재','교목식재','식재'],scope:'earth',src:'guide',guidePage:121},
 {code:'G-25',name:'잔디붙임 (평떼)',cat:'조경공사',unit:'m²',prod:150,nc:1,crew:'조경공 1 + 보통인부 4',ref:'2024 가이드라인 부록4 건축 7) 조경공사',syn:['잔디','평떼','잔디식재'],scope:'earth',src:'guide',guidePage:122},
 {code:'G-26',name:'강관 설치 (탄소강관 50mm 아크용접, 옥내)',cat:'기계설비공사',unit:'m',prod:13.5,nc:1,crew:'배관공 2 + 용접공 1 + 보통인부 1',ref:'2024 가이드라인 부록4 건축 8) 기계설비 가. 배관',syn:['강관배관','배관설치','탄소강관'],scope:'interior',src:'guide',guidePage:122},
 {code:'G-27',name:'경질관 설치 (PVC 100mm 소켓접합, 옥내)',cat:'기계설비공사',unit:'m',prod:31.2,nc:1,crew:'배관공 2 + 보통인부 1',ref:'2024 가이드라인 부록4 건축 8) 기계설비 가. 배관',syn:['pvc배관','경질관','배수배관'],scope:'interior',src:'guide',guidePage:123},
 {code:'G-28',name:'각형덕트 설치 (아연도강판 0.6mm)',cat:'기계설비공사',unit:'m²',prod:29.2,nc:1,crew:'덕트공 5 + 보통인부 1',ref:'2024 가이드라인 부록4 건축 8) 기계설비 나. 덕트',syn:['덕트','각형덕트','덕트설치'],scope:'interior',src:'guide',guidePage:123},
];
