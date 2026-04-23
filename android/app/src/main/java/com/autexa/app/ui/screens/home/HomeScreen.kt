package com.autexa.app.ui.screens.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddCircle
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.Receipt
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import com.autexa.app.ui.theme.BrandBlue50
import com.autexa.app.ui.theme.BrandBlue600
import com.autexa.app.ui.theme.BrandBlue700
import com.autexa.app.ui.theme.Blue50
import com.autexa.app.ui.theme.Blue600
import com.autexa.app.ui.theme.Gray100
import com.autexa.app.ui.theme.Gray300
import com.autexa.app.ui.theme.Gray400
import com.autexa.app.ui.theme.Gray500
import com.autexa.app.ui.theme.Gray900
import com.autexa.app.ui.theme.Green50
import com.autexa.app.ui.theme.Green600
import com.autexa.app.ui.theme.Green700
import com.autexa.app.ui.theme.Purple50
import com.autexa.app.ui.theme.Purple700
import com.autexa.app.ui.theme.Red600
import com.autexa.app.ui.theme.Teal50
import com.autexa.app.ui.theme.Teal600
import java.util.Calendar

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onOpenTab: (String) -> Unit = {},
    vm: HomeViewModel = hiltViewModel(),
) {
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
                    start = 16.dp, end = 16.dp, top = 0.dp, bottom = 96.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(14.dp),
                modifier = Modifier.fillMaxSize().statusBarsPadding(),
            ) {
                item { Spacer(Modifier.height(4.dp)) }

                item {
                    Column {
                        Text(
                            "$greeting${if (firstName.isNotBlank()) ", $firstName" else ""}!",
                            color = Gray900,
                            fontSize = 20.sp,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            "Обзор показателей автосервиса",
                            color = Gray400,
                            fontSize = 12.sp,
                            modifier = Modifier.padding(top = 2.dp),
                        )
                    }
                }

                item {
                    AnalyticsCard(stats = ui.stats)
                }

                item {
                    ShiftCard(
                        opened = ui.currentShift != null,
                        openedAt = ui.currentShift?.openedAt,
                        busy = ui.isShiftBusy,
                        onOpen = vm::openShift,
                        onClose = vm::closeShift,
                    )
                }

                item {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            StatCard(
                                modifier = Modifier.weight(1f),
                                label = "Чеков сегодня",
                                value = ui.stats?.todayChecks?.toString() ?: "—",
                                sub = "За месяц: ${ui.stats?.let { "—" } ?: "—"}",
                                icon = Icons.Outlined.Description,
                                iconTint = BrandBlue600,
                            )
                            StatCard(
                                modifier = Modifier.weight(1f),
                                label = "Сегодня",
                                value = formatMoney(ui.stats?.todayRevenue),
                                sub = "Прибыль: ${formatMoney(ui.stats?.todayProfit)}",
                                icon = Icons.Outlined.Receipt,
                                iconTint = Green600,
                            )
                        }
                    }
                }

                item { QuickActions(onOpenTab = onOpenTab) }

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

// ── Analytics card (dark premium gradient like PWA RevenueChart) ──

@Composable
private fun AnalyticsCard(stats: com.autexa.app.data.network.models.DashboardStats?) {
    Box(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(24.dp))
            .background(Brush.linearGradient(listOf(Color(0xFF0F172A), Color(0xFF1E293B))))
            .padding(20.dp),
    ) {
        Column {
            Text(
                "АНАЛИТИКА",
                color = Color(0xFF94A3B8),
                fontSize = 10.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 2.sp,
            )

            Spacer(Modifier.height(12.dp))

            // Period tabs — visual (non-functional until chart endpoint is wired)
            PeriodTabs()

            Spacer(Modifier.height(20.dp))

            // Big number — today revenue hero
            Text(
                text = formatMoney(stats?.todayRevenue),
                color = Color.White,
                fontSize = 34.sp,
                fontWeight = FontWeight.ExtraBold,
            )
            Text(
                "Выручка сегодня",
                color = Color(0xFF94A3B8),
                fontSize = 12.sp,
                modifier = Modifier.padding(top = 2.dp),
            )

            Spacer(Modifier.height(18.dp))

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(Color.White.copy(alpha = 0.05f)),
            ) {
                StatCell(
                    modifier = Modifier.weight(1f),
                    label = "Оборот",
                    value = formatMoney(stats?.weekRevenue),
                    color = Color.White,
                )
                DividerCell()
                StatCell(
                    modifier = Modifier.weight(1f),
                    label = "Месяц",
                    value = formatMoney(stats?.monthRevenue),
                    color = Color(0xFF22D3EE),
                )
                DividerCell()
                StatCell(
                    modifier = Modifier.weight(1f),
                    label = "Прибыль",
                    value = formatMoney(stats?.monthProfit),
                    color = Color(0xFF93C5FD),
                )
            }
        }
    }
}

@Composable
private fun PeriodTabs() {
    val tabs = listOf("День", "Неделя", "Месяц", "Год")
    var selected by remember { mutableStateOf(1) }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Color.White.copy(alpha = 0.08f))
            .padding(3.dp),
    ) {
        tabs.forEachIndexed { i, t ->
            val active = selected == i
            val interaction = remember { MutableInteractionSource() }
            Box(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(10.dp))
                    .background(if (active) Color.White.copy(alpha = 0.18f) else Color.Transparent)
                    .clickable(interactionSource = interaction, indication = null) { selected = i }
                    .padding(vertical = 7.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    t,
                    color = if (active) Color.White else Color(0xFF94A3B8),
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}

@Composable
private fun StatCell(modifier: Modifier, label: String, value: String, color: Color) {
    Column(
        modifier = modifier.padding(vertical = 12.dp, horizontal = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            label.uppercase(),
            color = Color(0xFF64748B),
            fontSize = 9.sp,
            fontWeight = FontWeight.Medium,
            letterSpacing = 1.sp,
        )
        Text(value, color = color, fontSize = 14.sp, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

@Composable
private fun DividerCell() {
    Box(
        Modifier
            .width(1.dp)
            .height(36.dp)
            .background(Color.White.copy(alpha = 0.05f)),
    )
}

// ── Shift card — like PWA ShiftControl ──

@Composable
private fun ShiftCard(
    opened: Boolean,
    openedAt: String?,
    busy: Boolean,
    onOpen: () -> Unit,
    onClose: () -> Unit,
) {
    Surface(
        color = Color.White,
        shape = RoundedCornerShape(20.dp),
        shadowElevation = 2.dp,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(if (opened) Green50 else Gray100),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Outlined.Timer,
                    null,
                    tint = if (opened) Green700 else Gray400,
                    modifier = Modifier.size(22.dp),
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    if (opened) "Смена открыта" else "Смена закрыта",
                    color = Gray900,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                if (opened && !openedAt.isNullOrBlank()) {
                    Text(
                        "с ${openedAt.substringAfter('T').take(5)}",
                        color = Gray400,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                }
            }
            val interaction = remember { MutableInteractionSource() }
            Box(
                Modifier
                    .clip(RoundedCornerShape(12.dp))
                    .background(if (opened) Color(0xFFFEF2F2) else Green50)
                    .clickable(
                        interactionSource = interaction,
                        indication = null,
                        enabled = !busy,
                        onClick = if (opened) onClose else onOpen,
                    )
                    .padding(horizontal = 14.dp, vertical = 10.dp),
            ) {
                if (busy) {
                    CircularProgressIndicator(
                        color = if (opened) Red600 else Green700,
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(16.dp),
                    )
                } else {
                    Text(
                        if (opened) "Закрыть" else "Открыть смену",
                        color = if (opened) Red600 else Green700,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
        }
    }
}

// ── Stat card — white KPI ──

@Composable
private fun StatCard(
    modifier: Modifier = Modifier,
    label: String,
    value: String,
    sub: String,
    icon: ImageVector,
    iconTint: Color,
) {
    Surface(
        color = Color.White,
        shape = RoundedCornerShape(20.dp),
        shadowElevation = 2.dp,
        modifier = modifier,
    ) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(icon, null, tint = iconTint, modifier = Modifier.size(18.dp))
            Text(label, color = Gray500, fontSize = 11.sp)
            Text(value, color = Gray900, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1)
            Text(sub, color = Gray300, fontSize = 10.sp, maxLines = 1)
        }
    }
}

// ── Quick actions — grid 2×2 ──

@Composable
private fun QuickActions(onOpenTab: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            "Быстрые действия",
            color = Gray900,
            fontSize = 14.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(start = 4.dp),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            QuickAction(
                modifier = Modifier.weight(1f),
                label = "Новый чек",
                icon = Icons.Outlined.AddCircle,
                bg = BrandBlue50, tint = BrandBlue600,
                onClick = { onOpenTab("kassa") },
            )
            QuickAction(
                modifier = Modifier.weight(1f),
                label = "Клиенты",
                icon = Icons.Outlined.People,
                bg = Blue50, tint = Blue600,
                onClick = { onOpenTab("more") },
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            QuickAction(
                modifier = Modifier.weight(1f),
                label = "Журнал",
                icon = Icons.Outlined.Receipt,
                bg = Teal50, tint = Teal600,
                onClick = { onOpenTab("checks") },
            )
            QuickAction(
                modifier = Modifier.weight(1f),
                label = "Отчёты",
                icon = Icons.Outlined.BarChart,
                bg = Purple50, tint = Purple700,
                onClick = { onOpenTab("more") },
            )
        }
    }
}

@Composable
private fun QuickAction(
    modifier: Modifier = Modifier,
    label: String,
    icon: ImageVector,
    bg: Color,
    tint: Color,
    onClick: () -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    Surface(
        color = Color.White,
        shape = RoundedCornerShape(20.dp),
        shadowElevation = 2.dp,
        modifier = modifier.clickable(
            interactionSource = interaction, indication = null, onClick = onClick,
        ),
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ModuleIcon(icon = icon, bg = bg, tint = tint, size = 40.dp, iconSize = 20.dp, cornerRadius = 12.dp)
            Spacer(Modifier.width(12.dp))
            Text(label, color = Gray900, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
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
