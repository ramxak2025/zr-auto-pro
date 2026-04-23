package com.autexa.app.ui.components

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect

/**
 * Smooth-bezier sparkline — draws [values] as a curve with a soft gradient
 * area fill underneath. Animates in on first layout (left-to-right reveal).
 *
 * Pass at least two points. Nothing else is needed — width / height are
 * driven by the Canvas bounds.
 */
@Composable
fun Sparkline(
    values: List<Double>,
    modifier: Modifier = Modifier,
    lineColor: Color = Color.White,
    fillColor: Color = Color.White.copy(alpha = 0.14f),
    lineWidth: Float = 5f,
) {
    val sanitized = remember(values) {
        if (values.size < 2) emptyList() else values
    }
    val progress by animateFloatAsState(
        targetValue = if (sanitized.isNotEmpty()) 1f else 0f,
        animationSpec = tween(durationMillis = 900, easing = FastOutSlowInEasing),
        label = "sparkline",
    )

    Canvas(modifier.fillMaxSize()) {
        if (sanitized.isEmpty()) return@Canvas
        val w = size.width
        val h = size.height
        val maxV = sanitized.maxOrNull()?.takeIf { it > 0.0 } ?: 1.0
        val stepX = if (sanitized.size > 1) w / (sanitized.size - 1) else w

        // Project to screen space, leaving breathing room top/bottom.
        val top = h * 0.12f
        val bottom = h * 0.94f
        val pts = sanitized.mapIndexed { i, v ->
            val x = i * stepX
            val y = bottom - ((v / maxV).toFloat() * (bottom - top))
            Offset(x, y)
        }

        // Smooth cubic bezier between neighboring points (midpoint-control).
        val linePath = Path().apply {
            moveTo(pts.first().x, pts.first().y)
            for (i in 1 until pts.size) {
                val prev = pts[i - 1]
                val cur = pts[i]
                val cpx = (prev.x + cur.x) / 2f
                cubicTo(cpx, prev.y, cpx, cur.y, cur.x, cur.y)
            }
        }

        val fillPath = Path().apply {
            addPath(linePath)
            lineTo(pts.last().x, h)
            lineTo(pts.first().x, h)
            close()
        }

        // Animated reveal — clip to `progress * w` horizontally.
        clipRect(left = 0f, top = 0f, right = w * progress, bottom = h) {
            drawPath(
                path = fillPath,
                brush = Brush.verticalGradient(
                    colors = listOf(fillColor, Color.Transparent),
                    startY = top,
                    endY = h,
                ),
            )
            drawPath(
                path = linePath,
                color = lineColor,
                style = Stroke(width = lineWidth, cap = StrokeCap.Round),
            )
        }
    }
}
