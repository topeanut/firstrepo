package com.paper.office.doc

import android.content.Context
import android.net.Uri
import java.util.TreeMap
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/**
 * XLSX 첫 시트의 셀 값을 수정해 새 파일로 저장한다.
 * 다른 파트(스타일/다른 시트 등)는 그대로 복사하고, 편집한 셀만 교체/삽입한다.
 * (수식은 값으로 대체됨. 서식 index(s) 는 보존)
 */
object XlsxWriter {

    /** edits: (rowIndex0, colIndex0) -> 새 값 */
    fun save(context: Context, srcUri: Uri, outUri: Uri, edits: Map<Pair<Int, Int>, String>): Boolean {
        return try {
            val entries = LinkedHashMap<String, ByteArray>()
            context.contentResolver.openInputStream(srcUri)?.use { ins ->
                ZipInputStream(ins).use { zis ->
                    var e = zis.nextEntry
                    while (e != null) {
                        if (!e.isDirectory) entries[e.name] = zis.readBytes()
                        zis.closeEntry(); e = zis.nextEntry
                    }
                }
            } ?: return false

            val sheetName = entries.keys
                .filter { it.startsWith("xl/worksheets/") && it.endsWith(".xml") }
                .minOrNull() ?: return false

            var xml = String(entries[sheetName]!!, Charsets.UTF_8)
            xml = applyEdits(xml, edits)
            entries[sheetName] = xml.toByteArray(Charsets.UTF_8)

            context.contentResolver.openOutputStream(outUri, "wt")?.use { os ->
                ZipOutputStream(os).use { zos ->
                    for ((name, bytes) in entries) {
                        zos.putNextEntry(ZipEntry(name)); zos.write(bytes); zos.closeEntry()
                    }
                }
            } ?: return false
            true
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    private val ROW_RE = Regex("<row\\b[^>]*>.*?</row>|<row\\b[^>]*/>", RegexOption.DOT_MATCHES_ALL)
    private val CELL_RE = Regex("<c\\b[^>]*>.*?</c>|<c\\b[^>]*/>", RegexOption.DOT_MATCHES_ALL)
    private val NUM_RE = Regex("^-?\\d+(\\.\\d+)?$")

    private fun applyEdits(xmlIn: String, edits: Map<Pair<Int, Int>, String>): String {
        var xml = xmlIn
        // dimension 은 제거(셀 추가 시 Excel 이 다시 계산하도록)
        xml = Regex("<dimension\\b[^>]*/>").replace(xml, "")

        // sheetData 블록 확보
        var sdOpen = Regex("<sheetData\\b[^>]*>").find(xml)
        if (sdOpen == null) {
            val self = Regex("<sheetData\\s*/>").find(xml) ?: return xml
            xml = xml.replaceRange(self.range, "<sheetData></sheetData>")
            sdOpen = Regex("<sheetData\\b[^>]*>").find(xml)!!
        }
        val closeIdx = xml.indexOf("</sheetData>", sdOpen.range.last)
        if (closeIdx < 0) return xml
        val openTag = sdOpen.value
        val inner = xml.substring(sdOpen.range.last + 1, closeIdx)

        // 행 파싱
        val rows = TreeMap<Int, String>()
        for (m in ROW_RE.findAll(inner)) {
            val n = Regex("\\br=\"(\\d+)\"").find(m.value)?.groupValues?.get(1)?.toIntOrNull() ?: continue
            rows[n] = m.value
        }

        // 편집을 행 단위로 묶어 적용
        edits.entries.groupBy { it.key.first }.forEach { (r0, cellEntries) ->
            val rowNum = r0 + 1
            val cellEdits = cellEntries.associate { it.key.second to it.value }
            rows[rowNum] = editRow(rows[rowNum], rowNum, cellEdits)
        }

        val newInner = rows.values.joinToString("")
        return xml.substring(0, sdOpen.range.last + 1) + newInner + xml.substring(closeIdx)
    }

    private fun editRow(rowXmlIn: String?, rowNum: Int, cellEdits: Map<Int, String>): String {
        val cells = TreeMap<Int, String>()
        if (rowXmlIn != null) {
            val innerStart = rowXmlIn.indexOf('>') + 1
            val innerEnd = rowXmlIn.lastIndexOf("</row>")
            if (innerStart in 1..(if (innerEnd < 0) rowXmlIn.length else innerEnd)) {
                val inner = if (innerEnd >= 0) rowXmlIn.substring(innerStart, innerEnd) else ""
                for (m in CELL_RE.findAll(inner)) {
                    val col = Regex("r=\"([A-Z]+)\\d+\"").find(m.value)?.groupValues?.get(1)?.let { colIndex(it) } ?: continue
                    cells[col] = m.value
                }
            }
        }
        for ((col, value) in cellEdits) {
            val ref = colLetter(col) + rowNum
            val sAttr = cells[col]?.let { Regex("\\bs=\"\\d+\"").find(it)?.value?.let { s -> " $s" } } ?: ""
            cells[col] = buildCell(ref, sAttr, value)
        }
        return "<row r=\"$rowNum\">" + cells.values.joinToString("") + "</row>"
    }

    private fun buildCell(ref: String, sAttr: String, value: String): String =
        if (value.isNotEmpty() && NUM_RE.matches(value)) {
            "<c r=\"$ref\"$sAttr><v>$value</v></c>"
        } else {
            "<c r=\"$ref\"$sAttr t=\"inlineStr\"><is><t xml:space=\"preserve\">${escape(value)}</t></is></c>"
        }

    private fun escape(s: String): String = s
        .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    private fun colIndex(letters: String): Int {
        var n = 0
        for (ch in letters) n = n * 26 + (ch - 'A' + 1)
        return n - 1
    }

    private fun colLetter(index: Int): String {
        var i = index + 1
        val sb = StringBuilder()
        while (i > 0) {
            val rem = (i - 1) % 26
            sb.insert(0, ('A' + rem))
            i = (i - 1) / 26
        }
        return sb.toString()
    }
}
