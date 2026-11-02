# Penote 작업 인계 (Handoff)

노타빌리티(Notability) 스타일의 아이패드 필기 PWA **Penote**를 로컬에서 이어 작업하기 위한 문서입니다.

- 배포 주소: https://topeanut.github.io/firstrepo/ (GitHub Pages, 현재 서비스 워커 `penote-v16`)
- 작업 브랜치: `claude/notability-app-7bfv32` → PR → `main` 병합 시 Pages 자동 배포
- 앱 코드: `app/` (빌드 없음, 순수 ES 모듈) · `.note` 포맷 분석: `notability/` · E2E/성능 스크립트: `tools/e2e/`

---

## 1. 빠른 시작

```bash
git clone https://github.com/topeanut/firstrepo.git && cd firstrepo
git checkout main            # 최신 배포본 = main (작업 브랜치도 같은 내용)
cd app && python3 -m http.server 8765
# 브라우저: http://localhost:8765
```

- 서비스 워커는 https 또는 localhost에서만 등록됩니다. 로컬에서 코드를 고쳤는데 반영이 안 되면 DevTools → Application → Service Workers → *Update on reload*를 켜거나 Unregister 하세요.
- **앱 파일을 바꿔 배포할 때는 `app/sw.js`의 `VERSION`을 반드시 올리세요** (`penote-v16` → `v17`). 안 올리면 아이패드에 옛 캐시가 남습니다.
- 아이패드 실기 테스트: 같은 Wi-Fi에서 `http://<맥 IP>:8765`로 열면 SW 없이 동작합니다. 홈 화면 앱(PWA)으로 테스트하려면 Pages에 배포해야 합니다(https 필요).

## 2. 배포 흐름

1. 작업 브랜치(또는 새 브랜치)에 커밋 → push
2. `main`으로 PR 생성 → 병합
3. `.github/workflows/pages.yml`이 `app/` 폴더를 Pages로 배포 (1~2분)
4. 확인: `curl -s https://topeanut.github.io/firstrepo/sw.js | grep VERSION`
5. 아이패드: 앱을 앱 전환기에서 완전히 종료 후 재실행 (한 번 더 필요할 수 있음)

## 3. 파일 구조

| 파일 | 역할 |
|---|---|
| `app/index.html`, `manifest.webmanifest`, `icons/` | PWA 셸 |
| `app/sw.js` | 오프라인 캐시. network-first + `cache: "no-cache"` 재검증 |
| `app/styles.css` | 전체 스타일. 디자인 토큰(`:root`), 라이트/다크, 1240px 이하 툴바 2줄(container query) |
| `app/js/app.js` | 라이브러리(폴더 트리, 검색, 색상, 다중 선택, 롱프레스 드래그), 히스토리(pushState/popstate), 노트 열기/닫기 "종이 날아오는" 애니메이션, 화면 분할(pane) |
| `app/js/editor.js` | **핵심.** 노트 편집기 한 개(pane당 1개). 툴바, 페이지 레이아웃/줌, PDF 렌더 큐, 사이드바 썸네일, 입력(펜/지우개/선택), undo/redo, 녹음/재생, 저장, 내보내기 |
| `app/js/ink.js` | 획 모델 → SVG/Canvas. `penChunks`(필압별 run), `penSvg`, `penLine`(라이브), `hlPath`, `drawStrokes`, `hitStroke`, `cutStroke` |
| `app/js/pdf.js` | pdf.js 래퍼: `loadPdf`, `renderPage`, `renderRegion`, 페이지 디코딩 이미지 LRU(`HOT=4`) |
| `app/js/render.js` | 종이 배경, `drawBackground`, `pageImage`, `makeThumb`, `exportPdf`(페이지당 1280px JPEG) |
| `app/js/db.js` | IndexedDB `penote` (v3) |
| `app/js/model.js` | 문서 모델(`newDoc`, `newPage`, `noteMeta`) |
| `app/js/import.js`, `plist.js` | PDF 가져오기, Notability `.note` 가져오기(zip + NSKeyedArchiver plist) |
| `app/js/items.js` | 첨부(사진/파일 카드) |
| `app/js/audio.js` | 녹음(MediaRecorder), 재생 |
| `app/js/theme.js`, `icons.js` | 테마, 인라인 SVG 아이콘 |
| `app/vendor/` | pdf.js 4.10.38, fflate (vendored) |
| `notability/FORMAT.md`, `note_parser.py` | `.note` 포맷 리버스엔지니어링 결과 |

### 디버그 훅
- `window.__editor`: 현재 포커스된 Editor 인스턴스. 콘솔이나 테스트에서 `__editor.setZoom(2, {x:400,y:300})`, `__editor.goToPage(10)`, `__editor.saveNow()` 등으로 쓸 수 있습니다.

## 4. 데이터

**IndexedDB `penote` v3**
- `notes`: 라이브러리 메타(`noteMeta`: id, title, modified, pageCount, folder, thumb dataURL)
- `docs`: 문서 본체(pages, recordings, items, folder, 마지막 보던 위치 `view`…). `strokeStore: true`면 strokes는 여기 없음
- `strokes`: 획 하나 = 레코드 하나(`{...stroke, note}`, index `note`, `seq`로 z-order). **저장은 바뀐 획만 기록**(`editor.changed` Map → `saveStrokes`). 옛 문서는 첫 저장 때 한 번 이관
- `blobs`: PDF, 녹음, 첨부 원본
- `folders`: `{id, name, parent, color}`

**모델**
- page: `{ id, w: 800, h, bg: {type: "lined"|"grid"|"blank"} | {type:"pdf", pdf: blobKey, page: n} }`
- stroke: `{ id, page, tool: "pen"|"hl", color, width, pts: [x,y,p, x,y,p, …], audio: {rec, t}|null, seq }` (좌표는 페이지 좌표계, 소수 2자리)

**localStorage** (`penote.` 접두): `tool, penColor, penSize, hlColor, hlSize, eraserMode, eraserSize, pencilOnly(기본 true), pencilDoubleTap, sidebar, theme, darkPdf`.

## 5. 반드시 알아야 할 설계 결정 / 함정

지금까지 버그를 고치며 얻은 것들입니다. 되돌리면 같은 버그가 재발합니다.

**펜 입력/잉크**
- **샘플은 timestamp 순서로 삽입** (`addPoint`). iPad Safari는 pointerdown을 늦게 보내고 이전 coalesced 샘플을 다음 move에서 재생합니다. 그대로 붙이면 선 시작에 되돌아가는 고리가 생겨 "두 줄"로 보였습니다.
- coalesced 샘플이 이벤트와 좌표계가 다르면 이후 사용 안 함(`Editor.badSamples`).
- 펜 렌더링은 **둥근 펜촉 centerline** 경로를 필압 run별로 나눈 `<g>`(`penChunks`). 외곽선 채우기 방식은 급커브에서 꼬여 번져 보였습니다.
- 라이브 획은 path 하나(`penLine`, 평균 굵기)만 매 프레임 갱신하고, pen-up 때 run 경로로 교체.
- 펜슬 더블탭 → 지우개: 이동 < 3px, < 0.2s 짜리 탭 두 번(300ms, 8px 이내). 너무 느슨하면 빠른 짧은 획이 먹힙니다. ⋯ 메뉴에서 끌 수 있음.
- 지우개는 포인트를 큐에 모아 rAF당 한 번 처리, 샘플 사이 간격을 보간.

**성능**
- **백그라운드 렌더(썸네일, 화면 밖 페이지, 확대 상세)는 펜이 1.5초 쉰 뒤에만** (`isPenIdle`, `PEN_REST`). 획 사이 틈에 스캔 PDF 렌더가 끼어들면 다음 획이 멈췄습니다.
- **pdf.js 페이지 cleanup LRU** (`pdf.js`의 `HOT=4`). pdf.js는 그린 페이지의 디코딩된 이미지를 cleanup 전까지 들고 있어서, 스캔 PDF에서 쪽당 ~12MB씩 메모리가 쌓였습니다. 화면용 렌더만 `keep=true`.
- Chrome 외(Safari)에서 `isImageDecoderSupported: false`. pdf.js 기본값은 Safari에서 실험적 ImageDecoder를 켜는데, WebKit에서 스캔 페이지 렌더 시 렌더러가 크래시했습니다. OffscreenCanvas는 기본값 유지(Chromium 측정상 메인 스레드 부담이 더 적음).
- 썸네일 배경은 페이지별 캐시(`thumbBg`, 최대 150). 이미 화면에 그려진 페이지는 그 캔버스를 축소해서 사용.
- PDF 페이지 캔버스는 `MAX_CANVAS_PX = 3e6`, 확대 상세는 1.2배 이상일 때만 `MAX_DETAIL_PX = 6e6`. 렌더 큐(`_bgQ`)는 한 번에 하나, 스크롤로 멀어진 페이지는 건너뜀.
- 내보내기 JPEG은 `toDataURL`(동기). Chrome의 `toBlob`/`convertToBlob`은 idle 스케줄이라 페이지당 1~7초 지연되는 경우가 있었습니다.
- 저장은 1.5초 디바운스, 획 단위 증분.

**줌 / 렌더링**
- 핀치 중에는 `.pages`에 **최종 레이아웃을 정확히 계산한 2D transform**(`translate+scale`)을 미리 적용 → 손을 떼면 같은 위치로 커밋(점프/깜빡임 없음).
- `will-change`나 3D transform 금지: Safari가 레이어를 만들어 잉크가 흐려지고, 해제 시 흰 화면이 번쩍입니다.
- 종이(줄/모눈)는 CSS 배경(`--step`), PDF만 캔버스.

**기타**
- 툴바: undo/redo는 `.tb-right`의 마지막(오른쪽 위, 다른 버튼과 간격). 1240px 이하에서 2줄.
- 노트 열기 시 `deferRender` + `holdRender`로 애니메이션 중 렌더 지연.

## 6. 테스트 (`tools/e2e/`)

Playwright(Chromium) 스크립트들입니다. 결과는 JSON으로 출력되고 `errs: []`면 통과입니다. 대부분 앱이 **`localhost:8765`에서 서빙 중**이라고 가정하며, 첫 인자 `OUT`은 스크린샷/산출물 폴더입니다.

```bash
npm i -D playwright && npx playwright install chromium webkit
cd app && python3 -m http.server 8765 &      # 앱 서버
python3 tools/e2e/make-scan-pdf.py /tmp/pt    # 스캔 PDF 60쪽 생성 (Pillow 필요)
```

| 스크립트 | 실행 | 확인 내용 |
|---|---|---|
| `test.js` | `node test.js OUT NOTE.note` | 새 노트/필기/라이브러리/.note 가져오기/재생 |
| `test5.js`, `test6.js`, `test7b.js` | `node X OUT NOTE.note` | 사이드바, 녹음바, 지우개, 분할, 폴더/드래그/선택 |
| `test4.js` | `node test4.js OUT` | 첨부(사진/파일/PDF 삽입), undo, 내보내기 시간 (`OUT/photo.jpg`, `OUT/lecture-notes.txt`, `OUT/out/<pdf>` 필요) |
| `pinch2.js` | `node pinch2.js OUT NOTE.note` | 핀치 줌 미리보기 ↔ 커밋 오차, 빈 프레임 |
| `write.js` | `node write.js OUT 8765 tag` | 빠른 짧은 획 12개 유지, 펜슬 더블탭 |
| `order.js` | `node order.js OUT 8765` | 늦은 pointerdown + 재생 샘플 → backtracks 0 |
| `hw2.js` | `node hw2.js /tmp/pt 8765 [zoom]` | **열자마자 연속 필기 시 longtask** (Safari 경로 흉내, CPU 4배 감속) |
| `bigsafari.js` | `node bigsafari.js /tmp/pt 8765` | 스크롤+필기 반복 시 프레임/longtask |
| `mem.js` | `node mem.js /tmp/pt 8765` | 60쪽 넘기며 전체 프로세스 메모리 추이 (평평해야 정상) |
| `hwk.js` | `PLAYWRIGHT_BROWSERS_PATH=… node hwk.js /tmp/pt 8765 [zoom] [sidebar]` | WebKit에서 필기 프레임 간격 |

`NOTE.note`는 Notability에서 내보낸 아무 `.note`나 쓰면 됩니다(개인 자료라 저장소에는 넣지 않았습니다).

측정 팁:
- `delete window.chrome; delete window.ImageDecoder`를 init script로 넣으면 Chromium에서 Safari의 pdf.js 경로를 흉내 냅니다(`hw2.js`, `mem.js` 참고).
- CPU 4배 감속 상태의 "Commit" 긴 작업은 에뮬레이션 아티팩트입니다(감속을 끄면 0).
- Playwright WebKit은 ephemeral context에서 IndexedDB Blob 저장이 실패합니다 → `launchPersistentContext` 사용.
- 옛 버전과 비교: `git archive <rev> app | tar -x -C /tmp/old` 후 다른 포트로 서빙.

## 7. 현재 상태와 남은 일

**완료 (v16, main 배포됨)**: 펜/형광펜/부분·획 지우개, 필압, PDF 주석, 녹음-잉크 동기 재생, `.note` 가져오기, PDF 내보내기, 다크 모드, 첨부, 선택 도구, 페이지 사이드바/인디케이터, 분할 화면, 제스처(2손가락 탭 undo, 3손가락 redo, 가장자리 스와이프), 폴더, 검색, 히스토리, 애니메이션, 펜슬 더블탭 지우개.

**실기기 미검증 (아이패드에서 확인 필요)**
- 두 줄 선 수정(timestamp 순서 삽입) — 시뮬레이션으로만 검증
- 큰 스캔 PDF(298쪽)에서 연속 필기 멈춤 — v16 수정 후 사용자 피드백 아직 없음
- 아이패드 Safari에서 OffscreenCanvas 경로가 실제로 더 나은지(데스크톱 WebKit과 Chromium 결과가 반대였음)

**아이디어 / 후속 후보**
- 라이브 획을 별도 작은 레이어로 분리해 매 프레임 repaint 범위 축소 (Safari 흐림/깜빡임 재발 주의, 실기기 필수)
- `items.js`의 사진 첨부 축소도 `toBlob` 사용 → Chrome에서 가끔 느릴 수 있음 (`render.js`의 `jpeg()` 방식으로 교체 가능)
- 텍스트 입력 도구, 도형 인식, 올가미 선택으로 획 이동, 페이지 순서 변경/삭제 UI, 백업(내보내기/가져오기) 기능
- 자동화 테스트를 저장소 안에서 바로 돌 수 있게 `package.json` + 고정 경로 정리

**참고: 저장소 루트의 `2.txt`, `tst`, `익스피릿 로고/`는 이 앱과 무관한 기존 파일입니다.**
