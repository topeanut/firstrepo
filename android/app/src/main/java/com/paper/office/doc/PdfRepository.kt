package com.paper.office.doc

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.Closeable
import java.io.IOException

/**
 * 안드로이드 내장 PdfRenderer 로 PDF 를 렌더링한다.
 * PdfRenderer 는 동시에 한 페이지만 열 수 있으므로 모든 접근을 직렬화한다.
 */
class PdfRepository(context: Context, uri: Uri) : Closeable {

    private val pfd: ParcelFileDescriptor =
        context.contentResolver.openFileDescriptor(uri, "r")
            ?: throw IOException("PDF 를 열 수 없습니다.")

    private val renderer = PdfRenderer(pfd)
    private val lock = Any()
    private var closed = false

    val pageCount: Int get() = renderer.pageCount

    /** 페이지 종횡비(세로/가로). 레이아웃 높이 계산용. */
    fun aspectRatio(index: Int): Float = synchronized(lock) {
        if (closed) return 1.4f
        renderer.openPage(index).use { page ->
            if (page.width <= 0) 1.4f else page.height.toFloat() / page.width.toFloat()
        }
    }

    fun render(index: Int, targetWidthPx: Int): Bitmap? = synchronized(lock) {
        if (closed) return null
        renderer.openPage(index).use { page ->
            val w = targetWidthPx.coerceAtLeast(1)
            val scale = w.toFloat() / page.width.toFloat()
            val h = (page.height * scale).toInt().coerceAtLeast(1)
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            bmp.eraseColor(Color.WHITE)
            page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            bmp
        }
    }

    override fun close() {
        synchronized(lock) {
            if (closed) return
            closed = true
            try { renderer.close() } catch (_: Exception) {}
            try { pfd.close() } catch (_: Exception) {}
        }
    }
}
