package com.autexa.app.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Receipt
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import com.autexa.app.ui.theme.BrandBlue400
import com.autexa.app.ui.theme.BrandBlue600
import com.autexa.app.ui.theme.BrandBlue800
import kotlin.math.cos
import kotlin.math.sin

/**
 * Liquid-glass plasma center button — matches the PWA "Касса" tab.
 * Three slow infinite waves create a breathing, organic feel.
 */
@Composable
fun KassaButton(
    modifier: Modifier = Modifier,
    size: androidx.compose.ui.unit.Dp = 62.dp,
) {
    val transition = rememberInfiniteTransition(label = "kassa")

    val wave1 by transition.animateFloat(
        initialValue = 0f, targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(2400, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ), label = "w1",
    )
    val wave2 by transition.animateFloat(
        initialValue = 0f, targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(1800, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ), label = "w2",
    )
    val wave3 by transition.animateFloat(
        initialValue = 0f, targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(3200, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ), label = "w3",
    )
    val rotate by transition.animateFloat(
        initialValue = 0f, targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(10000, easing = LinearEasing),
        ), label = "rot",
    )
    val rotateBack by transition.animateFloat(
        initialValue = 0f, targetValue = -360f,
        animationSpec = infiniteRepeatable(
            animation = tween(7000, easing = LinearEasing),
        ), label = "rotBack",
    )

    Box(
        modifier = modifier
            .size(size)
            .clip(CircleShape)
            .background(
                Brush.linearGradient(
                    colors = listOf(BrandBlue400, BrandBlue600, BrandBlue800),
                    start = Offset(0f, 0f),
                    end = Offset.Infinite,
                ),
            )
            .drawWithCache {
                val w = this.size.width
                val h = this.size.height

                // Convert rotation to radians once per frame
                val rad1 = Math.toRadians(rotate.toDouble())
                val rad2 = Math.toRadians(rotateBack.toDouble())

                // Blob positions orbit around the center
                val cx = w / 2f
                val cy = h / 2f
                val orbit = w * 0.18f

                onDrawBehind {
                    // Blob 1 — large slow, tinted blue-300
                    val b1Scale = 0.8f + wave1 * 0.5f
                    val b1Alpha = 0.20f + wave1 * 0.25f
                    drawCircle(
                        color = Color(0x599EC5FD).copy(alpha = b1Alpha),
                        radius = w * 0.32f * b1Scale,
                        center = Offset(
                            cx + (cos(rad1).toFloat() * orbit),
                            cy + (sin(rad1).toFloat() * orbit),
                        ),
                    )
                    // Blob 2 — medium counter, tinted blue-400
                    val b2Scale = 1.1f - wave2 * 0.4f
                    val b2Alpha = 0.15f + wave2 * 0.25f
                    drawCircle(
                        color = Color(0x4C60A5FA).copy(alpha = b2Alpha),
                        radius = w * 0.28f * b2Scale,
                        center = Offset(
                            cx + (cos(rad2).toFloat() * orbit * 1.1f),
                            cy + (sin(rad2).toFloat() * orbit * 1.1f),
                        ),
                    )
                    // Blob 3 — small fast, tinted blue-200
                    val b3Scale = 0.9f + wave3 * 0.4f
                    val b3Alpha = 0.10f + wave3 * 0.25f
                    drawCircle(
                        color = Color(0x4CBFDBFE).copy(alpha = b3Alpha),
                        radius = w * 0.22f * b3Scale,
                        center = Offset(
                            cx + (cos(rad1 + Math.PI).toFloat() * orbit * 0.8f),
                            cy + (sin(rad1 + Math.PI).toFloat() * orbit * 0.8f),
                        ),
                    )
                    // Glass highlight — top-left refraction
                    drawCircle(
                        color = Color.White.copy(alpha = 0.18f + wave1 * 0.10f),
                        radius = w * 0.22f,
                        center = Offset(w * 0.32f, h * 0.28f),
                    )
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        // Subtle rim light
        Box(
            Modifier
                .fillMaxSize()
                .graphicsLayer { alpha = 0.6f }
                .background(
                    Brush.radialGradient(
                        colors = listOf(Color.Transparent, Color(0x33000000)),
                        radius = 80f,
                    ),
                ),
        )
        Icon(
            Icons.Outlined.Receipt,
            contentDescription = "Касса",
            tint = Color.White,
            modifier = Modifier.size(26.dp),
        )
    }
}
