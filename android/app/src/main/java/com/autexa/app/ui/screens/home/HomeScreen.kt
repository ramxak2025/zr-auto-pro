package com.autexa.app.ui.screens.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AttachMoney
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Savings
import androidx.compose.material.icons.outlined.TrendingUp
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.autexa.app.ui.components.ModuleIcon
import com.autexa.app.ui.theme.Blue50
import com.autexa.app.ui.theme.Blue600
import com.autexa.app.ui.theme.BrandBlue500
import com.autexa.app.ui.theme.BrandBlue700
import com.autexa.app.ui.theme.Gray500
import com.autexa.app.ui.theme.Gray900
import com.autexa.app.ui.theme.Green50
import com.autexa.app.ui.theme.Green700
import com.autexa.app.ui.theme.Purple50
import com.autexa.app.ui.theme.Purple700
import com.autexa.app.ui.theme.Teal50
import com.autexa.app.ui.theme.Teal600
import java.util.Calendar

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(vm: HomeViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsState()
    val greeting = remember { greetingForHour(Calendar.getInstance().get(Calendar.HOUR_OF_DAY)) }
    val firstName = ui.user?.fullName?.substringBefore(' ').orEmpty()

    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        PullToRefreshBox(
            isRefreshing = ui.isRefreshing,
            onRefresh = vm::refresh,
            modifier = Modifier.fillMaxSize(),
        ) {
            LazyColumn(
                contentPadding = PaddingValues(
                    start = 16.dp, end = 16.dp,
                    top = 0.dp, bottom = 96.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(16.dp),
                modifier = Modifier.fillMaxSize().statusBarsPadding(),
            ) {
                item { Spacer(Modifier.height(8.dp)) }

                item {
                    HeroCard(greeting = greeting, name = firstName)
                }

                item { SectionTitle("Сегодня") }

                item {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            KpiCard(
                                modifier = Modifier.weight(1f),
                                label = "Выручка",
                                value = formatMoney(ui.stats?.todayRevenue),
                                icon = Icons.Outlined.AttachMoney,
                                bg = Green50, tint = Green700,
                            )
                            KpiCard(
                                modifier = Modifier.weight(1f),
                                label = "Чеки",
                                value = ui.stats?.todayChecks?.toString() ?: "—",
                                icon = Icons.Outlined.Description,
                                bg = Blue50, tint = Blue600,
                            )
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            KpiCard(
                                modifier = Modifier.weight(1f),
                                label = "Прибыль",
                                value = formatMoney(ui.stats?.todayProfit),
                                icon = Icons.Outlined.TrendingUp,
                                bg = Purple50, tint = Purple700,
                            )
                            KpiCard(
                                modifier = Modifier.weight(1f),
                                label = "Месяц",
                                value = formatMoney(ui.stats?.monthRevenue),
                                icon = Icons.Outlined.Savings,
                                bg = Teal50, tint = Teal600,
                            )
                        }
                    }
                }

                ui.errorMessage?.let { err ->
                    item {
                        Surface(
                            color = Color(0xFFFEF2F2),
                            shape = RoundedCornerShape(16.dp),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(
                                err,
                                color = Color(0xFFB91C1C),
                                fontSize = 13.sp,
                                modifier = Modifier.padding(14.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text = text,
        color = Gray500,
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(start = 4.dp),
    )
}

@Composable
private fun HeroCard(greeting: String, name: String) {
    Box(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(24.dp))
            .background(Brush.linearGradient(listOf(BrandBlue500, BrandBlue700)))
            .padding(22.dp),
    ) {
        Column {
            Text(greeting, color = Color.White.copy(alpha = 0.82f), fontSize = 13.sp)
            Spacer(Modifier.height(6.dp))
            Text(
                if (name.isBlank()) "Добро пожаловать" else name,
                color = Color.White,
                fontSize = 26.sp,
                fontWeight = FontWeight.ExtraBold,
                lineHeight = 30.sp,
            )
            Spacer(Modifier.height(14.dp))
            Text(
                "Свайп вниз, чтобы обновить",
                color = Color.White.copy(alpha = 0.75f),
                fontSize = 13.sp,
            )
        }
    }
}

@Composable
private fun KpiCard(
    modifier: Modifier = Modifier,
    label: String,
    value: String,
    icon: ImageVector,
    bg: Color,
    tint: Color,
) {
    Surface(
        color = Color.White,
        shape = RoundedCornerShape(20.dp),
        shadowElevation = 2.dp,
        modifier = modifier,
    ) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            ModuleIcon(icon = icon, bg = bg, tint = tint, size = 36.dp, iconSize = 18.dp, cornerRadius = 10.dp)
            Text(value, color = Gray900, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1)
            Text(label, color = Gray500, fontSize = 12.sp)
        }
    }
}

private fun formatMoney(value: Double?): String {
    if (value == null) return "—"
    val rounded = value.toLong()
    val s = rounded.toString().reversed().chunked(3).joinToString(" ").reversed()
    return "$s ₽"
}

private fun greetingForHour(h: Int): String = when {
    h in 5..11 -> "Доброе утро"
    h in 12..16 -> "Добрый день"
    h in 17..21 -> "Добрый вечер"
    else -> "Доброй ночи"
}
