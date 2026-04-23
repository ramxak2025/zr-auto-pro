package com.autexa.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * iOS-26-style "Liquid Glass" surface.
 *
 * Layers:
 *   1. Soft drop shadow.
 *   2. Translucent white tint that lets the animated mesh bleed through.
 *   3. Inner gradient glaze (top → transparent) — the key to glass.
 *   4. Hairline gradient border (white-→ low-alpha) for the rim-light edge.
 */
@Composable
fun GlassSurface(
    modifier: Modifier = Modifier,
    cornerRadius: Dp = 28.dp,
    tint: Color = Color.White.copy(alpha = 0.55f),
    elevation: Dp = 18.dp,
    content: @Composable () -> Unit,
) {
    val shape = RoundedCornerShape(cornerRadius)
    Box(
        modifier
            .shadow(
                elevation = elevation,
                shape = shape,
                ambientColor = Color(0x1A1E3A8A),
                spotColor = Color(0x331E3A8A),
            )
            .clip(shape)
            .background(tint)
            .drawWithCache {
                val glaze = Brush.verticalGradient(
                    colors = listOf(
                        Color.White.copy(alpha = 0.45f),
                        Color.White.copy(alpha = 0.05f),
                        Color.Transparent,
                    ),
                    startY = 0f,
                    endY = size.height * 0.7f,
                )
                val sheen = Brush.linearGradient(
                    colors = listOf(
                        Color.White.copy(alpha = 0.25f),
                        Color.Transparent,
                    ),
                    start = Offset(0f, 0f),
                    end = Offset(size.width * 0.6f, size.height * 0.4f),
                )
                onDrawWithContent {
                    drawContent()
                    drawRect(brush = glaze, size = Size(size.width, size.height))
                    drawRect(brush = sheen, size = Size(size.width, size.height))
                }
            }
            .border(
                width = 1.dp,
                brush = Brush.linearGradient(
                    colors = listOf(
                        Color.White.copy(alpha = 0.85f),
                        Color.White.copy(alpha = 0.15f),
                        Color.White.copy(alpha = 0.50f),
                    ),
                ),
                shape = shape,
            ),
    ) {
        content()
    }
}

/** Pill-shaped glass button background. Matches iOS Control Center buttons. */
@Composable
fun GlassPill(
    modifier: Modifier = Modifier,
    tint: Color = Color.White.copy(alpha = 0.40f),
    cornerRadius: Dp = 16.dp,
    content: @Composable () -> Unit,
) {
    val shape = RoundedCornerShape(cornerRadius)
    Box(
        modifier
            .clip(shape)
            .background(tint)
            .drawWithCache {
                val glaze = Brush.verticalGradient(
                    colors = listOf(
                        Color.White.copy(alpha = 0.55f),
                        Color.White.copy(alpha = 0.10f),
                        Color.Transparent,
                    ),
                )
                onDrawWithContent {
                    drawContent()
                    drawRect(brush = glaze, size = Size(size.width, size.height))
                }
            }
            .border(
                width = 1.dp,
                brush = Brush.verticalGradient(
                    listOf(
                        Color.White.copy(alpha = 0.9f),
                        Color.White.copy(alpha = 0.2f),
                    ),
                ),
                shape = shape,
            ),
    ) { content() }
}
