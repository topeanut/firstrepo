# Paper Office (Android, 네이티브)

폴라리스오피스처럼 여러 문서 포맷을 다루는 **네이티브 안드로이드 앱**의 1차 마일스톤(M1).
Kotlin + Jetpack Compose(Material3), **완전 오프라인**(인터넷 권한 없음 — 모든 처리는 기기 안에서).

## 현재 지원 범위 (M1)

| 포맷 | 보기 | 편집 |
|------|:----:|:----:|
| PDF | ✅ 연속 스크롤·왼쪽 스크롤바 | ✅ 주석(펜·형광펜·지우개)·페이지 삭제·PDF로 저장 |
| 텍스트 / CSV / Markdown | ✅ | ✅ 저장·다른 이름으로 저장 |
| 이미지 (png/jpg/…) | ✅ | — |
| 워드 (DOCX) | ✅ 문단 텍스트 | ⏳ |
| 엑셀 (XLSX) | ✅ 첫 시트 표 | ⏳ |
| 프레젠테이션 (PPTX) | ✅ 슬라이드 텍스트 | ⏳ |
| 한글 (HWP/HWPX) | ⏳ 준비 중 | ⏳ |

- 홈: **기기 전체 문서**를 **유형별 필터 + 최신순**으로 표시(모든 파일 접근 권한), 최근 연 문서
- 파일 열기: 저장소 접근 프레임워크(SAF) + 다른 앱의 "열기/공유"(VIEW 인텐트)
- 유형별 컬러 아이콘·태그 UI, 라이트/다크, edge-to-edge

### 저장소 접근
- Android 11+ 는 **모든 파일 접근(MANAGE_EXTERNAL_STORAGE)** 권한으로 기기 전체의 문서를
  직접 스캔합니다(Android/ 와 숨김 폴더 제외, 최신순). 파일은 전송되지 않습니다.
- Android 10 이하는 READ_EXTERNAL_STORAGE 런타임 권한을 사용합니다.
- 권한 없이도 "파일 열기"(SAF)로 개별 문서를 열 수 있습니다.

### PDF 편집 메모
- 주석은 **페이지 정규화 좌표**로 저장되어 해상도·확대와 무관하게 유지됩니다.
- 지우개는 **주석 레이어에서만** 지웁니다(페이지 내용은 보존).
- 저장(내보내기)은 외부 라이브러리 없이 각 페이지를 렌더→주석 합성→`PdfDocument`로 기록합니다.
  이 방식은 출력이 **래스터화**됩니다(텍스트 선택 불가). 벡터 보존 저장은 로드맵입니다.
- 페이지 **회전**은 좌표 복잡도 때문에 다음 단계로 미뤘습니다.

> DOCX/XLSX는 외부 의존성 없이 OOXML(ZIP+XML)에서 **내용을 추출해 보여주는** 수준입니다.
> 서식 완전 재현과 오피스 **편집**은 다음 마일스톤입니다.

## 빌드

Android SDK(Platform 34, Build-Tools 34)와 JDK 17+ 필요. Gradle 래퍼 포함.

```bash
cd android
echo "sdk.dir=/경로/Android/sdk" > local.properties   # 또는 ANDROID_HOME 설정
./gradlew assembleDebug
# 결과: app/build/outputs/apk/debug/app-debug.apk
```

설치:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Android Studio에서 `android/` 폴더를 열어 바로 빌드/실행해도 됩니다.

## 구조

```
app/src/main/
  AndroidManifest.xml            # 런처 + 파일 열기 인텐트, 인터넷 권한 없음
  java/com/paper/office/
    MainActivity.kt              # 액티비티 + SAF + AppViewModel(상태/최근문서)
    doc/
      DocModel.kt                # 포맷 감지(DocKind) + 라우팅
      PdfRepository.kt           # 내장 PdfRenderer 래퍼
      OfficeReaders.kt           # DOCX/XLSX 경량 파서(의존성 없음)
      TextIO.kt                  # 텍스트 읽기/쓰기
    ui/
      PaperApp.kt                # 홈·PDF·에디터·엑셀·워드·이미지 화면
      theme/Theme.kt             # Material3 라이트/다크
```

## 빌드 환경 메모

- AGP 8.7.2 · Gradle 8.11.1 · Kotlin 2.0.21 · compileSdk 34 · minSdk 26
- `settings.gradle.kts`에 Maven Central 구글 GCS 미러를 추가(네트워크 레이트리밋 회피).
  일반 환경에서는 `mavenCentral()`만으로 충분합니다.
