package com.autexa.app.ui.components

import android.graphics.RenderEffect
import android.graphics.Shader
import android.os.Build
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asComposeRenderEffect
import androidx.compose.ui.graphics.graphicsLayer
import kotlin.math.cos
import kotlin.math.sin

/**
 * iOS-26-style living mesh backdrop. Three large soft color blobs slowly orbit the
 * canvas; the whole layer is blurred via GPU RenderEffect on Android 12+ to read as
 * frosted-glass when paired with a translucent surface on top.
 *
 * Falls back to a static linear gradient on API 24-30 (no native blur).
 */
@Composable
fun AnimatedMeshBackground(
    modifier: Modifier = Modifier,
    blurRadius: Float = 90f,
) {
    val transition = rememberInfiniteTransition(label = "mesh")

    val t1 by transition.animateFloat(
        initialValue = 0f, targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(durationMillis = 22000, easing = LinearEasing)),
        label = "t1",
    )
    val t2 by transition.animateFloat(
        initialValue = 0f, targetValue = -360f,
        animationSpec = infiniteRepeatable(tween(durationMillis = 28000, easing = LinearEasing)),
        label = "t2",
    )
    val t3 by transition.animateFloat(
        initialValue = 0f, targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(durationMillis = 36000, easing = LinearEasing)),
        label = "t3",
    )
    val pulse by transition.animateFloat(
        initialValue = 0.85f, targetValue = 1.15f,
        animationSpec = infiniteRepeatable(
            animation = tween(8000, easing = LinearEasing),
            repeatMode = androidx.compose.animation.core.RepeatMode.Reverse,
        ),
        label = "pulse",
    )

    Box(
        modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    colors = listOf(
                        Color(0xFFEFF4FF),   // pale blue
                        Color(0xFFF8F5FF),   // pale lilac
                        Color(0xFFFFF1F4),   // pale rose
                    ),
                ),
            ),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .glassBlur(blurRadius),
        ) {
            Canvas(modifier = Modifier.fillMaxSize()) {
                val w = size.width
                val h = size.height
                val cx = w / 2f
                val cy = h / 2f

                fun blob(angle: Float, orbit: Float, radius: Float, color: Color) {
                    val rad = Math.toRadians(angle.toDouble())
                    drawCircle(
                        color = color,
                        radius = radius,
                        center = Offset(
                            (cx + cos(rad).toFloat() * orbit),
                            (cy + sin(rad).toFloat() * orbit),
                        ),
                    )
                }

                // Three drifting color cores; pulse breathes their radius
                blob(t1, w * 0.22f, w * 0.55f * pulse, Color(0xCC6FA8FF))   // blue
                blob(t2 + 120f, w * 0.26f, w * 0.50f * pulse, Color(0xCCB897FF)) // violet
                blob(t3 + 240f, w * 0.20f, w * 0.55f * pulse, Color(0xCCFFB1C8)) // rose
            }
        }
    }
}

/**
 * Apply GPU blur (Android 12+) to the modifier chain. On older OSes this is a no-op
 * — the underlying gradient still looks fine, we just skip the bokeh.
 */
fun Modifier.glassBlur(radius: Float): Modifier =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        this.then(
            Modifier.graphicsLayer {
                renderEffect = RenderEffect
                    .createBlurEffect(radius, radius, Shader.TileMode.CLAMP)
                    .asComposeRenderEffect()
            },
        )
    } else {
        this
    }
