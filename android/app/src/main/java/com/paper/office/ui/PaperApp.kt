package com.paper.office.ui

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Save
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.paper.office.AppViewModel
import com.paper.office.doc.DeviceFiles
import com.paper.office.doc.DocKind
import com.paper.office.doc.DocRef
import com.paper.office.doc.OfficeReaders
import com.paper.office.doc.PdfRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun PaperApp(
    vm: AppViewModel,
    onOpen: () -> Unit,
    onSaveAs: (String) -> Unit,
    onPickFolder: () -> Unit,
) {
    val current = vm.current
    if (current == null) {
        HomeScreen(vm = vm, onOpen = onOpen, onPickFolder = onPickFolder)
    } else {
        DocumentScreen(vm = vm, ref = current, onOpen = onOpen, onSaveAs = onSaveAs, onBack = { vm.close() })
    }
}

// 유형 필터
private enum class HFilter(val label: String, val kinds: Set<DocKind>?) {
    ALL("전체", null),
    PDF("PDF", setOf(DocKind.PDF)),
    DOC("워드", setOf(DocKind.DOCX)),
    SHEET("엑셀", setOf(DocKind.XLSX)),
    SLIDE("PPT", setOf(DocKind.PPTX)),
    TEXT("텍스트", setOf(DocKind.TEXT, DocKind.CSV, DocKind.MARKDOWN)),
    IMAGE("이미지", setOf(DocKind.IMAGE)),
    HWP("한글", setOf(DocKind.HWP)),
}

private val dateFmt = SimpleDateFormat("yyyy.MM.dd", Locale.getDefault())
private fun fmtDate(ms: Long): String = if (ms <= 0) "" else dateFmt.format(Date(ms))
private fun fmtSize(bytes: Long): String = when {
    bytes <= 0 -> ""
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> "${bytes / 1024} KB"
    else -> String.format(Locale.US, "%.1f MB", bytes / 1024.0 / 1024.0)
}

// ---------------------------------------------------------------------------
//  홈
// ---------------------------------------------------------------------------
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun HomeScreen(
    vm: AppViewModel,
    onOpen: () -> Unit,
    onPickFolder: () -> Unit,
) {
    var filter by remember { mutableStateOf(HFilter.ALL) }
    val files = remember(vm.folderFiles.toList(), filter) {
        vm.folderFiles.filter { filter.kinds == null || it.kind in filter.kinds!! }
    }

    Scaffold(
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = onOpen,
                icon = { Icon(Icons.Filled.FolderOpen, contentDescription = null) },
                text = { Text("파일 열기") },
            )
        }
    ) { pad ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(pad),
            contentPadding = PaddingValues(16.dp, 16.dp, 16.dp, 96.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item {
                Text("Paper Office", style = MaterialTheme.typography.headlineMedium)
                Text(
                    "광고 없는 문서 뷰어 · 에디터 — 모든 처리는 기기 안에서만.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
                )
                Spacer(Modifier.height(8.dp))
            }

            // 폴더 연결 카드
            item { FolderCard(vm.folderUri != null, vm.folderName, onPickFolder) }

            if (vm.folderUri != null) {
                item { FilterRow(filter, onSelect = { filter = it }) }

                when {
                    vm.folderLoading -> item {
                        Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator()
                        }
                    }
                    files.isEmpty() -> item {
                        Text(
                            if (vm.folderFiles.isEmpty()) "이 폴더에는 지원하는 문서가 없어요."
                            else "이 유형의 문서가 없어요.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.55f),
                            modifier = Modifier.padding(vertical = 16.dp),
                        )
                    }
                    else -> items(files, key = { it.uri.toString() }) { entry ->
                        FileRow(
                            name = entry.name,
                            kindLabel = entry.kind.label,
                            meta = listOf(fmtDate(entry.lastModified), fmtSize(entry.size))
                                .filter { it.isNotEmpty() }.joinToString("  ·  "),
                            onClick = { vm.openDeviceFile(entry) },
                        )
                    }
                }
            }

            if (vm.recents.isNotEmpty()) {
                item {
                    Spacer(Modifier.height(8.dp))
                    Text("최근 연 문서", style = MaterialTheme.typography.titleSmall)
                    Spacer(Modifier.height(4.dp))
                }
                items(vm.recents, key = { "r:" + it.uri.toString() }) { ref ->
                    FileRow(
                        name = ref.name,
                        kindLabel = ref.kind.label,
                        meta = ref.kind.label,
                        onClick = { vm.openRef(ref) },
                    )
                }
            }
        }
    }
}

@Composable
private fun FolderCard(connected: Boolean, name: String, onPickFolder: () -> Unit) {
    Surface(
        onClick = onPickFolder,
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.primary.copy(alpha = 0.08f),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(
                if (connected) Icons.Filled.Folder else Icons.Filled.CreateNewFolder,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
            )
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    if (connected) name.ifBlank { "연결된 폴더" } else "다운로드 폴더 연결",
                    style = MaterialTheme.typography.bodyLarge,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    if (connected) "최근 받은 문서를 여기서 바로 열 수 있어요 · 탭하여 변경"
                    else "다운로드 등 폴더를 연결하면 받은 문서가 여기에 표시돼요",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.55f),
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FilterRow(selected: HFilter, onSelect: (HFilter) -> Unit) {
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        HFilter.entries.forEach { f ->
            FilterChip(
                selected = f == selected,
                onClick = { onSelect(f) },
                label = { Text(f.label) },
            )
        }
    }
}

@Composable
private fun FileRow(name: String, kindLabel: String, meta: String, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surface,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(42.dp)
                    .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.12f), RoundedCornerShape(10.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Text(kindLabel.take(2), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge)
                if (meta.isNotEmpty()) {
                    Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f))
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
//  문서 화면 (상단바 + 라우팅)
// ---------------------------------------------------------------------------
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DocumentScreen(
    vm: AppViewModel,
    ref: DocRef,
    onOpen: () -> Unit,
    onSaveAs: (String) -> Unit,
    onBack: () -> Unit,
) {
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var pdfZoom by remember { mutableFloatStateOf(1f) }
    var menuOpen by remember { mutableStateOf(false) }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = { Text(ref.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "뒤로")
                    }
                },
                actions = {
                    when (ref.kind) {
                        DocKind.PDF -> {
                            IconButton(onClick = { pdfZoom = (pdfZoom - 0.25f).coerceAtLeast(0.5f) }) {
                                Icon(Icons.Filled.Remove, contentDescription = "축소")
                            }
                            IconButton(onClick = { pdfZoom = (pdfZoom + 0.25f).coerceAtMost(4f) }) {
                                Icon(Icons.Filled.Add, contentDescription = "확대")
                            }
                        }
                        DocKind.TEXT, DocKind.CSV, DocKind.MARKDOWN -> {
                            IconButton(onClick = {
                                val ok = vm.saveCurrentText()
                                scope.launch { snackbar.showSnackbar(if (ok) "저장되었습니다" else "저장 실패 — '다른 이름으로'를 사용하세요") }
                            }) { Icon(Icons.Filled.Save, contentDescription = "저장") }
                            IconButton(onClick = { menuOpen = true }) {
                                Icon(Icons.Filled.MoreVert, contentDescription = "더보기")
                            }
                            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                                DropdownMenuItem(text = { Text("다른 이름으로 저장") }, onClick = {
                                    menuOpen = false; onSaveAs(ref.name)
                                })
                                DropdownMenuItem(text = { Text("다른 문서 열기") }, onClick = {
                                    menuOpen = false; onOpen()
                                })
                            }
                        }
                        else -> {
                            IconButton(onClick = onOpen) {
                                Icon(Icons.Filled.FolderOpen, contentDescription = "다른 문서 열기")
                            }
                        }
                    }
                },
            )
        },
    ) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            when (ref.kind) {
                DocKind.PDF -> PdfView(ref, pdfZoom)
                DocKind.TEXT, DocKind.CSV, DocKind.MARKDOWN -> TextEditorView(vm, ref)
                DocKind.DOCX -> DocxView(ref)
                DocKind.XLSX -> SheetView(ref)
                DocKind.IMAGE -> ImageView(ref)
                DocKind.PPTX, DocKind.HWP, DocKind.UNKNOWN -> UnsupportedView(ref)
            }
        }
    }
}

// ---------------------------------------------------------------------------
//  PDF 뷰어
// ---------------------------------------------------------------------------
@Composable
private fun PdfView(ref: DocRef, zoom: Float) {
    val context = LocalContext.current
    val repo = remember(ref.uri) { runCatching { PdfRepository(context, ref.uri) }.getOrNull() }

    androidx.compose.runtime.DisposableEffect(repo) {
        onDispose { repo?.close() }
    }

    if (repo == null) {
        CenterMessage("PDF 를 열 수 없습니다.\n파일이 손상되었거나 암호가 설정되어 있을 수 있습니다.")
        return
    }

    androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxSize()) {
        val baseWidthPx = with(LocalDensity.current) { maxWidth.roundToPx() }
        val renderWidth = (baseWidthPx * zoom).toInt().coerceIn(1, 3000)
        val listState = rememberLazyListState()
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
            // 스크롤바가 왼쪽에 뜨므로 좌측 여백을 조금 더 준다
            contentPadding = PaddingValues(start = 18.dp, top = 12.dp, end = 10.dp, bottom = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(repo.pageCount) { index ->
                PdfPage(repo, index, renderWidth)
            }
        }
        LazyLeftScrollbar(listState)
    }
}

@Composable
private fun PdfPage(repo: PdfRepository, index: Int, renderWidth: Int) {
    val aspect = remember(index) { runCatching { repo.aspectRatio(index) }.getOrDefault(1.4f) }
    val bitmap by produceState<android.graphics.Bitmap?>(initialValue = null, index, renderWidth) {
        value = withContext(Dispatchers.IO) { runCatching { repo.render(index, renderWidth) }.getOrNull() }
    }
    Box(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(2.dp)),
        contentAlignment = Alignment.Center,
    ) {
        val bmp = bitmap
        if (bmp != null) {
            Image(
                bitmap = bmp.asImageBitmap(),
                contentDescription = "페이지 ${index + 1}",
                modifier = Modifier.fillMaxWidth(),
                contentScale = ContentScale.FillWidth,
            )
        } else {
            Box(
                Modifier.fillMaxWidth().aspectRatio(1f / aspect),
                contentAlignment = Alignment.Center,
            ) { CircularProgressIndicator() }
        }
    }
}

// ---------------------------------------------------------------------------
//  텍스트 에디터
// ---------------------------------------------------------------------------
@Composable
private fun TextEditorView(vm: AppViewModel, ref: DocRef) {
    LaunchedEffect(ref.uri) { withContext(Dispatchers.IO) { vm.ensureEditorLoaded(ref) } }
    OutlinedTextField(
        value = vm.editorText,
        onValueChange = { vm.editorText = it },
        modifier = Modifier.fillMaxSize().padding(8.dp),
        textStyle = MaterialTheme.typography.bodyMedium.copy(
            fontFamily = if (ref.kind == DocKind.CSV) FontFamily.Monospace else FontFamily.Default,
        ),
    )
}

// ---------------------------------------------------------------------------
//  DOCX (읽기)
// ---------------------------------------------------------------------------
@Composable
private fun DocxView(ref: DocRef) {
    val context = LocalContext.current
    val text by produceState(initialValue = null as String?, ref.uri) {
        value = withContext(Dispatchers.IO) { runCatching { OfficeReaders.readDocxText(context, ref.uri) }.getOrNull() }
    }
    when (val t = text) {
        null -> CenterMessage("문서를 읽는 중…", spinner = true)
        else -> {
            val scroll = rememberScrollState()
            Box(Modifier.fillMaxSize()) {
                SelectionContainer {
                    Text(
                        text = t.ifBlank { "(표시할 텍스트가 없습니다)" },
                        modifier = Modifier
                            .fillMaxSize()
                            .verticalScroll(scroll)
                            .padding(start = 24.dp, top = 20.dp, end = 16.dp, bottom = 20.dp),
                        style = MaterialTheme.typography.bodyLarge,
                    )
                }
                ScrollLeftScrollbar(scroll)
            }
        }
    }
}

// ---------------------------------------------------------------------------
//  XLSX (읽기, 표)
// ---------------------------------------------------------------------------
@Composable
private fun SheetView(ref: DocRef) {
    val context = LocalContext.current
    val sheet by produceState(initialValue = null as OfficeReaders.Sheet?, ref.uri) {
        value = withContext(Dispatchers.IO) { runCatching { OfficeReaders.readXlsxFirstSheet(context, ref.uri) }.getOrNull() }
    }
    when (val s = sheet) {
        null -> CenterMessage("시트를 읽는 중…", spinner = true)
        else -> {
            if (s.rows.isEmpty()) {
                CenterMessage("표시할 셀이 없습니다.")
            } else {
                val hScroll = rememberScrollState()
                LazyColumn(Modifier.fillMaxSize().padding(8.dp)) {
                    items(s.rows) { row ->
                        Row(Modifier.horizontalScroll(hScroll)) {
                            row.forEach { cell ->
                                Text(
                                    text = cell,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    style = MaterialTheme.typography.bodySmall,
                                    modifier = Modifier
                                        .width(110.dp)
                                        .border(0.5.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = 0.15f))
                                        .padding(horizontal = 8.dp, vertical = 6.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
//  이미지
// ---------------------------------------------------------------------------
@Composable
private fun ImageView(ref: DocRef) {
    val context = LocalContext.current
    val bmp by produceState(initialValue = null as android.graphics.Bitmap?, ref.uri) {
        value = withContext(Dispatchers.IO) {
            runCatching {
                context.contentResolver.openInputStream(ref.uri)?.use { BitmapFactory.decodeStream(it) }
            }.getOrNull()
        }
    }
    val b = bmp
    if (b == null) {
        CenterMessage("이미지를 여는 중…", spinner = true)
    } else {
        Box(
            Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
            contentAlignment = Alignment.Center,
        ) {
            Image(
                bitmap = b.asImageBitmap(),
                contentDescription = ref.name,
                modifier = Modifier.fillMaxSize().padding(8.dp),
                contentScale = ContentScale.Fit,
            )
        }
    }
}

// ---------------------------------------------------------------------------
//  미지원 / 공통
// ---------------------------------------------------------------------------
@Composable
private fun UnsupportedView(ref: DocRef) {
    val msg = when (ref.kind) {
        DocKind.PPTX -> "프레젠테이션(PPTX) 보기는 준비 중입니다."
        DocKind.HWP -> "한글(HWP/HWPX) 보기는 준비 중입니다."
        else -> "이 형식(${ref.name})은 아직 지원하지 않습니다."
    }
    CenterMessage("$msg\n\n곧 추가될 예정이에요.")
}

// ---------------------------------------------------------------------------
//  왼쪽 스크롤바 (오른손 조작 편의)
// ---------------------------------------------------------------------------
@Composable
private fun BoxScope.VerticalLeftScrollbar(progress: Float, thumbFraction: Float) {
    androidx.compose.foundation.layout.BoxWithConstraints(
        Modifier
            .align(Alignment.CenterStart)
            .fillMaxHeight()
            .padding(vertical = 4.dp)
            .width(6.dp),
    ) {
        val track = maxHeight
        val tf = thumbFraction.coerceIn(0.07f, 1f)
        val thumbH = track * tf
        val y = (track - thumbH) * progress.coerceIn(0f, 1f)
        Box(
            Modifier
                .offset(y = y)
                .width(6.dp)
                .height(thumbH)
                .clip(RoundedCornerShape(3.dp))
                .background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.28f)),
        )
    }
}

@Composable
private fun BoxScope.LazyLeftScrollbar(state: LazyListState) {
    val info = state.layoutInfo
    val total = info.totalItemsCount
    val visible = info.visibleItemsInfo.size
    if (total <= 0 || visible >= total) return
    val progress = state.firstVisibleItemIndex.toFloat() / (total - visible).coerceAtLeast(1)
    val thumbFraction = visible.toFloat() / total
    VerticalLeftScrollbar(progress, thumbFraction)
}

@Composable
private fun BoxScope.ScrollLeftScrollbar(state: ScrollState) {
    if (state.maxValue <= 0) return
    val progress = state.value.toFloat() / state.maxValue
    VerticalLeftScrollbar(progress, thumbFraction = 0.18f)
}

@Composable
private fun CenterMessage(text: String, spinner: Boolean = false) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            if (spinner) {
                CircularProgressIndicator()
                Spacer(Modifier.height(16.dp))
            }
            Text(
                text,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
            )
        }
    }
}
