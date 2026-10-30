package com.paper.office.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LightColors = lightColorScheme(
    primary = Color(0xFF3B5BDB),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFE8ECFB),
    onPrimaryContainer = Color(0xFF17245E),
    secondary = Color(0xFF4F6EF2),
    background = Color(0xFFF6F7F9),
    onBackground = Color(0xFF171A1F),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF171A1F),
    surfaceVariant = Color(0xFFF1F3F5),
    onSurfaceVariant = Color(0xFF5A616B),
    outline = Color(0xFFD9DDE2),
    outlineVariant = Color(0xFFECEEF1),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF8AA2FF),
    onPrimary = Color(0xFF0E1630),
    primaryContainer = Color(0xFF1B2233),
    onPrimaryContainer = Color(0xFFD7E0FF),
    secondary = Color(0xFF9DB0FF),
    background = Color(0xFF0D0F12),
    onBackground = Color(0xFFE8EAED),
    surface = Color(0xFF15181D),
    onSurface = Color(0xFFE8EAED),
    surfaceVariant = Color(0xFF1C2026),
    onSurfaceVariant = Color(0xFF9AA1AB),
    outline = Color(0xFF2A303A),
    outlineVariant = Color(0xFF232830),
)

@Composable
fun PaperTheme(content: @Composable () -> Unit) {
    val colors = if (isSystemInDarkTheme()) DarkColors else LightColors
    MaterialTheme(colorScheme = colors, content = content)
}
