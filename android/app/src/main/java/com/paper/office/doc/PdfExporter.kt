package com.paper.office.doc

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.pdf.PdfDocument
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor

/**
 * 편집(주석 + 페이지 삭제)을 반영한 새 PDF 를 만든다.
 * 각 페이지를 래스터로 렌더한 뒤, 주석을 별도 투명 레이어에 그려 합성한다.
 * (지우개는 이 주석 레이어에서만 지우므로 페이지 내용은 보존된다)
 * 외부 라이브러리 없이 동작하지만 출력은 래스터화된다(텍스트 선택 불가).
 */
object PdfExporter {

    private const val SCALE = 2 // 렌더 해상도 배율

    fun export(context: Context, srcUri: Uri, model: PdfEditModel, outUri: Uri): Boolean {
        var pfd: ParcelFileDescriptor? = null
        var renderer: PdfRenderer? = null
        val doc = PdfDocument()
        try {
            pfd = context.contentResolver.openFileDescriptor(srcUri, "r") ?: return false
            renderer = PdfRenderer(pfd)
            var pageNo = 1
            for (pe in model.pages) {
                if (pe.deleted) continue
                val page = renderer.openPage(pe.src)
                val wPts = page.width
                val hPts = page.height
                val bw = (wPts * SCALE).coerceAtLeast(1)
                val bh = (hPts * SCALE).coerceAtLeast(1)

                // 1) 페이지 래스터(불투명)
                val pageBmp = Bitmap.createBitmap(bw, bh, Bitmap.Config.ARGB_8888)
                pageBmp.eraseColor(Color.WHITE)
                page.render(pageBmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
                page.close()

                // 2) 주석 레이어(투명) — 지우개는 여기서만 작동
                if (pe.strokes.isNotEmpty()) {
                    val annBmp = annotationBitmap(pe.strokes, bw, bh)
                    Canvas(pageBmp).drawBitmap(annBmp, 0f, 0f, null)
                    annBmp.recycle()
                }

                // 2.5) 사용자 회전 반영: 합성 비트맵을 통째로 회전
                var finalBmp = pageBmp
                if (pe.rotation % 360 != 0) {
                    val m = android.graphics.Matrix().apply { postRotate(pe.rotation.toFloat()) }
                    val rotated = Bitmap.createBitmap(pageBmp, 0, 0, pageBmp.width, pageBmp.height, m, true)
                    if (rotated != pageBmp) pageBmp.recycle()
                    finalBmp = rotated
                }

                // 3) PDF 페이지(포인트 단위) 에 합성 비트맵을 채워 그린다. 회전 시 가로/세로가 바뀐다.
                val outWPts = finalBmp.width / SCALE
                val outHPts = finalBmp.height / SCALE
                val info = PdfDocument.PageInfo.Builder(outWPts, outHPts, pageNo).create()
                val pdfPage = doc.startPage(info)
                val dst = android.graphics.Rect(0, 0, outWPts, outHPts)
                pdfPage.canvas.drawBitmap(finalBmp, null, dst, null)
                doc.finishPage(pdfPage)
                finalBmp.recycle()
                pageNo++
            }
            context.contentResolver.openOutputStream(outUri, "wt")?.use { doc.writeTo(it) } ?: return false
            return true
        } catch (e: Exception) {
            e.printStackTrace()
            return false
        } finally {
            doc.close()
            try { renderer?.close() } catch (_: Exception) {}
            try { pfd?.close() } catch (_: Exception) {}
        }
    }

    /** 투명 배경에 주석을 그린 비트맵(지우개는 이 레이어 안에서만 작동). */
    fun annotationBitmap(strokes: List<PdfStroke>, bw: Int, bh: Int): Bitmap {
        val bmp = Bitmap.createBitmap(bw, bh, Bitmap.Config.ARGB_8888)
        drawStrokes(Canvas(bmp), strokes, bw.toFloat(), bh.toFloat())
        return bmp
    }

    private fun drawStrokes(canvas: Canvas, strokes: List<PdfStroke>, w: Float, h: Float) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
        val clear = PorterDuffXfermode(PorterDuff.Mode.CLEAR)
        for (s in strokes) {
            paint.xfermode = if (s.tool == PdfTool.ERASER) clear else null
            paint.strokeWidth = (s.width * w).coerceAtLeast(1f)
            paint.color = s.color
            if (s.tool == PdfTool.HIGHLIGHTER) paint.alpha = 90
            else if (s.tool != PdfTool.ERASER) paint.alpha = Color.alpha(s.color)

            val pts = s.points
            if (pts.isEmpty()) continue
            if (pts.size == 1) {
                val fill = Paint(paint).apply { style = Paint.Style.FILL }
                canvas.drawCircle(pts[0].x * w, pts[0].y * h, (s.width * w) / 2f, fill)
                continue
            }
            val path = Path()
            path.moveTo(pts[0].x * w, pts[0].y * h)
            for (i in 1 until pts.size) path.lineTo(pts[i].x * w, pts[i].y * h)
            canvas.drawPath(path, paint)
        }
    }
}
