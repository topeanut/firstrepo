package com.paper.office.doc

import android.content.Context
import android.net.Uri
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/**
 * DOCX 의 문단 텍스트를 교체해 새 파일로 저장한다.
 * 각 <w:p> 를 제자리에서 교체하며 문단 속성(<w:pPr>)과 첫 런 속성(<w:rPr>)은 보존한다.
 * (문단 내 혼합 서식은 합쳐짐. 표 등 문단 외 요소는 그대로 유지)
 */
object DocxWriter {

    private val P_RE = Regex("<w:p\\b[^>]*>.*?</w:p>|<w:p\\b[^>]*/>", RegexOption.DOT_MATCHES_ALL)
    private val PPR_RE = Regex("<w:pPr>.*?</w:pPr>", RegexOption.DOT_MATCHES_ALL)
    private val RPR_RE = Regex("<w:rPr>.*?</w:rPr>", RegexOption.DOT_MATCHES_ALL)

    fun save(context: Context, srcUri: Uri, outUri: Uri, paragraphs: List<String>): Boolean {
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

            val xml = String(entries["word/document.xml"] ?: return false, Charsets.UTF_8)
            entries["word/document.xml"] = rewrite(xml, paragraphs).toByteArray(Charsets.UTF_8)

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

    private fun rewrite(xml: String, paragraphs: List<String>): String {
        val matches = P_RE.findAll(xml).toList()
        if (matches.isEmpty()) return xml
        val sb = StringBuilder(xml)

        // 추가된 문단은 마지막 문단 뒤에 삽입(이후 교체가 앞쪽 범위만 건드리도록 먼저 수행)
        if (paragraphs.size > matches.size) {
            val insertAt = matches.last().range.last + 1
            val extra = (matches.size until paragraphs.size).joinToString("") { newPara(paragraphs[it]) }
            sb.insert(insertAt, extra)
        }
        // 기존 문단을 뒤에서부터 교체/삭제(인덱스 안정)
        for (i in matches.indices.reversed()) {
            val m = matches[i]
            val replacement = if (i < paragraphs.size) rebuildPara(m.value, paragraphs[i]) else ""
            sb.replace(m.range.first, m.range.last + 1, replacement)
        }
        return sb.toString()
    }

    private fun rebuildPara(original: String, text: String): String {
        val pPr = PPR_RE.find(original)?.value ?: ""
        val rPr = RPR_RE.find(original)?.value ?: ""
        return "<w:p>$pPr<w:r>$rPr<w:t xml:space=\"preserve\">${escape(text)}</w:t></w:r></w:p>"
    }

    private fun newPara(text: String): String =
        "<w:p><w:r><w:t xml:space=\"preserve\">${escape(text)}</w:t></w:r></w:p>"

    private fun escape(s: String): String = s
        .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
}
