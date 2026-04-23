package com.autexa.app.ui.components

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/**
 * Fade + translateY reveal with an optional delay — used to stagger hero content
 * on first load (Linear/Stripe-style entrance).
 */
@Composable
fun StaggeredReveal(
    delayMs: Int = 0,
    durationMs: Int = 420,
    translateY: Dp = 14.dp,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    var show by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        if (delayMs > 0) delay(delayMs.toLong())
        show = true
    }
    val progress by animateFloatAsState(
        targetValue = if (show) 1f else 0f,
        animationSpec = tween(durationMillis = durationMs, easing = FastOutSlowInEasing),
        label = "reveal",
    )
    val tyPx = with(androidx.compose.ui.platform.LocalDensity.current) { translateY.toPx() }

    Box(
        modifier = modifier.graphicsLayer {
            alpha = progress
            translationY = (1f - progress) * tyPx
        },
    ) { content() }
}
