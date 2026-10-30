package com.paper.office.doc

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.runtime.toMutableStateList
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.ui.geometry.Offset

enum class PdfTool { PAN, PEN, HIGHLIGHTER, ERASER }

/** 한 획. points 는 페이지 기준 정규화 좌표(0..1), width 는 페이지 폭 대비 비율. */
class PdfStroke(val tool: PdfTool, val color: Int, val width: Float) {
    val points: MutableList<Offset> = ArrayList()
}

class PdfPageEdit(val src: Int) {
    var deleted by mutableStateOf(false)
    var rotation by mutableIntStateOf(0) // 0 / 90 / 180 / 270 (시계방향)
    val strokes: SnapshotStateList<PdfStroke> = mutableStateListOf()
}

/** PDF 편집 상태(주석 + 페이지 삭제). ViewModel 이 보관하고 저장 시 사용. */
class PdfEditModel(pageCount: Int) {
    val pages: SnapshotStateList<PdfPageEdit> =
        (0 until pageCount).map { PdfPageEdit(it) }.toMutableStateList()

    var tool by mutableStateOf(PdfTool.PAN)
    var color by mutableIntStateOf(0xFFE5484D.toInt())
    var widthPx by mutableFloatStateOf(5f)
    var dirty by mutableStateOf(false)
    var lastEdited: PdfPageEdit? = null

    val activeCount: Int get() = pages.count { !it.deleted }
    val canUndo: Boolean get() = lastEdited?.strokes?.isNotEmpty() == true

    fun deletePage(p: PdfPageEdit) {
        if (activeCount > 1) { p.deleted = true; dirty = true }
    }

    fun rotatePage(p: PdfPageEdit) {
        p.rotation = (p.rotation + 90) % 360
        dirty = true
    }

    fun undo() {
        val p = lastEdited ?: pages.firstOrNull { !it.deleted } ?: return
        if (p.strokes.isNotEmpty()) { p.strokes.removeAt(p.strokes.size - 1); dirty = true }
    }

    /** 현재 도구/색/굵기로 새 획을 만든다. widthFraction = 화면 획 두께 / 캔버스 폭. */
    fun newStroke(canvasWidthPx: Float): PdfStroke {
        val base = (widthPx / canvasWidthPx.coerceAtLeast(1f))
        val frac = when (tool) {
            PdfTool.HIGHLIGHTER -> base * 3.5f
            PdfTool.ERASER -> base * 2.6f + 0.004f
            else -> base
        }
        return PdfStroke(tool, color, frac)
    }
}
