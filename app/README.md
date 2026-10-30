# Penote

Penote is a handwriting note app for iPad and the web. It is a static web app (PWA) with no build step.

- Apple Pencil writing with pressure (pen, highlighter, stroke eraser, undo/redo)
  - Fingers scroll and pinch-zoom by default. Turn off "Apple Pencil로만 쓰기" to draw with a finger.
- PDF import and annotation, plus lined, grid and blank pages
- Audio recording linked to ink: strokes written while recording remember the recording time. With the player open, tap any stroke to hear what was said when it was written. "리플레이" shows strokes that come later in the recording greyed out.
- Notability `.note` import: handwriting, PDFs, recordings and the ink-to-audio sync (see `../notability/FORMAT.md`)
- PDF export via the iPad share sheet
- Dark mode: follows the iPad appearance or can be set to light or dark. Paper and ink adapt, and PDFs can optionally be darkened too. Exported PDFs always stay light.
- Works offline: everything is stored locally in IndexedDB

## Install on iPad

1. Open the GitHub Pages URL in Safari.
2. Tap Share, then **Add to Home Screen**.

## Run locally

```
cd app && python3 -m http.server 8000
```

Then open http://localhost:8000. The service worker is only registered over https.
