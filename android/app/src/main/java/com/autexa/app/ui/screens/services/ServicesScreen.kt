package com.autexa.app.ui.screens.services

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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Build
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
import com.autexa.app.data.network.models.ServiceItem
import com.autexa.app.ui.screens.clients.CenteredSpinner
import com.autexa.app.ui.screens.clients.EmptyListState
import com.autexa.app.ui.screens.clients.SearchField
import com.autexa.app.ui.screens.clients.SubscreenHeader
import com.autexa.app.ui.theme.Gray400
import com.autexa.app.ui.theme.Gray900
import com.autexa.app.ui.theme.Orange50
import com.autexa.app.ui.theme.Orange600

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ServicesScreen(
    onBack: () -> Unit = {},
    vm: ServicesViewModel = hiltViewModel(),
) {
    val ui by vm.ui.collectAsState()

    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(Modifier.fillMaxSize().statusBarsPadding()) {
            SubscreenHeader(
                title = "Услуги",
                subtitle = when {
                    ui.isLoading -> "Загружаем…"
                    ui.items.isEmpty() && ui.search.isBlank() -> "Каталог услуг пуст"
                    ui.items.isEmpty() -> "Ничего не найдено"
                    else -> "${ui.items.size} ${pluralServices(ui.items.size)}"
                },
                onBack = onBack,
            )

            SearchField(
                value = ui.search,
                onValueChange = vm::onSearchChange,
                placeholder = "Поиск по названию",
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )

            PullToRefreshBox(
                isRefreshing = ui.isRefreshing,
                onRefresh = vm::refresh,
                modifier = Modifier.fillMaxSize(),
            ) {
                when {
                    ui.isLoading -> CenteredSpinner()
                    ui.items.isEmpty() -> EmptyListState(
                        icon = Icons.Outlined.Build,
                        title = "Услуг не найдено",
                        sub = "Попробуйте другой запрос",
                    )
                    else -> LazyColumn(
                        contentPadding = PaddingValues(
                            start = 16.dp, end = 16.dp, top = 12.dp, bottom = 96.dp,
                        ),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(items = ui.items, key = { it.id }) { s ->
                            ServiceRow(s)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ServiceRow(service: ServiceItem) {
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
                    .clip(RoundedCornerShape(12.dp))
                    .background(Orange50),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.Build, null, tint = Orange600, modifier = Modifier.size(20.dp))
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    service.name.ifBlank { "Без названия" },
                    color = Gray900,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 2,
                )
                service.category?.takeIf { it.isNotBlank() }?.let {
                    Text(it, color = Gray400, fontSize = 11.sp, modifier = Modifier.padding(top = 2.dp))
                }
            }
            Spacer(Modifier.width(8.dp))
            Text(
                formatMoney(service.defaultPrice),
                color = Gray900,
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

private fun formatMoney(value: Double): String {
    val rounded = value.toLong()
    val s = rounded.toString().reversed().chunked(3).joinToString(" ").reversed()
    return "$s ₽"
}

private fun pluralServices(n: Int): String {
    val mod10 = n % 10
    val mod100 = n % 100
    return when {
        mod100 in 11..14 -> "услуг"
        mod10 == 1 -> "услуга"
        mod10 in 2..4 -> "услуги"
        else -> "услуг"
    }
}
