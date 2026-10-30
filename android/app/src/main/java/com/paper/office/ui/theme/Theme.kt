package com.paper.office.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Blue = Color(0xFF2F74E0)
private val BlueLight = Color(0xFF5A9BFF)

private val LightColors = lightColorScheme(
    primary = Blue,
    onPrimary = Color.White,
    secondary = Color(0xFF1FA463),
    background = Color(0xFFF3F4F6),
    surface = Color(0xFFFFFFFF),
    onBackground = Color(0xFF1B1E23),
    onSurface = Color(0xFF1B1E23),
)

private val DarkColors = darkColorScheme(
    primary = BlueLight,
    onPrimary = Color(0xFF0B0D10),
    secondary = Color(0xFF4FD896),
    background = Color(0xFF0B0D10),
    surface = Color(0xFF16191E),
    onBackground = Color(0xFFE8EAED),
    onSurface = Color(0xFFE8EAED),
)

@Composable
fun PaperTheme(content: @Composable () -> Unit) {
    val colors = if (isSystemInDarkTheme()) DarkColors else LightColors
    MaterialTheme(colorScheme = colors, content = content)
}
