package com.paper.office.doc

import android.content.Context
import android.net.Uri

object TextIO {
    fun read(context: Context, uri: Uri): String =
        context.contentResolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""

    /** 기존 uri 에 덮어쓴다. 성공하면 true. */
    fun write(context: Context, uri: Uri, text: String): Boolean = try {
        // "wt" = write + truncate
        context.contentResolver.openOutputStream(uri, "wt")?.use { it.write(text.toByteArray(Charsets.UTF_8)) }
        true
    } catch (e: Exception) {
        false
    }
}
