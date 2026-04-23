package com.autexa.app.ui.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val LightColors = lightColorScheme(
    primary = BrandBlue600,
    onPrimary = Color.White,
    primaryContainer = BrandBlue100,
    onPrimaryContainer = BrandBlue900,
    secondary = BrandBlue500,
    onSecondary = Color.White,
    tertiary = SuccessGreen,
    background = Gray50,
    onBackground = Gray900,
    surface = Color.White,
    onSurface = Gray900,
    surfaceVariant = Gray100,
    onSurfaceVariant = Gray600,
    error = ErrorRed,
    onError = Color.White,
    outline = Gray300,
    outlineVariant = Gray200,
)

private val DarkColors = darkColorScheme(
    primary = BrandBlue400,
    onPrimary = BrandBlue900,
    primaryContainer = BrandBlue800,
    onPrimaryContainer = BrandBlue100,
    secondary = BrandBlue300,
    onSecondary = BrandBlue900,
    tertiary = SuccessGreen,
    background = Gray900,
    onBackground = Gray50,
    surface = Gray800,
    onSurface = Gray50,
    surfaceVariant = Gray700,
    onSurfaceVariant = Gray300,
    error = ErrorRed,
    onError = Color.White,
    outline = Gray600,
    outlineVariant = Gray700,
)

@Composable
fun AutexaTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    // Dynamic color — Material You on Android 12+
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit,
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColors
        else -> LightColors
    }

    // Edge-to-edge status bar treatment
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !darkTheme
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = AutexaTypography,
        content = content,
    )
}
