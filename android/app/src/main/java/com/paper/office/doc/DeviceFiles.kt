package com.paper.office.doc

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract

/**
 * 사용자가 SAF 로 연결한 폴더(예: 다운로드)의 문서들을 조회한다.
 * '모든 파일 접근' 같은 광범위한 권한 없이, 사용자가 허용한 폴더만 본다.
 */
object DeviceFiles {

    data class Entry(
        val uri: Uri,
        val name: String,
        val kind: DocKind,
        val lastModified: Long,
        val size: Long,
    )

    /** 트리 폴더의 표시 이름(예: "Download"). */
    fun treeName(context: Context, treeUri: Uri): String {
        return try {
            val docUri = DocumentsContract.buildDocumentUriUsingTree(
                treeUri, DocumentsContract.getTreeDocumentId(treeUri)
            )
            context.contentResolver.query(
                docUri, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null
            )?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
                ?: treeUri.lastPathSegment?.substringAfterLast('/') ?: "폴더"
        } catch (_: Exception) {
            "폴더"
        }
    }

    /** 폴더 내 지원 문서 목록(최신순). 하위 폴더는 v1 에서 제외. */
    fun list(context: Context, treeUri: Uri): List<Entry> {
        val out = ArrayList<Entry>()
        val childrenUri = try {
            DocumentsContract.buildChildDocumentsUriUsingTree(
                treeUri, DocumentsContract.getTreeDocumentId(treeUri)
            )
        } catch (_: Exception) {
            return out
        }
        val proj = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED,
            DocumentsContract.Document.COLUMN_SIZE,
        )
        try {
            context.contentResolver.query(childrenUri, proj, null, null, null)?.use { c ->
                while (c.moveToNext()) {
                    val id = c.getString(0) ?: continue
                    val name = c.getString(1) ?: continue
                    val mime = if (!c.isNull(2)) c.getString(2) else null
                    if (mime == DocumentsContract.Document.MIME_TYPE_DIR) continue
                    val kind = DocTypes.kindOf(name, mime)
                    if (kind == DocKind.UNKNOWN) continue
                    val lm = if (!c.isNull(3)) c.getLong(3) else 0L
                    val size = if (!c.isNull(4)) c.getLong(4) else 0L
                    val docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, id)
                    out.add(Entry(docUri, name, kind, lm, size))
                }
            }
        } catch (_: Exception) {
        }
        out.sortByDescending { it.lastModified }
        return out
    }
}
