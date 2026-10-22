# 인계 — 뱅!

허브(41ways.github.io/norara)에 올린 온라인 뱅!. 배포 https://bang.41ways.workers.dev/ · 저장소 41ways/bang-fanproj.
읽었다고 바로 고치기 시작하지 말 것 — 사용자가 시킬 때 진행.

## 흐름 (허브 표준 — 바퀴벌레 포커 · 로보77 과 같다)

타이틀 → 방 고르기(이름 · 새 테이블 · 코드 · 마을 게시판의 열린 테이블) → 대기실 → 역할·인물(`phase: intro`) → 관문 → 판(`playing`) → 결과(`over`)

- 판은 역할·인물 화면에서 **모두 확인/고른 뒤에야** 열린다(사람은 40초, 봇은 1.5~5초). 1차판에서 "시작하자마자 봇이 쏜다"는 지적을 받은 부분
- 봇은 생각 1.2~2.2초 + 방금 연출 시간(`FX_MS`, hub.js · app.js 에 같은 표)만큼 기다린다. 사람 제한 시간도 연출이 끝난 뒤부터
- 화면은 상태를 줄 세워(`queue`/`pump`) 하나씩 그리고 연출을 그 위에 얹는다. 3통 넘게 밀리면 연출을 건너뛴다

## 규칙 근거

- **BGA 공개 소스** https://github.com/Syarwin/bga-bang (MIT) — 애매하면 여기를 본다
- dV Giochi 규칙서 · FAQ(Q01~Q26)
- BGA 와 같게 한 것: 술통은 단추, 손에 카드가 있으면 막을 게 없어도 묻는다, 럭키 듀크는 직접 고른다, 버리기에서 취소, 빈손이면 턴 자동 끝, 효과 없는 맥주는 묻는다, 강탈/캣 벌로우로 내 앞 카드도, 더미가 비면 버린 카드를 맨 위까지 다 섞는다, 무기 교체 확인, 인물 "무작위 / 두 장 중 고르기"
- 확장: 하이눈(13) · 한 줌의 카드(15) — `public/cards.js` 의 `EVENTS`, `src/engine.js` 의 `eventDeck()` · `newEvent()` · `startOfTurn()` · `nextTurn()`. 유령 마을 · 죽은 자는 "부활 카드" 설정
- 일부러 단순하게 한 것: 시드 케첨은 내 턴과 죽어 갈 때만(BGA 와 같음), 쓰러질 때 버리는 순서는 고르지 않음(페드로 다음일 때 BGA 는 묻는다), 갈증 중 인물 뽑기 능력은 끔

## 코드

- `src/engine.js` 규칙(제너레이터 하나, 요청 하나씩). `view(pid)` 가 사람마다 보이는 것만 낸다
- `src/bot.js` 봇 — `enemy()` 가 누가 누구를 쐈는지(`aggro`)로 편을 짐작
- `src/hub.js` 방 · 자리 · 관전 · 채팅 · 시계 · 역할/인물 · 연출 기다림
- `src/worker.js` Cloudflare DO 하나(main) · `server.js` 로컬 Node(같은 hub.js)
- `public/app.js` 화면 · `public/style.css` · 그림 `public/img/{cards,chars,roles,events,ui}`
- 그림 다시 만들기: `python tools/make_assets.py`(카드·인물·역할·이벤트), `python tools/make_ui.py`(단추·포스터·로고·아이콘·효과·게시판). 원본은 `raw/`(git 제외)

## 시험 · 확인

```
npm test                 # 규칙 46 · 이벤트 61 · 봇끼리 1000판(확장 섞음) · 방 흐름 · 어려운 방 흐름
node server.js           # http://localhost:8860
node server.js 8861 fast # 봇이 기다리지 않는다
```

- 화면 확인은 **음소거**로(사용자 지시). `?qa` 로 들어오면 `window.__qa.feed(state)` · `__qa.playFx([...])` 로 아무 장면이나 띄워 볼 수 있다
- 브라우저 창이 뒤에 있으면 CSS 애니메이션 · 타이머가 멈춰 스크린샷이 반투명하거나 늦다(실제 화면 문제 아님)
- 배포: `npx.cmd wrangler deploy` (푸시만으로는 안 바뀐다). 배포하면 진행 중인 방은 사라진다
