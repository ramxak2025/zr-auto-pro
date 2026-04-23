package com.autexa.app.ui.components

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign

/**
 * Count-up animation for numeric hero values — plays from 0 to [target]
 * whenever [target] changes. Formatter returns the display string for any
 * intermediate Float, so you can use it for money / counts / percents.
 */
@Composable
fun AnimatedCountText(
    target: Double,
    formatter: (Double) -> String,
    color: Color,
    style: TextStyle,
    modifier: Modifier = Modifier,
    fontWeight: FontWeight? = null,
    textAlign: TextAlign? = null,
    durationMs: Int = 900,
) {
    val animated by animateFloatAsState(
        targetValue = target.toFloat(),
        animationSpec = tween(durationMillis = durationMs, easing = FastOutSlowInEasing),
        label = "countUp",
    )
    Text(
        text = formatter(animated.toDouble()),
        color = color,
        style = style,
        fontWeight = fontWeight ?: style.fontWeight,
        textAlign = textAlign,
        modifier = modifier,
    )
}
