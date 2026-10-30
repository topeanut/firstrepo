package com.paper.office.doc

import android.content.Context
import android.net.Uri
import java.util.zip.ZipInputStream

/**
 * 외부 의존성 없이 OOXML(.docx/.xlsx) 의 내용을 가볍게 추출한다.
 * OOXML 은 XML 들을 담은 ZIP 이므로, 필요한 파트만 읽어 텍스트/표로 변환한다.
 * (서식 완전 재현이 아닌 '읽기용' 추출 — 고급 렌더링은 로드맵)
 */
object OfficeReaders {

    // ---- 공통 ----
    private fun readZipEntries(context: Context, uri: Uri, wanted: (String) -> Boolean): Map<String, String> {
        val out = HashMap<String, String>()
        context.contentResolver.openInputStream(uri)?.use { input ->
            ZipInputStream(input).use { zis ->
                var e = zis.nextEntry
                while (e != null) {
                    if (!e.isDirectory && wanted(e.name)) {
                        out[e.name] = zis.readBytes().toString(Charsets.UTF_8)
                    }
                    zis.closeEntry()
                    e = zis.nextEntry
                }
            }
        }
        return out
    }

    private fun unescape(s: String): String = s
        .replace("&lt;", "<").replace("&gt;", ">")
        .replace("&quot;", "\"").replace("&apos;", "'")
        .replace("&amp;", "&")

    private val T_TAG = Regex("<(?:w:)?t(?:\\s[^>]*)?>(.*?)</(?:w:)?t>", RegexOption.DOT_MATCHES_ALL)
    private val A_T_TAG = Regex("<a:t>(.*?)</a:t>", RegexOption.DOT_MATCHES_ALL)

    // ---- DOCX → 문단 텍스트 ----
    fun readDocxText(context: Context, uri: Uri): String {
        val parts = readZipEntries(context, uri) { it == "word/document.xml" }
        val xml = parts["word/document.xml"] ?: return ""
        val sb = StringBuilder()
        // 문단 단위로 분해 후 각 문단의 <w:t> 들을 이어 붙인다.
        for (para in xml.split(Regex("</w:p>"))) {
            val line = StringBuilder()
            for (m in T_TAG.findAll(para)) line.append(unescape(m.groupValues[1]))
            sb.append(line.toString().trimEnd()).append('\n')
        }
        return sb.toString().trim('\n')
    }

    // ---- PPTX → 슬라이드별 텍스트 ----
    fun readPptxText(context: Context, uri: Uri): String {
        val parts = readZipEntries(context, uri) {
            it.startsWith("ppt/slides/slide") && it.endsWith(".xml")
        }
        if (parts.isEmpty()) return ""
        val sorted = parts.keys.sortedBy { slideNum(it) }
        val sb = StringBuilder()
        sorted.forEachIndexed { i, name ->
            val xml = parts[name] ?: return@forEachIndexed
            val texts = A_T_TAG.findAll(xml).map { unescape(it.groupValues[1]) }.filter { it.isNotBlank() }.toList()
            sb.append("— 슬라이드 ${i + 1} —\n")
            if (texts.isNotEmpty()) sb.append(texts.joinToString("\n"))
            sb.append("\n\n")
        }
        return sb.toString().trim()
    }

    private fun slideNum(name: String): Int =
        Regex("slide(\\d+)\\.xml").find(name)?.groupValues?.get(1)?.toIntOrNull() ?: 0

    // ---- XLSX → 첫 시트의 행/열 ----
    data class Sheet(val name: String, val rows: List<List<String>>)

    fun readXlsxFirstSheet(context: Context, uri: Uri): Sheet {
        val parts = readZipEntries(context, uri) {
            it == "xl/sharedStrings.xml" || it == "xl/workbook.xml" ||
                (it.startsWith("xl/worksheets/") && it.endsWith(".xml"))
        }
        val shared = parseSharedStrings(parts["xl/sharedStrings.xml"])
        val sheetXml = parts.entries
            .filter { it.key.startsWith("xl/worksheets/") }
            .minByOrNull { it.key }?.value ?: return Sheet("Sheet1", emptyList())
        val rows = parseSheet(sheetXml, shared)
        return Sheet("Sheet1", rows)
    }

    private fun parseSharedStrings(xml: String?): List<String> {
        if (xml == null) return emptyList()
        val list = ArrayList<String>()
        for (si in Regex("<si>(.*?)</si>", RegexOption.DOT_MATCHES_ALL).findAll(xml)) {
            val b = StringBuilder()
            for (t in T_TAG.findAll(si.groupValues[1])) b.append(unescape(t.groupValues[1]))
            list.add(b.toString())
        }
        return list
    }

    private fun parseSheet(xml: String, shared: List<String>): List<List<String>> {
        val rows = ArrayList<List<String>>()
        var maxCols = 0
        for (rowM in Regex("<row[^>]*>(.*?)</row>", RegexOption.DOT_MATCHES_ALL).findAll(xml)) {
            val cells = HashMap<Int, String>()
            for (cM in Regex("<c\\b([^>]*)>(.*?)</c>", RegexOption.DOT_MATCHES_ALL).findAll(rowM.groupValues[1])) {
                val attrs = cM.groupValues[1]
                val inner = cM.groupValues[2]
                val ref = Regex("r=\"([A-Z]+)\\d+\"").find(attrs)?.groupValues?.get(1)
                val col = ref?.let { colIndex(it) } ?: cells.size
                val type = Regex("t=\"([^\"]+)\"").find(attrs)?.groupValues?.get(1)
                val raw = Regex("<v>(.*?)</v>", RegexOption.DOT_MATCHES_ALL).find(inner)?.groupValues?.get(1)
                val value = when (type) {
                    "s" -> raw?.toIntOrNull()?.let { shared.getOrNull(it) } ?: ""
                    "inlineStr" -> T_TAG.find(inner)?.groupValues?.get(1)?.let { unescape(it) } ?: ""
                    else -> raw?.let { unescape(it) } ?: ""
                }
                cells[col] = value
                if (col + 1 > maxCols) maxCols = col + 1
            }
            val max = (cells.keys.maxOrNull() ?: -1) + 1
            rows.add((0 until max).map { cells[it] ?: "" })
        }
        // 열 개수 정렬
        return rows.map { r -> if (r.size < maxCols) r + List(maxCols - r.size) { "" } else r }
    }

    private fun colIndex(letters: String): Int {
        var n = 0
        for (ch in letters) n = n * 26 + (ch - 'A' + 1)
        return n - 1
    }
}
