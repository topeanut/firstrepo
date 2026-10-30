package com.paper.office.doc

import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import androidx.core.content.ContextCompat
import java.io.File
import java.util.ArrayDeque

/**
 * '모든 파일 접근' 권한으로 기기 전체(공유 저장소)의 문서를 직접 스캔한다.
 * SAF 폴더 연결 없이 Download/Documents 등 모든 곳의 문서를 한 번에 본다.
 */
object DeviceScanner {

    fun hasAccess(context: Context): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Environment.isExternalStorageManager()
        } else {
            ContextCompat.checkSelfPermission(
                context, android.Manifest.permission.READ_EXTERNAL_STORAGE
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        }

    /** 공유 저장소를 재귀 스캔해 지원 문서를 최신순으로 반환. (Android/ 과 숨김 폴더 제외) */
    fun scan(maxResults: Int = 2000): List<DeviceFiles.Entry> {
        val root = Environment.getExternalStorageDirectory() ?: return emptyList()
        val out = ArrayList<DeviceFiles.Entry>()
        val stack = ArrayDeque<File>()
        stack.add(root)
        var visited = 0
        while (stack.isNotEmpty() && visited < 400_000) {
            val dir = stack.removeLast()
            val children = dir.listFiles() ?: continue
            for (f in children) {
                visited++
                val name = f.name
                if (name.startsWith(".")) continue
                if (f.isDirectory) {
                    // 앱 샌드박스/대용량 디렉터리는 건너뛴다
                    if (dir.absolutePath == root.absolutePath && name == "Android") continue
                    stack.add(f)
                } else {
                    val kind = DocTypes.kindOf(name, null)
                    if (kind != DocKind.UNKNOWN) {
                        out.add(DeviceFiles.Entry(Uri.fromFile(f), name, kind, f.lastModified(), f.length()))
                    }
                }
            }
        }
        out.sortByDescending { it.lastModified }
        return if (out.size > maxResults) out.subList(0, maxResults).toList() else out
    }
}
