package com.paper.office.ui

import android.graphics.BitmapFactory
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
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
import androidx.compose.material.icons.automirrored.filled.TextSnippet
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Photo
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Save
import androidx.compose.material.icons.filled.Slideshow
import androidx.compose.material.icons.filled.TableChart
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
import androidx.compose.material3.Slider
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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.paper.office.AppViewModel
import com.paper.office.doc.DeviceFiles
import com.paper.office.doc.DocKind
import com.paper.office.doc.DocRef
import com.paper.office.doc.OfficeReaders
import com.paper.office.doc.PdfEditModel
import com.paper.office.doc.PdfPageEdit
import com.paper.office.doc.PdfRepository
import com.paper.office.doc.PdfStroke
import com.paper.office.doc.PdfTool
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
    onExportPdf: (String) -> Unit,
    onRequestStorage: () -> Unit,
) {
    val current = vm.current
    if (current == null) {
        HomeScreen(vm = vm, onOpen = onOpen, onRequestStorage = onRequestStorage)
    } else {
        DocumentScreen(
            vm = vm, ref = current, onOpen = onOpen, onSaveAs = onSaveAs,
            onExportPdf = onExportPdf, onBack = { vm.close() },
        )
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

private data class TypeStyle(val icon: ImageVector, val color: Color, val tag: String)

private fun styleFor(kind: DocKind): TypeStyle = when (kind) {
    DocKind.PDF -> TypeStyle(Icons.Filled.PictureAsPdf, Color(0xFFE5484D), "PDF")
    DocKind.DOCX -> TypeStyle(Icons.Filled.Description, Color(0xFF2F6BED), "DOCX")
    DocKind.XLSX -> TypeStyle(Icons.Filled.TableChart, Color(0xFF13A05F), "XLSX")
    DocKind.PPTX -> TypeStyle(Icons.Filled.Slideshow, Color(0xFFE8833A), "PPT")
    DocKind.TEXT -> TypeStyle(Icons.AutoMirrored.Filled.TextSnippet, Color(0xFF7A7F87), "TXT")
    DocKind.CSV -> TypeStyle(Icons.Filled.TableChart, Color(0xFF13A05F), "CSV")
    DocKind.MARKDOWN -> TypeStyle(Icons.AutoMirrored.Filled.TextSnippet, Color(0xFF7A7F87), "MD")
    DocKind.IMAGE -> TypeStyle(Icons.Filled.Photo, Color(0xFF0EA5E9), "IMG")
    DocKind.HWP -> TypeStyle(Icons.Filled.Description, Color(0xFF8B5CF6), "HWP")
    DocKind.UNKNOWN -> TypeStyle(Icons.Filled.InsertDriveFile, Color(0xFF8A9099), "FILE")
}

@Composable
private fun FileIconTile(kind: DocKind, size: Int = 46) {
    val s = styleFor(kind)
    Box(
        Modifier
            .size(size.dp)
            .clip(RoundedCornerShape((size / 3.4f).dp))
            .background(s.color.copy(alpha = 0.14f)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(s.icon, contentDescription = null, tint = s.color, modifier = Modifier.size((size * 0.5f).dp))
    }
}

// ---------------------------------------------------------------------------
//  홈
// ---------------------------------------------------------------------------
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun HomeScreen(
    vm: AppViewModel,
    onOpen: () -> Unit,
    onRequestStorage: () -> Unit,
) {
    var filter by remember { mutableStateOf(HFilter.ALL) }
    val files = remember(vm.allFiles.toList(), filter) {
        vm.allFiles.filter { filter.kinds == null || it.kind in filter.kinds!! }
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
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp, bottom = 2.dp)) {
                    Box(
                        Modifier
                            .size(36.dp)
                            .clip(RoundedCornerShape(11.dp))
                            .background(Brush.linearGradient(listOf(Color(0xFF4F6EF2), Color(0xFF2F4FD0)))),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Filled.Description, contentDescription = null, tint = Color.White, modifier = Modifier.size(20.dp))
                    }
                    Spacer(Modifier.width(10.dp))
                    Text("Paper", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.ExtraBold)
                }
                Text(
                    "광고 없는 문서 뷰어 · 에디터 — 모든 처리는 기기 안에서만",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 2.dp, bottom = 8.dp),
                )
            }

            if (!vm.hasStorageAccess) {
                item { AccessCard(onRequestStorage) }
            } else {
                item {
                    Row(
                        Modifier.fillMaxWidth().padding(top = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("기기 문서", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                        TextButton(onClick = { vm.scanDevice() }, enabled = !vm.scanLoading) { Text("새로고침") }
                    }
                }
                item { FilterRow(filter, onSelect = { filter = it }) }

                when {
                    vm.scanLoading -> item {
                        Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator()
                        }
                    }
                    files.isEmpty() -> item {
                        Text(
                            if (vm.allFiles.isEmpty()) "기기에서 지원하는 문서를 찾지 못했어요."
                            else "이 유형의 문서가 없어요.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.55f),
                            modifier = Modifier.padding(vertical = 16.dp),
                        )
                    }
                    else -> items(files, key = { it.uri.toString() }) { entry ->
                        FileRow(
                            kind = entry.kind,
                            name = entry.name,
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
                        kind = ref.kind,
                        name = ref.name,
                        meta = "",
                        onClick = { vm.openRef(ref) },
                    )
                }
            }
        }
    }
}

@Composable
private fun AccessCard(onRequestStorage: () -> Unit) {
    Surface(
        onClick = onRequestStorage,
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.primaryContainer,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(44.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.18f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.Folder, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            }
            Spacer(Modifier.width(13.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    "기기 전체 문서 접근 허용",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                )
                Text(
                    "허용하면 기기의 모든 PDF·문서를 여기서 바로 볼 수 있어요. 파일은 전송되지 않습니다.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.8f),
                )
            }
            Text("›", style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.onPrimaryContainer)
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
private fun FileRow(kind: DocKind, name: String, meta: String, onClick: () -> Unit) {
    val style = styleFor(kind)
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            FileIconTile(kind)
            Spacer(Modifier.width(13.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    name,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.height(3.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(style.color.copy(alpha = 0.16f))
                            .padding(horizontal = 7.dp, vertical = 1.dp),
                    ) {
                        Text(style.tag, color = style.color, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                    }
                    if (meta.isNotEmpty()) {
                        Spacer(Modifier.width(7.dp))
                        Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            Spacer(Modifier.width(6.dp))
            Text("›", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
    onExportPdf: (String) -> Unit,
    onBack: () -> Unit,
) {
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var menuOpen by remember { mutableStateOf(false) }

    LaunchedEffect(vm.toastMessage) {
        vm.toastMessage?.let { snackbar.showSnackbar(it); vm.toastMessage = null }
    }

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
                            IconButton(onClick = { vm.pdfEdit?.undo() }, enabled = vm.pdfEdit?.canUndo == true) {
                                Icon(Icons.AutoMirrored.Filled.Undo, contentDescription = "실행취소")
                            }
                            IconButton(onClick = {
                                onExportPdf(ref.name.removeSuffix(".pdf") + "-편집.pdf")
                            }) { Icon(Icons.Filled.Save, contentDescription = "저장") }
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
        bottomBar = {
            if (ref.kind == DocKind.PDF) vm.pdfEdit?.let { PdfToolbar(it) }
        },
    ) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            when (ref.kind) {
                DocKind.PDF -> PdfEditorView(vm, ref)
                DocKind.TEXT, DocKind.CSV, DocKind.MARKDOWN -> TextEditorView(vm, ref)
                DocKind.DOCX -> DocxView(ref)
                DocKind.XLSX -> SheetView(ref)
                DocKind.PPTX -> PptxView(ref)
                DocKind.IMAGE -> ImageView(ref)
                DocKind.HWP, DocKind.UNKNOWN -> UnsupportedView(ref)
            }
        }
    }
}

// ---------------------------------------------------------------------------
//  PDF 뷰어
// ---------------------------------------------------------------------------
@Composable
private fun PdfEditorView(vm: AppViewModel, ref: DocRef) {
    val context = LocalContext.current
    val repo = remember(ref.uri) { runCatching { PdfRepository(context, ref.uri) }.getOrNull() }
    androidx.compose.runtime.DisposableEffect(repo) { onDispose { repo?.close() } }

    if (repo == null) {
        CenterMessage("PDF 를 열 수 없습니다.\n파일이 손상되었거나 암호가 설정되어 있을 수 있습니다.")
        return
    }

    val model = remember(ref.uri) { PdfEditModel(repo.pageCount) }
    LaunchedEffect(model) { vm.pdfEdit = model }

    val visiblePages = model.pages.filter { !it.deleted }

    androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxSize()) {
        val renderWidth = with(LocalDensity.current) { maxWidth.roundToPx() }.coerceIn(1, 2200)
        val listState = rememberLazyListState()
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(start = 18.dp, top = 12.dp, end = 10.dp, bottom = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(visiblePages, key = { it.src }) { pe ->
                PdfEditablePage(repo, pe, model, renderWidth, canDelete = model.activeCount > 1)
            }
        }
        LazyLeftScrollbar(listState)
    }
}

@Composable
private fun PdfEditablePage(
    repo: PdfRepository,
    pe: PdfPageEdit,
    model: PdfEditModel,
    renderWidth: Int,
    canDelete: Boolean,
) {
    val aspect = remember(pe.src) { runCatching { repo.aspectRatio(pe.src) }.getOrDefault(1.4f) }
    val bitmap by produceState<android.graphics.Bitmap?>(initialValue = null, pe.src, renderWidth) {
        value = withContext(Dispatchers.IO) { runCatching { repo.render(pe.src, renderWidth) }.getOrNull() }
    }
    Box(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(2.dp)),
        contentAlignment = Alignment.Center,
    ) {
        val bmp = bitmap
        if (bmp != null) {
            Box(Modifier.fillMaxWidth().aspectRatio(bmp.width.toFloat() / bmp.height.toFloat())) {
                Image(
                    bitmap = bmp.asImageBitmap(),
                    contentDescription = "페이지 ${pe.src + 1}",
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.FillWidth,
                )
                AnnotationCanvas(pe, model, Modifier.matchParentSize())
            }
        } else {
            Box(Modifier.fillMaxWidth().aspectRatio(1f / aspect), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        }
        if (canDelete) {
            IconButton(
                onClick = { model.deletePage(pe) },
                modifier = Modifier.align(Alignment.TopEnd).padding(6.dp),
            ) {
                Box(
                    Modifier.clip(RoundedCornerShape(8.dp)).background(Color.Black.copy(alpha = 0.6f)).padding(5.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Filled.Delete, contentDescription = "페이지 삭제", tint = Color.White, modifier = Modifier.size(18.dp))
                }
            }
        }
    }
}

@Composable
private fun AnnotationCanvas(pe: PdfPageEdit, model: PdfEditModel, modifier: Modifier) {
    var current by remember { mutableStateOf<PdfStroke?>(null) }
    var version by remember { mutableIntStateOf(0) }
    Canvas(
        modifier
            .graphicsLayer(compositingStrategy = CompositingStrategy.Offscreen)
            .pointerInput(model.tool) {
                if (model.tool == PdfTool.PAN) return@pointerInput
                detectDragGestures(
                    onDragStart = { pos ->
                        val s = model.newStroke(size.width.toFloat())
                        s.points.add(Offset(pos.x / size.width, pos.y / size.height))
                        pe.strokes.add(s)
                        model.lastEdited = pe
                        model.dirty = true
                        current = s
                        version++
                    },
                    onDrag = { change, _ ->
                        current?.let {
                            it.points.add(Offset(change.position.x / size.width, change.position.y / size.height))
                            version++
                        }
                        change.consume()
                    },
                    onDragEnd = { current = null },
                    onDragCancel = { current = null },
                )
            },
    ) {
        val tick = version // 포인트 추가 시 재그리기 트리거
        if (tick >= 0) {
            val w = size.width
            val h = size.height
            for (s in pe.strokes) drawPdfStroke(s, w, h)
        }
    }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawPdfStroke(
    s: PdfStroke, w: Float, h: Float,
) {
    val sw = (s.width * w).coerceAtLeast(1f)
    val color = Color(s.color)
    val drawColor = when (s.tool) {
        PdfTool.HIGHLIGHTER -> color.copy(alpha = 0.35f)
        PdfTool.ERASER -> Color.Black
        else -> color
    }
    val blend = if (s.tool == PdfTool.ERASER) BlendMode.Clear else BlendMode.SrcOver
    val pts = s.points
    if (pts.isEmpty()) return
    if (pts.size == 1) {
        drawCircle(color = drawColor, radius = sw / 2f, center = Offset(pts[0].x * w, pts[0].y * h), blendMode = blend)
        return
    }
    val path = Path().apply {
        moveTo(pts[0].x * w, pts[0].y * h)
        for (i in 1 until pts.size) lineTo(pts[i].x * w, pts[i].y * h)
    }
    drawPath(
        path = path,
        color = drawColor,
        style = Stroke(width = sw, cap = StrokeCap.Round, join = StrokeJoin.Round),
        blendMode = blend,
    )
}

private val PDF_COLORS = listOf(
    0xFF111418.toInt(), 0xFFE23B3B.toInt(), 0xFF2F74E0.toInt(), 0xFF1FA463.toInt(), 0xFFF2B705.toInt(),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PdfToolbar(model: PdfEditModel) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            ToolChip("보기", model.tool == PdfTool.PAN) { model.tool = PdfTool.PAN }
            ToolChip("펜", model.tool == PdfTool.PEN) { model.tool = PdfTool.PEN }
            ToolChip("형광펜", model.tool == PdfTool.HIGHLIGHTER) { model.tool = PdfTool.HIGHLIGHTER }
            ToolChip("지우개", model.tool == PdfTool.ERASER) { model.tool = PdfTool.ERASER }

            Spacer(Modifier.width(2.dp))
            PDF_COLORS.forEach { c ->
                val selected = model.color == c
                Box(
                    Modifier
                        .size(28.dp)
                        .clip(RoundedCornerShape(50))
                        .background(Color(c))
                        .border(
                            width = if (selected) 3.dp else 1.dp,
                            color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
                            shape = RoundedCornerShape(50),
                        )
                        .clickable {
                            model.color = c
                            if (model.tool == PdfTool.PAN || model.tool == PdfTool.ERASER) model.tool = PdfTool.PEN
                        },
                )
            }
            Spacer(Modifier.width(4.dp))
            Slider(
                value = model.widthPx,
                onValueChange = { model.widthPx = it },
                valueRange = 1f..40f,
                modifier = Modifier.width(110.dp),
            )
        }
    }
}

@Composable
private fun ToolChip(label: String, selected: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(999.dp),
        color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Text(
            label,
            color = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.labelLarge,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
        )
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
//  PPTX (읽기, 슬라이드 텍스트)
// ---------------------------------------------------------------------------
@Composable
private fun PptxView(ref: DocRef) {
    val context = LocalContext.current
    val text by produceState(initialValue = null as String?, ref.uri) {
        value = withContext(Dispatchers.IO) { runCatching { OfficeReaders.readPptxText(context, ref.uri) }.getOrNull() }
    }
    when (val t = text) {
        null -> CenterMessage("프레젠테이션을 읽는 중…", spinner = true)
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
