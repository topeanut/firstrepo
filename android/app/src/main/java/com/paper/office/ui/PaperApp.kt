package com.paper.office.ui

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Save
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.paper.office.AppViewModel
import com.paper.office.doc.DocKind
import com.paper.office.doc.DocRef
import com.paper.office.doc.OfficeReaders
import com.paper.office.doc.PdfRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun PaperApp(
    vm: AppViewModel,
    onOpen: () -> Unit,
    onSaveAs: (String) -> Unit,
) {
    val current = vm.current
    if (current == null) {
        HomeScreen(recents = vm.recents, onOpen = onOpen, onOpenRecent = { vm.openRef(it) })
    } else {
        DocumentScreen(vm = vm, ref = current, onOpen = onOpen, onSaveAs = onSaveAs, onBack = { vm.close() })
    }
}

// ---------------------------------------------------------------------------
//  홈
// ---------------------------------------------------------------------------
@Composable
private fun HomeScreen(
    recents: List<DocRef>,
    onOpen: () -> Unit,
    onOpenRecent: (DocRef) -> Unit,
) {
    Scaffold(
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = onOpen,
                icon = { Icon(Icons.Filled.FolderOpen, contentDescription = null) },
                text = { Text("열기") },
            )
        }
    ) { pad ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(pad)
                .padding(20.dp)
        ) {
            Text("Paper Office", style = MaterialTheme.typography.headlineMedium)
            Spacer(Modifier.height(4.dp))
            Text(
                "광고 없는 문서 뷰어 · 에디터 — 모든 처리는 기기 안에서만 이루어집니다.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
            )
            Spacer(Modifier.height(20.dp))

            if (recents.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            Icons.Filled.Description,
                            contentDescription = null,
                            modifier = Modifier.size(64.dp),
                            tint = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.25f),
                        )
                        Spacer(Modifier.height(12.dp))
                        Text(
                            "오른쪽 아래 '열기'로 문서를 선택하세요.\nPDF · 워드 · 엑셀 · 텍스트 · 이미지 지원",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.5f),
                        )
                    }
                }
            } else {
                Text("최근 문서", style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(8.dp))
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(recents) { ref -> RecentRow(ref, onClick = { onOpenRecent(ref) }) }
                }
            }
        }
    }
}

@Composable
private fun RecentRow(ref: DocRef, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surface,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(40.dp)
                    .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.12f), RoundedCornerShape(10.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Text(ref.kind.label.take(2), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(ref.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge)
                Text(ref.kind.label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f))
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
        LazyColumn(
            Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(repo.pageCount) { index ->
                PdfPage(repo, index, renderWidth)
            }
        }
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
                contentScale = ContentScale.FitWidth,
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
        else -> SelectionContainer {
            Text(
                text = t.ifBlank { "(표시할 텍스트가 없습니다)" },
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(20.dp),
                style = MaterialTheme.typography.bodyLarge,
            )
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
