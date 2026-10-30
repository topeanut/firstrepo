# Notability `.note` file format (notes)

These notes come from analyzing one of my own exported notes. It was made with Notability 14.10.4 (`sessionFormatVersion` 9) and contains a PDF of lecture slides, handwriting and 3 recordings. `note_parser.py` implements everything below.

## Container

A `.note` file is a plain ZIP archive (stored, not compressed) with a single top-level folder:

```
<Name>/
  Session.plist                 # the whole document (keyed archive, see below)
  metadata.plist                # NSKeyedArchiver SessionInfo: name, subject, dates, uuid, hasRecording
  thumb12x.png                  # library thumbnail
  PDFs/<UUID>.pdf               # imported PDF(s), stored unmodified
  NBPDFIndex/                   # PDF text-search index + page-number map
  HandwritingIndex/index.plist  # handwriting recognition / search index
  Recordings/library.plist      # plain plist: id -> {filepath, duration, createddate, ...}
  Recordings/Recording N.m4a    # AAC audio
  Images/, Assets/              # inserted media
```

## Session.plist

This is a binary plist in NSKeyedArchiver layout (`$objects`, `$top`, `UID` references). The archiver name is `GLKeyedArchiver`. Root object is `NoteTakingSession`:

| key | contents |
|---|---|
| `richText` → `FormattedString` | the page content: `Handwriting Overlay`, `pdfFiles`, `pageLayoutArray`, `mediaObjects`, typed text |
| `NBNoteTakingSessionDocumentPaperLayoutModelKey` | paper attributes, e.g. `paperSizingBehavior = "lockedWidth:716.8:iPad"` |
| `contentPlaybackEventManager` → `NBCPEventManager` | audio ↔ ink sync |
| `NBNoteTakingSessionHandwritingLanguageKey` | e.g. `ko_KR` |

### Ink: `HandwritingObject.SpatialHash` (`InkedSpatialHash`)

The ink is stored as a struct of arrays of little-endian raw buffers, with `numcurves` = N and `numpoints` = P:

| key | type | count |
|---|---|---|
| `curvesnumpoints` | uint32 | N (points per curve) |
| `curvespoints` | float32 x,y | P (all curves concatenated) |
| `curvesforces` | float32 | P (pressure) |
| `curvesaltitudeangles` | float32 | P (pencil altitude) |
| `curvesazimuthunitvector` | float32 x,y | P |
| `curvesfractionalwidths` | float32 | per point width multipliers |
| `curvescolors` | uint8 RGBA | N |
| `curveswidth` | float32 | N |
| `curvesstyles` | uint8 | N (3 = pen observed) |
| `curveUUIDs` | 16-byte UUID | N |

Coordinates are in paper units, and the pages are stacked vertically. The paper width comes from `paperSizingBehavior` (716.8), and each page is `width × 0.75` tall (537.6) for this 4:3 PDF. The imported PDF page sits slightly inset inside each paper page. The inset was fitted against Notability's own PDF export (`PDF_RECT_*` in the parser).

### Audio sync: `NBCPEventManager`

The audio sync data is also a struct of arrays, with `NBCPTimeManagerSOANumEventsKey` = E:

| key | type |
|---|---|
| `...EventUUIDsKey` | 16-byte UUID × E (matches `curveUUIDs`) |
| `...RecordingIDsKey` | uint32 × E (key into `Recordings/library.plist`) |
| `...TimestampsKey` | float32 seconds into that recording |
| `...DurationsKey` | float32 seconds |

To play back what was being said when a stroke was drawn, look up the stroke's UUID in this table and seek that recording to `timestamp`.
