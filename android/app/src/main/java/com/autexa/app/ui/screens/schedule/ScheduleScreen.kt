package com.autexa.app.ui.screens.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.autexa.app.data.network.models.TodayEmployeeStatus
import com.autexa.app.ui.screens.clients.CenteredSpinner
import com.autexa.app.ui.screens.clients.EmptyListState
import com.autexa.app.ui.screens.clients.SubscreenHeader
import com.autexa.app.ui.theme.BrandBlue100
import com.autexa.app.ui.theme.BrandBlue700
import com.autexa.app.ui.theme.Gray100
import com.autexa.app.ui.theme.Gray400
import com.autexa.app.ui.theme.Gray500
import com.autexa.app.ui.theme.Gray900
import com.autexa.app.ui.theme.Green50
import com.autexa.app.ui.theme.Green700
import com.autexa.app.ui.theme.Orange50
import com.autexa.app.ui.theme.Red50
import com.autexa.app.ui.theme.Red600
import com.autexa.app.ui.theme.WarningOrange

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScheduleScreen(
    onBack: () -> Unit = {},
    vm: ScheduleViewModel = hiltViewModel(),
) {
    val ui by vm.ui.collectAsState()

    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(Modifier.fillMaxSize().statusBarsPadding()) {
            SubscreenHeader(
                title = "Расписание",
                subtitle = when {
                    ui.isLoading -> "Загружаем…"
                    ui.items.isEmpty() -> "Никого нет на смене"
                    else -> "${ui.items.count { it.isWorking }} на смене · ${ui.items.size} всего"
                },
                onBack = onBack,
            )

            PullToRefreshBox(
                isRefreshing = ui.isRefreshing,
                onRefresh = vm::refresh,
                modifier = Modifier.fillMaxSize(),
            ) {
                when {
                    ui.isLoading -> CenteredSpinner()
                    ui.items.isEmpty() -> EmptyListState(
                        icon = Icons.Outlined.CalendarMonth,
                        title = "Смен сегодня нет",
                        sub = "Настройте расписание в веб-версии",
                    )
                    else -> LazyColumn(
                        contentPadding = PaddingValues(
                            start = 16.dp, end = 16.dp, top = 12.dp, bottom = 96.dp,
                        ),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(items = ui.items, key = { it.userId }) { emp ->
                            EmployeeRow(emp)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun EmployeeRow(emp: TodayEmployeeStatus) {
    val initial = emp.fullName.firstOrNull()?.uppercaseChar()?.toString() ?: "?"

    Surface(
        color = Color.White,
        shape = RoundedCornerShape(16.dp),
        shadowElevation = 2.dp,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(BrandBlue100),
                contentAlignment = Alignment.Center,
            ) {
                Text(initial, color = BrandBlue700, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    emp.fullName.ifBlank { "Без имени" },
                    color = Gray900,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                )
                val sub = when {
                    emp.isDayOff -> "Выходной"
                    !emp.hasSchedule -> "Нет расписания"
                    emp.shiftStart != null && emp.shiftEnd != null ->
                        "${timeOf(emp.shiftStart)} – ${timeOf(emp.shiftEnd)}"
                    else -> roleLabel(emp.role)
                }
                Text(sub, color = Gray400, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp))
            }
            Spacer(Modifier.width(8.dp))
            StatusPill(emp)
        }
    }
}

@Composable
private fun StatusPill(emp: TodayEmployeeStatus) {
    val (label, bg, fg) = when {
        emp.isDayOff -> Triple("Выходной", Gray100, Gray500)
        emp.isWorking && emp.lateStatus == "late_major" -> Triple("+${emp.lateMinutes} мин", Red50, Red600)
        emp.isWorking && emp.lateStatus == "late_minor" -> Triple("+${emp.lateMinutes} мин", Orange50, WarningOrange)
        emp.isWorking -> Triple("На смене", Green50, Green700)
        !emp.hasSchedule -> Triple("—", Gray100, Gray500)
        emp.actualArrival == null -> Triple("Не пришёл", Red50, Red600)
        else -> Triple("Ушёл", Gray100, Gray500)
    }
    Box(
        Modifier
            .clip(RoundedCornerShape(10.dp))
            .background(bg)
            .padding(horizontal = 10.dp, vertical = 4.dp),
    ) {
        Text(label, color = fg, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
    }
}

private fun timeOf(isoDateTime: String?): String {
    if (isoDateTime.isNullOrBlank()) return ""
    // Accepts "YYYY-MM-DDTHH:mm:ss" or "HH:mm[:ss]"
    val t = when {
        isoDateTime.contains('T') -> isoDateTime.substringAfter('T')
        else -> isoDateTime
    }
    return t.take(5)
}

private fun roleLabel(role: String): String = when (role) {
    "superadmin" -> "Суперадмин"
    "director" -> "Владелец"
    "admin" -> "Администратор"
    "master" -> "Мастер"
    else -> role
}
