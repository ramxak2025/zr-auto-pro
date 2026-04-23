package com.autexa.app.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autexa.app.ui.theme.Gray500
import com.autexa.app.ui.theme.Gray900

/**
 * Unified screen title — one size, one weight, one spacing everywhere so
 * headers don't read as "title glued to subtitle". Mirrors the Stripe /
 * Linear header pattern: bold display heading, slim muted subtitle.
 */
@Composable
fun ScreenTitle(
    title: String,
    subtitle: String? = null,
    modifier: Modifier = Modifier,
) {
    Column(modifier) {
        Text(
            text = title,
            color = Gray900,
            fontSize = 28.sp,
            fontWeight = FontWeight.ExtraBold,
            letterSpacing = (-0.3).sp,
            lineHeight = 32.sp,
        )
        if (!subtitle.isNullOrBlank()) {
            Text(
                text = subtitle,
                color = Gray500,
                fontSize = 13.sp,
                fontWeight = FontWeight.Normal,
                modifier = Modifier.padding(top = 6.dp),
            )
        }
    }
}
