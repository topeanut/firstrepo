package com.paper.office.doc

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns

/** 지원 문서 종류. */
enum class DocKind(val label: String, val editable: Boolean) {
    PDF("PDF", false),
    TEXT("텍스트", true),
    CSV("CSV", true),
    MARKDOWN("Markdown", true),
    DOCX("워드", false),
    XLSX("엑셀", false),
    PPTX("프레젠테이션", false),
    HWP("한글", false),
    IMAGE("이미지", false),
    UNKNOWN("알 수 없음", false),
}

data class DocRef(
    val uri: Uri,
    val name: String,
    val kind: DocKind,
)

object DocTypes {

    fun displayName(context: Context, uri: Uri): String {
        var name: String? = null
        try {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (idx >= 0) name = c.getString(idx)
                }
            }
        } catch (_: Exception) {
        }
        if (name.isNullOrBlank()) {
            name = uri.lastPathSegment?.substringAfterLast('/')
        }
        return name ?: "문서"
    }

    fun detect(context: Context, uri: Uri, name: String): DocKind {
        val ext = name.substringAfterLast('.', "").lowercase()
        byExtension(ext)?.let { return it }
        // 확장자가 없으면 MIME 으로 추정
        val mime = try { context.contentResolver.getType(uri) } catch (_: Exception) { null } ?: ""
        return byMime(mime)
    }

    private fun byExtension(ext: String): DocKind? = when (ext) {
        "pdf" -> DocKind.PDF
        "txt", "log", "json", "xml", "kt", "java", "js", "ts", "html", "css", "yml", "yaml" -> DocKind.TEXT
        "md", "markdown" -> DocKind.MARKDOWN
        "csv", "tsv" -> DocKind.CSV
        "docx" -> DocKind.DOCX
        "xlsx" -> DocKind.XLSX
        "pptx" -> DocKind.PPTX
        "hwp", "hwpx" -> DocKind.HWP
        "png", "jpg", "jpeg", "gif", "bmp", "webp" -> DocKind.IMAGE
        else -> null
    }

    private fun byMime(mime: String): DocKind = when {
        mime == "application/pdf" -> DocKind.PDF
        mime.startsWith("image/") -> DocKind.IMAGE
        mime == "text/csv" -> DocKind.CSV
        mime == "text/markdown" -> DocKind.MARKDOWN
        mime.startsWith("text/") -> DocKind.TEXT
        mime.contains("wordprocessingml") -> DocKind.DOCX
        mime.contains("spreadsheetml") -> DocKind.XLSX
        mime.contains("presentationml") -> DocKind.PPTX
        else -> DocKind.UNKNOWN
    }
}
