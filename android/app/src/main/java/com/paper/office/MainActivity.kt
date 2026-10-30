package com.paper.office

import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.runtime.toMutableStateList
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import android.os.Build
import android.provider.Settings
import com.paper.office.doc.DeviceFiles
import com.paper.office.doc.DeviceScanner
import com.paper.office.doc.DocKind
import com.paper.office.doc.DocRef
import com.paper.office.doc.DocTypes
import com.paper.office.doc.PdfEditModel
import com.paper.office.doc.PdfExporter
import com.paper.office.doc.PdfVectorExporter
import com.paper.office.doc.TextIO
import com.paper.office.ui.PaperApp
import com.paper.office.ui.theme.PaperTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

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

    private val openTree =
        registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
            uri?.let { onFolderPicked(it) }
        }

    private val createPdf =
        registerForActivityResult(ActivityResultContracts.CreateDocument("application/pdf")) { uri ->
            uri?.let { vm.exportPdfTo(it) }
        }

    private val createXlsx =
        registerForActivityResult(ActivityResultContracts.CreateDocument("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) { uri ->
            uri?.let { vm.exportXlsxTo(it) }
        }

    private val createDocx =
        registerForActivityResult(ActivityResultContracts.CreateDocument("application/vnd.openxmlformats-officedocument.wordprocessingml.document")) { uri ->
            uri?.let { vm.exportDocxTo(it) }
        }

    private val reqRead =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { vm.refreshStorage() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        intent?.data?.let { persistAndOpen(it) }
        setContent {
            PaperTheme {
                PaperApp(
                    vm = vm,
                    onOpen = { openDoc.launch(arrayOf("*/*")) },
                    onSaveAs = { suggestedName -> createDoc.launch(suggestedName) },
                    onPickFolder = { openTree.launch(null) },
                    onExportPdf = { suggestedName -> createPdf.launch(suggestedName) },
                    onExportXlsx = { suggestedName -> createXlsx.launch(suggestedName) },
                    onExportDocx = { suggestedName -> createDocx.launch(suggestedName) },
                    onRequestStorage = { requestStorageAccess() },
                )
            }
        }
    }

    override fun onResume() {
        super.onResume()
        vm.refreshStorage()
    }

    private fun requestStorageAccess() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                startActivity(
                    Intent(
                        Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                        Uri.parse("package:$packageName"),
                    )
                )
            } catch (e: Exception) {
                startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
            }
        } else {
            reqRead.launch(android.Manifest.permission.READ_EXTERNAL_STORAGE)
        }
    }

    private fun onFolderPicked(uri: Uri) {
        try {
            contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (_: Exception) {
        }
        vm.setFolder(uri)
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

    // 연결된 폴더(다운로드 등)
    var folderUri by mutableStateOf<Uri?>(null)
        private set
    var folderName by mutableStateOf("")
        private set
    var folderLoading by mutableStateOf(false)
        private set
    val folderFiles: SnapshotStateList<DeviceFiles.Entry> = emptyList<DeviceFiles.Entry>().toMutableStateList()

    // 텍스트 편집 상태 (Save As 시 액티비티에서 접근)
    var editorText by mutableStateOf("")
    private var editorLoadedFor: Uri? = null

    // PDF 편집 상태 + 스낵바 메시지
    var pdfEdit by mutableStateOf<PdfEditModel?>(null)
    var toastMessage by mutableStateOf<String?>(null)

    // 읽기 글자 크기 배율(텍스트/워드/PPT 뷰어)
    var textScale by mutableStateOf(1f)
    fun bumpTextScale(delta: Float) { textScale = (textScale + delta).coerceIn(0.7f, 2.4f) }

    // XLSX 셀 편집: (행, 열) -> 새 값
    val sheetEdits: androidx.compose.runtime.snapshots.SnapshotStateMap<Pair<Int, Int>, String> =
        androidx.compose.runtime.mutableStateMapOf()

    fun setSheetCell(row: Int, col: Int, value: String) {
        sheetEdits[row to col] = value
    }

    fun exportXlsxTo(uri: Uri) {
        val src = current?.uri ?: return
        val edits = HashMap(sheetEdits)
        viewModelScope.launch {
            val ok = withContext(Dispatchers.IO) {
                com.paper.office.doc.XlsxWriter.save(getApplication(), src, uri, edits)
            }
            toastMessage = if (ok) "엑셀 저장 완료" else "저장 중 오류가 발생했어요"
        }
    }

    // DOCX 문단 텍스트 편집
    var docxText by mutableStateOf("")
    private var docxLoadedFor: Uri? = null

    fun ensureDocxLoaded(ref: DocRef) {
        if (docxLoadedFor == ref.uri) return
        docxText = com.paper.office.doc.OfficeReaders.readDocxParagraphs(getApplication(), ref.uri).joinToString("\n")
        docxLoadedFor = ref.uri
    }

    fun exportDocxTo(uri: Uri) {
        val src = current?.uri ?: return
        val paragraphs = docxText.split("\n")
        viewModelScope.launch {
            val ok = withContext(Dispatchers.IO) {
                com.paper.office.doc.DocxWriter.save(getApplication(), src, uri, paragraphs)
            }
            toastMessage = if (ok) "워드 저장 완료" else "저장 중 오류가 발생했어요"
        }
    }

    // 기기 전체 문서 접근
    var hasStorageAccess by mutableStateOf(false)
        private set
    var scanLoading by mutableStateOf(false)
        private set
    val allFiles: SnapshotStateList<DeviceFiles.Entry> = emptyList<DeviceFiles.Entry>().toMutableStateList()

    /** 권한 상태를 갱신하고, 허용됐는데 목록이 비어 있으면 스캔한다. (설정에서 돌아올 때 호출) */
    fun refreshStorage() {
        val granted = DeviceScanner.hasAccess(getApplication())
        hasStorageAccess = granted
        if (granted && allFiles.isEmpty() && !scanLoading) scanDevice()
    }

    fun scanDevice() {
        if (!DeviceScanner.hasAccess(getApplication())) return
        scanLoading = true
        viewModelScope.launch {
            val list = withContext(Dispatchers.IO) { DeviceScanner.scan() }
            allFiles.clear()
            allFiles.addAll(list)
            scanLoading = false
        }
    }

    init {
        loadRecents()
        restoreFolder()
    }

    fun setFolder(uri: Uri) {
        folderUri = uri
        prefs().edit().putString("folder", uri.toString()).apply()
        loadFolder()
    }

    private fun restoreFolder() {
        val saved = prefs().getString("folder", null) ?: return
        val uri = Uri.parse(saved)
        // 권한이 아직 유효한 경우에만 사용
        val ok = getApplication<Application>().contentResolver.persistedUriPermissions.any {
            it.uri == uri && it.isReadPermission
        }
        if (ok) {
            folderUri = uri
            loadFolder()
        }
    }

    fun loadFolder() {
        val uri = folderUri ?: return
        folderLoading = true
        viewModelScope.launch {
            val name = withContext(Dispatchers.IO) { DeviceFiles.treeName(getApplication(), uri) }
            val list = withContext(Dispatchers.IO) { DeviceFiles.list(getApplication(), uri) }
            folderName = name
            folderFiles.clear()
            folderFiles.addAll(list)
            folderLoading = false
        }
    }

    fun openDeviceFile(entry: DeviceFiles.Entry) {
        current = DocRef(entry.uri, entry.name, entry.kind)
        editorLoadedFor = null
        pdfEdit = null
        sheetEdits.clear()
        docxLoadedFor = null
        addRecent(current!!)
    }

    fun open(uri: Uri) {
        val ctx = getApplication<Application>()
        val name = DocTypes.displayName(ctx, uri)
        val kind = DocTypes.detect(ctx, uri, name)
        current = DocRef(uri, name, kind)
        editorLoadedFor = null
        pdfEdit = null
        sheetEdits.clear()
        docxLoadedFor = null
        addRecent(current!!)
    }

    fun openRef(ref: DocRef) {
        current = ref
        editorLoadedFor = null
        pdfEdit = null
        sheetEdits.clear()
        docxLoadedFor = null
    }

    fun close() {
        current = null
        pdfEdit = null
        sheetEdits.clear()
        docxLoadedFor = null
    }

    fun exportPdfTo(uri: Uri) {
        val src = current?.uri ?: return
        val model = pdfEdit ?: return
        viewModelScope.launch {
            // 벡터 보존 저장을 먼저 시도하고, 실패하면 래스터 방식으로 대체
            val result = withContext(Dispatchers.IO) {
                if (PdfVectorExporter.export(getApplication(), src, model, uri)) "vector"
                else if (PdfExporter.export(getApplication(), src, model, uri)) "raster"
                else null
            }
            if (result != null) model.dirty = false
            toastMessage = when (result) {
                "vector" -> "PDF 저장 완료"
                "raster" -> "PDF 저장 완료(래스터)"
                else -> "저장 중 오류가 발생했어요"
            }
        }
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
