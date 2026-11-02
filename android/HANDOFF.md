# Paper Office — 개발 핸드오프

로컬에서 이어서 작업하기 위한 인수인계 문서입니다. (작성 기준: v0.12.0)

- 저장소: `topeanut/firstrepo`
- 작업 브랜치: `claude/polaris-office-reverse-engineering-0s3ydc`
- 네이티브 앱 경로: `android/` (레포 루트에는 별개의 웹 PWA 버전도 있음)

---

## 1. 빠른 시작 (로컬)

### 준비물
- **JDK 17+** (권장 17 또는 21)
- **Android SDK**: Platform 34, Build-Tools 34.0.0, Platform-Tools
- Android Studio(권장) 또는 CLI + Gradle 래퍼(동봉)

### 받기
```bash
git clone https://github.com/topeanut/firstrepo.git
cd firstrepo
git checkout claude/polaris-office-reverse-engineering-0s3ydc
cd android
```

### SDK 경로 지정
`android/local.properties` 생성(이 파일은 .gitignore 처리됨):
```
sdk.dir=/절대/경로/Android/sdk     # 또는 ANDROID_HOME 환경변수 설정
```

### 빌드 & 설치
```bash
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```
또는 Android Studio에서 `android/` 폴더 열고 Run ▶.

### 설치가 안 될 때 (삼성 갤럭시)
사이드로드 설치가 **"앱이 설치되지 않았습니다"** 로 막히면, 대부분 삼성 **자동 차단(Auto Blocker)** 때문입니다.
설정 → 보안 및 개인정보 보호 → **자동 차단 끄기** 후 설치. (설치 뒤 다시 켜도 됨)

---

## 2. 클라우드에서 넣어둔 빌드 설정 (로컬에선 되돌려도 됨)

클라우드 빌드 환경의 네트워크 레이트리밋을 피하려고 아래를 넣어뒀습니다. 로컬에선 원복해도 됩니다.

- `android/settings.gradle.kts`: Maven Central **GCS 미러**(`maven-central.storage-download.googleapis.com`)를 추가.
  → 로컬에선 `mavenCentral()` 만으로 충분하니 이 줄은 지워도 됩니다.
- `android/gradle.properties`: `org.gradle.parallel=false`, `org.gradle.workers.max=1`.
  → 로컬에선 `parallel=true` 로 되돌리고 `workers.max` 줄을 지우면 빌드가 더 빠릅니다.

---

## 3. 기술 스택 / 버전

| 항목 | 값 |
|---|---|
| 언어/UI | Kotlin, Jetpack Compose (Material 3) |
| AGP | 8.7.2 |
| Gradle | 8.11.1 (wrapper) |
| Kotlin | 2.0.21 (Compose 플러그인) |
| compileSdk / targetSdk | 34 |
| minSdk | 24 |
| Compose BOM | 2024.10.01 |
| PDF 저장(벡터) | com.tom-roush:pdfbox-android:2.0.27.0 |
| PDF 렌더(보기) | Android 내장 `PdfRenderer` |

- **인터넷 권한 없음** — 모든 처리는 기기 내에서. (업로드/추적 없음)
- 저장소 접근: `MANAGE_EXTERNAL_STORAGE`(Android 11+) / `READ_EXTERNAL_STORAGE`(≤32).

---

## 4. 프로젝트 구조 (핵심 파일)

```
android/app/src/main/
  AndroidManifest.xml            # 런처 + VIEW 인텐트(열기 대상) + 저장소 권한
  java/com/paper/office/
    MainActivity.kt              # Activity + SAF 런처들 + AppViewModel(앱 상태 전부)
    doc/
      DocModel.kt                # DocKind(포맷) 정의 + 감지/라우팅
      DeviceScanner.kt           # '모든 파일 접근'으로 기기 전체 문서 스캔
      DeviceFiles.kt             # SAF 폴더 조회(현재는 보조), Entry 모델
      PdfRepository.kt           # PdfRenderer 래퍼(보기용)
      PdfEditModel.kt            # PDF 편집 상태(주석/회전/삭제/순서)
      PdfExporter.kt             # PDF 저장(래스터 방식, 폴백) + 주석 레이어 생성
      PdfVectorExporter.kt       # PDF 저장(벡터 보존, 기본) - pdfbox
      OfficeReaders.kt           # DOCX/XLSX/PPTX 텍스트·표 추출(의존성 없음)
      XlsxWriter.kt              # 엑셀 셀 값 되쓰기(구조/서식 보존)
      DocxWriter.kt              # 워드 문단 텍스트 되쓰기(구조/스타일 보존)
      TextIO.kt                  # 텍스트 읽기/쓰기
    ui/
      PaperApp.kt                # 모든 화면(홈/PDF편집기/텍스트/엑셀/워드/PPT/이미지)
      theme/Theme.kt             # Material3 라이트/다크 색
```

**상태 관리:** 거의 모든 앱 상태는 `AppViewModel`(MainActivity.kt 하단)에 있음.
파일 저장(SAF)은 Activity의 `registerForActivityResult` 런처들이 담당 →
`openDoc / createDoc(txt) / createPdf / createXlsx / createDocx / openTree`.

---

## 5. 기능 현황 & 위치

| 기능 | 상태 | 주요 위치 |
|---|---|---|
| 홈: 기기 전체 문서·유형필터·최신순·최근문서 | ✅ | PaperApp.kt `HomeScreen`, DeviceScanner.kt |
| PDF 보기(연속 스크롤·왼쪽 스크롤바) | ✅ | PaperApp.kt `PdfEditorView`/`PdfEditablePage` |
| PDF 주석(펜/형광펜/지우개·실행취소) | ✅ | `AnnotationCanvas`, PdfEditModel.kt |
| PDF 페이지 회전/삭제/순서변경/번호 | ✅ | `PdfEditablePage`, PdfEditModel.kt |
| PDF 저장(벡터 기본, 래스터 폴백) | ✅ | PdfVectorExporter.kt / PdfExporter.kt |
| 텍스트/CSV/MD 편집·저장 | ✅ | `TextEditorView`, TextIO.kt |
| 엑셀(XLSX) 셀 값 편집·저장 | ✅ | `SheetView`, XlsxWriter.kt |
| 워드(DOCX) 문단 텍스트 편집·저장 | ✅ | `DocxView`, DocxWriter.kt |
| PPTX 슬라이드 텍스트 보기 | ✅(보기) | `PptxView`, OfficeReaders.readPptxText |
| 이미지 보기 | ✅ | `ImageView` |
| 화면 전환/리스트/카드 애니메이션 | ✅ | PaperApp.kt `PaperApp`(AnimatedContent), `FileRow` 등 |
| HWP/HWPX | ❌ 미구현 | — |

---

## 6. 알려진 한계 (다음 작업 시 주의)

- **런타임 미검증:** 클라우드엔 에뮬레이터가 없어 **컴파일/서명까지만** 검증됨.
  각 기능은 실제 기기에서 동작 확인 필요(특히 저장 결과 파일).
- **PDF 주석 + 내재 회전:** 주석 좌표는 '기본(업라이트)' 공간 기준. 원본 페이지에
  내재 회전(`/Rotate ≠ 0`)이 있는 문서는 주석 위치가 어긋날 수 있음(대부분 문서는 0).
- **엑셀 편집:** 화면에 보이는 그리드 범위의 셀만 편집 가능. **수식은 값으로 대체**됨.
  저장 후 Excel이 "복구" 안내 없이 열리는지 확인 권장.
- **워드 편집:** 문단 단위 1:1 매핑. **문단 내 혼합 서식**(문장 중간 굵게 등)은 저장 시 합쳐짐.
  표 등 문단 외 요소는 유지. 문단 추가/삭제는 끝에서만 안전.
- **PDF 벡터 저장:** 실패 시 자동으로 래스터 저장으로 폴백(토스트에 "(래스터)" 표시).

---

## 7. 다음 작업 아이디어 (로드맵)

- **HWP/HWPX 뷰어**: 가장 큰 미구현. HWP5는 CFB(복합문서) 바이너리, HWPX는 ZIP+XML.
  HWPX부터 텍스트 추출로 시작하는 게 현실적.
- **오피스 편집 충실도**: 서식 완전 보존이 필요하면 Apache POI(안드로이드 포팅) 검토.
  단, POI는 용량·런타임 이슈가 있어 충분한 기기 테스트 필요.
- **PDF 텍스트 검색/선택**: 현재 PdfRenderer는 텍스트 레이어가 없음. pdfbox로 텍스트 추출 가능.
- **PDF 페이지 썸네일 패널 / 드래그 순서변경**(현재는 위/아래 버튼).
- **주석 종류 추가**: 텍스트 상자, 도형, 하이라이트 자동 스냅 등.
- **PPTX 렌더링**: 현재 텍스트만. 슬라이드 레이아웃 렌더는 큰 작업.
- **릴리스 서명/배포**: 아래 8번 참고.

---

## 8. 릴리스 빌드 (배포용)

현재는 debug 키로 서명됨(`~/.android/debug.keystore`). 배포하려면 release 키 필요:
```bash
keytool -genkeypair -v -keystore paper-release.jks -alias paper \
  -keyalg RSA -keysize 2048 -validity 10000
```
`app/build.gradle.kts`의 `signingConfigs`에 release 설정 추가 후 `./gradlew assembleRelease`.
(키스토어/비밀번호는 커밋 금지 — `local.properties`나 환경변수로 주입)

APK 재서명/정렬이 필요하면:
```bash
$ANDROID_HOME/build-tools/34.0.0/zipalign -f 4 in.apk out.apk
$ANDROID_HOME/build-tools/34.0.0/apksigner sign --ks key.jks \
  --v2-signing-enabled true --v3-signing-enabled true out.apk
```

---

## 9. 커밋 히스토리 요약 (이 브랜치)

웹 PWA → 네이티브 골격 → 홈(폴더→기기전체)·유형필터 → 디자인 개편 → 애니메이션 →
PDF 편집(주석·회전·순서·삭제) → PDF 벡터 저장 → 엑셀 편집 → 워드 편집 순으로 쌓여 있음.
`git log --oneline` 으로 단계별 확인 가능.
