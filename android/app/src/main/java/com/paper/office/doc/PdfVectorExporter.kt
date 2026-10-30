package com.paper.office.doc

import android.content.Context
import android.net.Uri
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.graphics.image.LosslessFactory

/**
 * 원본 PDF 의 텍스트/벡터를 보존하면서 편집(회전·삭제·주석)을 반영해 저장한다.
 * - 페이지 삭제: 해당 페이지를 가져오지 않음
 * - 페이지 회전: PDPage.setRotation (무손실)
 * - 주석: 투명 래스터 레이어로만 올림(지우개가 주석에만 작동, 페이지 내용은 그대로)
 * 실패 시 false 를 반환해 호출부가 래스터 방식으로 대체하도록 한다.
 */
object PdfVectorExporter {

    private const val ANNO_SCALE = 2

    fun export(context: Context, srcUri: Uri, model: PdfEditModel, outUri: Uri): Boolean {
        return try {
            PDFBoxResourceLoader.init(context.applicationContext)
            val input = context.contentResolver.openInputStream(srcUri) ?: return false
            input.use { ins ->
                PDDocument.load(ins).use { src ->
                    PDDocument().use { out ->
                        for (pe in model.pages) {
                            if (pe.deleted) continue
                            val srcPage = src.getPage(pe.src)
                            val page = out.importPage(srcPage)

                            // 회전(기존 회전 + 사용자 회전, 시계방향)
                            if (pe.rotation % 360 != 0) {
                                page.rotation = (page.rotation + pe.rotation) % 360
                            }

                            // 주석 오버레이
                            if (pe.strokes.isNotEmpty()) {
                                val box = page.mediaBox
                                val wPts = box.width
                                val hPts = box.height
                                val bw = (wPts * ANNO_SCALE).toInt().coerceAtLeast(1)
                                val bh = (hPts * ANNO_SCALE).toInt().coerceAtLeast(1)
                                val annBmp = PdfExporter.annotationBitmap(pe.strokes, bw, bh)
                                val ximg = LosslessFactory.createFromImage(out, annBmp)
                                PDPageContentStream(
                                    out, page, PDPageContentStream.AppendMode.APPEND, true, true
                                ).use { cs ->
                                    cs.drawImage(ximg, 0f, 0f, wPts, hPts)
                                }
                                annBmp.recycle()
                            }
                        }
                        context.contentResolver.openOutputStream(outUri, "wt")?.use { out.save(it) }
                            ?: return false
                    }
                }
            }
            true
        } catch (e: Throwable) {
            e.printStackTrace()
            false
        }
    }
}
