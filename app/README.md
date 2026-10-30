# Penote

Penote is a handwriting note app for iPad and the web. It is a static web app (PWA) with no build step.

- Apple Pencil writing with pressure: pen (7 colours including black), highlighter, and an eraser that rubs out parts of strokes or removes whole strokes. Undo and redo are available.
- Undo and redo sit in their own group in the top-right corner. Double-tap the Pencil tip on the same spot to switch between the eraser and your previous tool (web apps do not receive the Pencil's barrel double-tap). Gestures: two-finger tap undoes and three-finger tap redoes. Swipe in from the left edge to open page thumbnails.
- Page thumbnail sidebar with the current page number; tap a page to jump to it. A note reopens at the page you were reading.
- Split view: open two notes side by side. Drag the divider to resize, double-tap it for 50/50, or drag it to an edge to close that side.
  - Fingers scroll and pinch-zoom by default. Turn off "Apple Pencil로만 쓰기" to draw with a finger.
- PDF import and annotation, plus lined, grid and blank pages
- The **+** button in a note adds photos, PDF pages (inserted after the current page, so you can write on them) or any file as an attachment card. Tap a card to open or share it. Use the select tool (arrow) to move or resize attachments, or to delete them.
- Audio recording with start, pause and stop controls in a bar at the top. Recordings can be deleted from the player bar. Audio is linked to ink: strokes written while recording remember the recording time. With the player open, tap any stroke to hear what was said when it was written. "리플레이" shows strokes that come later in the recording greyed out.
- Notability `.note` import: handwriting, PDFs, recordings and the ink-to-audio sync (see `../notability/FORMAT.md`)
- PDF export via the iPad share sheet
- Dark mode: light by default; it can be set to dark or to follow the iPad appearance. Paper and ink adapt, and PDFs can optionally be darkened too. Exported PDFs always stay light.
- Folders: create nested folders, give them colours, move notes by menu or by long-pressing a note and dropping it on a folder. Select several notes to move them or group them into a new folder. Search across all notes. The browser/back gesture walks back through folders and out of notes.
- Works offline: everything is stored locally in IndexedDB
- Large scanned PDFs (hundreds of pages): only the few pages on screen keep their decoded images in memory, and thumbnails and off-screen pages render only once writing has paused for 1.5s, so writing is never interrupted by PDF rendering.

## Install on iPad

1. Open the GitHub Pages URL in Safari.
2. Tap Share, then **Add to Home Screen**.

## Run locally

```
cd app && python3 -m http.server 8000
```

Then open http://localhost:8000. The service worker is only registered over https.
