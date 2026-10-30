package com.paper.office

import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.runtime.toMutableStateList
import androidx.lifecycle.AndroidViewModel
import com.paper.office.doc.DocKind
import com.paper.office.doc.DocRef
import com.paper.office.doc.DocTypes
import com.paper.office.doc.TextIO
import com.paper.office.ui.PaperApp
import com.paper.office.ui.theme.PaperTheme

class MainActivity : ComponentActivity() {

    private val vm: AppViewModel by viewModels()

    private val openDoc =
        registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            uri?.let { persistAndOpen(it) }
        }

    private val createDoc =
        registerForActivityResult(ActivityResultContracts.CreateDocument("text/plain")) { uri ->
            uri?.let { vm.saveTextTo(it) }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        intent?.data?.let { persistAndOpen(it) }
        setContent {
            PaperTheme {
                PaperApp(
                    vm = vm,
                    onOpen = { openDoc.launch(arrayOf("*/*")) },
                    onSaveAs = { suggestedName -> createDoc.launch(suggestedName) },
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.data?.let { persistAndOpen(it) }
    }

    private fun persistAndOpen(uri: Uri) {
        try {
            contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (_: Exception) {
        }
        vm.open(uri)
    }
}

class AppViewModel(app: Application) : AndroidViewModel(app) {

    var current by mutableStateOf<DocRef?>(null)
        private set

    val recents: SnapshotStateList<DocRef> = emptyList<DocRef>().toMutableStateList()

    // 텍스트 편집 상태 (Save As 시 액티비티에서 접근)
    var editorText by mutableStateOf("")
    private var editorLoadedFor: Uri? = null

    init {
        loadRecents()
    }

    fun open(uri: Uri) {
        val ctx = getApplication<Application>()
        val name = DocTypes.displayName(ctx, uri)
        val kind = DocTypes.detect(ctx, uri, name)
        current = DocRef(uri, name, kind)
        editorLoadedFor = null
        addRecent(current!!)
    }

    fun openRef(ref: DocRef) {
        current = ref
        editorLoadedFor = null
    }

    fun close() {
        current = null
    }

    fun ensureEditorLoaded(ref: DocRef) {
        if (editorLoadedFor == ref.uri) return
        editorText = TextIO.read(getApplication(), ref.uri)
        editorLoadedFor = ref.uri
    }

    fun saveCurrentText(): Boolean {
        val r = current ?: return false
        return TextIO.write(getApplication(), r.uri, editorText)
    }

    fun saveTextTo(uri: Uri): Boolean {
        val ctx = getApplication<Application>()
        val ok = TextIO.write(ctx, uri, editorText)
        if (ok) {
            val name = DocTypes.displayName(ctx, uri)
            current = DocRef(uri, name, DocTypes.detect(ctx, uri, name))
            editorLoadedFor = uri
            addRecent(current!!)
        }
        return ok
    }

    private fun prefs() =
        getApplication<Application>().getSharedPreferences("paper", Context.MODE_PRIVATE)

    private fun loadRecents() {
        recents.clear()
        val raw = prefs().getString("recents", "") ?: ""
        raw.split("\n").filter { it.isNotBlank() }.forEach { line ->
            val parts = line.split("|||")
            if (parts.size >= 2) {
                val uri = Uri.parse(parts[0])
                val name = parts[1]
                val kind = try { DocKind.valueOf(parts.getOrElse(2) { DocKind.UNKNOWN.name }) } catch (_: Exception) { DocKind.UNKNOWN }
                recents.add(DocRef(uri, name, kind))
            }
        }
    }

    private fun addRecent(ref: DocRef) {
        recents.removeAll { it.uri == ref.uri }
        recents.add(0, ref)
        while (recents.size > 12) recents.removeAt(recents.size - 1)
        val encoded = recents.joinToString("\n") { "${it.uri}|||${it.name}|||${it.kind.name}" }
        prefs().edit().putString("recents", encoded).apply()
    }
}
