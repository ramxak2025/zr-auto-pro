package com.autexa.app.ui.screens.checks

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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Description
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
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.autexa.app.data.network.models.CheckListItem
import com.autexa.app.ui.theme.BrandBlue100
import com.autexa.app.ui.theme.BrandBlue600
import com.autexa.app.ui.theme.Gray100
import com.autexa.app.ui.theme.Gray400
import com.autexa.app.ui.theme.Gray500
import com.autexa.app.ui.theme.Gray900
import com.autexa.app.ui.theme.Green600
import com.autexa.app.ui.theme.Indigo600
import com.autexa.app.ui.theme.WarningOrange

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChecksScreen(vm: ChecksViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsState()
    val grouped = remember(ui.items) { groupByDay(ui.items) }

    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(Modifier.fillMaxSize().statusBarsPadding()) {
            // Header
            Column(Modifier.padding(horizontal = 16.dp, vertical = 16.dp)) {
                Text("Журнал", color = Gray900, fontSize = 28.sp, fontWeight = FontWeight.ExtraBold)
                Text(
                    if (ui.items.isEmpty() && !ui.isLoading) "Чеков пока нет"
                    else "${ui.items.size} ${pluralChecks(ui.items.size)}",
                    color = Gray500,
                    fontSize = 13.sp,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }

            PullToRefreshBox(
                isRefreshing = ui.isRefreshing,
                onRefresh = vm::refresh,
                modifier = Modifier.fillMaxSize(),
            ) {
                when {
                    ui.isLoading -> LoadingState()
                    ui.items.isEmpty() -> EmptyState()
                    else -> LazyColumn(
                        contentPadding = PaddingValues(
                            start = 16.dp, end = 16.dp, top = 8.dp, bottom = 96.dp,
                        ),
                        verticalArrangement = Arrangement.spacedBy(20.dp),
                    ) {
                        grouped.forEach { (day, checks) ->
                            item(key = "g:$day") {
                                Text(
                                    day,
                                    color = Gray500,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.padding(start = 6.dp, bottom = 4.dp),
                                )
                            }
                            item(key = "c:$day") {
                                Surface(
                                    color = Color.White,
                                    shape = RoundedCornerShape(20.dp),
                                    shadowElevation = 2.dp,
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Column {
                                        checks.forEachIndexed { idx, check ->
                                            if (idx > 0) {
                                                Box(
                                                    Modifier
                                                        .padding(start = 60.dp)
                                                        .fillMaxWidth()
                                                        .height(1.dp)
                                                        .background(Gray100),
                                                )
                                            }
                                            CheckRow(check)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CheckRow(check: CheckListItem) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Avatar — number pill
        Box(
            Modifier
                .size(40.dp)
                .clip(CircleShape)
                .background(BrandBlue100),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                "#${check.number}",
                color = BrandBlue600,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
            )
        }
        Spacer(Modifier.width(12.dp))

        // Primary + secondary
        Column(Modifier.weight(1f)) {
            val title = buildString {
                val plate = check.car?.plate?.trim()?.takeIf { it.isNotEmpty() }
                val clientName = check.client?.fullName?.trim()?.takeIf { it.isNotEmpty() }
                when {
                    plate != null && clientName != null -> append("$plate · $clientName")
                    plate != null -> append(plate)
                    clientName != null -> append(clientName)
                    else -> append("Чек")
                }
            }
            Text(
                title,
                color = Gray900,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
            )
            val sub = buildString {
                val car = listOfNotNull(check.car?.brand, check.car?.model)
                    .joinToString(" ").takeIf { it.isNotBlank() }
                val master = check.master?.fullName?.substringBefore(' ')?.takeIf { it.isNotBlank() }
                when {
                    car != null && master != null -> append("$car · $master")
                    car != null -> append(car)
                    master != null -> append(master)
                }
            }
            if (sub.isNotBlank()) {
                Text(
                    sub,
                    color = Gray400,
                    fontSize = 12.sp,
                    maxLines = 1,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
        }

        Spacer(Modifier.width(8.dp))

        // Amount + payment pill
        Column(horizontalAlignment = Alignment.End) {
            Text(
                formatMoney(check.totalRevenue),
                color = Gray900,
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
            )
            PaymentPill(method = check.paymentMethod, isDeferred = check.isDeferred)
        }
    }
}

@Composable
private fun PaymentPill(method: String, isDeferred: Boolean) {
    val label = when {
        isDeferred -> "Отложен"
        method == "cash" -> "Нал"
        method == "card" -> "Карта"
        method == "cash_card" -> "Нал+Карта"
        method == "warranty" -> "Гарантия"
        else -> method
    }
    val color = when {
        isDeferred -> WarningOrange
        method == "cash" -> Green600
        method == "card" -> BrandBlue600
        method == "warranty" -> Indigo600
        else -> Gray500
    }
    Box(
        Modifier
            .padding(top = 4.dp)
            .clip(CircleShape)
            .background(color.copy(alpha = 0.10f))
            .padding(horizontal = 8.dp, vertical = 2.dp),
    ) {
        Text(label, color = color, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun LoadingState() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = BrandBlue600, strokeWidth = 2.dp, modifier = Modifier.size(28.dp))
    }
}

@Composable
private fun EmptyState() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Outlined.Description, null, tint = Gray400, modifier = Modifier.size(48.dp))
            Spacer(Modifier.height(12.dp))
            Text("Пока нет чеков", color = Gray500, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            Text("Потяните вниз, чтобы обновить", color = Gray400, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

private fun groupByDay(items: List<CheckListItem>): List<Pair<String, List<CheckListItem>>> {
    if (items.isEmpty()) return emptyList()
    val grouped = linkedMapOf<String, MutableList<CheckListItem>>()
    for (it in items) {
        val day = it.date.take(10).ifBlank { it.createdAt.take(10) }
        grouped.getOrPut(day) { mutableListOf() }.add(it)
    }
    return grouped.entries.map { (day, list) -> humanDay(day) to list }
}

private fun humanDay(isoDate: String): String {
    if (isoDate.length < 10) return isoDate
    val y = isoDate.substring(0, 4)
    val m = isoDate.substring(5, 7).toIntOrNull() ?: return isoDate
    val d = isoDate.substring(8, 10).toIntOrNull() ?: return isoDate
    val months = listOf(
        "января", "февраля", "марта", "апреля", "мая", "июня",
        "июля", "августа", "сентября", "октября", "ноября", "декабря",
    )
    val monthName = months.getOrNull(m - 1) ?: m.toString()
    return "$d $monthName $y"
}

private fun formatMoney(value: Double): String {
    val rounded = value.toLong()
    val s = rounded.toString().reversed().chunked(3).joinToString(" ").reversed()
    return "$s ₽"
}

private fun pluralChecks(n: Int): String {
    val mod10 = n % 10
    val mod100 = n % 100
    return when {
        mod100 in 11..14 -> "чеков"
        mod10 == 1 -> "чек"
        mod10 in 2..4 -> "чека"
        else -> "чеков"
    }
}
