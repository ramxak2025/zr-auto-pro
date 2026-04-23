package com.autexa.app.ui.screens.clients

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.Search
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.autexa.app.data.network.models.Client
import com.autexa.app.ui.theme.Blue50
import com.autexa.app.ui.theme.Blue600
import com.autexa.app.ui.theme.BrandBlue600
import com.autexa.app.ui.theme.Gray200
import com.autexa.app.ui.theme.Gray400
import com.autexa.app.ui.theme.Gray50
import com.autexa.app.ui.theme.Gray500
import com.autexa.app.ui.theme.Gray900

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClientsScreen(
    onBack: () -> Unit = {},
    vm: ClientsViewModel = hiltViewModel(),
) {
    val ui by vm.ui.collectAsState()

    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(Modifier.fillMaxSize().statusBarsPadding()) {
            SubscreenHeader(
                title = "Клиенты",
                subtitle = when {
                    ui.isLoading -> "Загружаем…"
                    ui.items.isEmpty() && ui.search.isBlank() -> "База клиентов пуста"
                    ui.items.isEmpty() -> "Ничего не найдено"
                    else -> "${ui.items.size} ${pluralClients(ui.items.size)}"
                },
                onBack = onBack,
            )

            SearchField(
                value = ui.search,
                onValueChange = vm::onSearchChange,
                placeholder = "Поиск по имени или телефону",
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
                        icon = Icons.Outlined.People,
                        title = "Клиентов не найдено",
                        sub = "Попробуйте другой запрос",
                    )
                    else -> LazyColumn(
                        contentPadding = PaddingValues(
                            start = 16.dp, end = 16.dp, top = 12.dp, bottom = 96.dp,
                        ),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(items = ui.items, key = { it.id }) { client ->
                            ClientRow(client)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ClientRow(client: Client) {
    val initial = client.fullName.firstOrNull()?.uppercaseChar()?.toString() ?: "К"
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
                    .background(Blue50),
                contentAlignment = Alignment.Center,
            ) {
                Text(initial, color = Blue600, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    client.fullName.ifBlank { "Без имени" },
                    color = Gray900,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                )
                if (client.phone.isNotBlank()) {
                    Text(
                        client.phone,
                        color = Gray400,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                }
            }
        }
    }
}

// ───── Shared UI ─────

@Composable
internal fun SubscreenHeader(title: String, subtitle: String, onBack: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(40.dp)
                .clip(CircleShape)
                .clickable(interactionSource = interaction, indication = null, onClick = onBack),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.ArrowBack, null, tint = Gray500, modifier = Modifier.size(22.dp))
        }
        Spacer(Modifier.width(4.dp))
        Column {
            Text(title, color = Gray900, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
            Text(subtitle, color = Gray500, fontSize = 12.sp, modifier = Modifier.padding(top = 1.dp))
        }
    }
}

@Composable
internal fun SearchField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Gray50)
            .border(1.dp, Gray200, RoundedCornerShape(14.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.Search, null, tint = Gray400, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(10.dp))
        Box(Modifier.weight(1f)) {
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = true,
                textStyle = TextStyle(color = Gray900, fontSize = 14.sp),
                cursorBrush = SolidColor(BrandBlue600),
                modifier = Modifier.fillMaxWidth(),
            )
            if (value.isEmpty()) Text(placeholder, color = Gray400, fontSize = 14.sp)
        }
        if (value.isNotEmpty()) {
            val interaction = remember { MutableInteractionSource() }
            Icon(
                Icons.Outlined.Close, null, tint = Gray400,
                modifier = Modifier
                    .size(18.dp)
                    .clickable(interactionSource = interaction, indication = null) { onValueChange("") },
            )
        }
    }
}

@Composable
internal fun CenteredSpinner() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = BrandBlue600, strokeWidth = 2.dp, modifier = Modifier.size(28.dp))
    }
}

@Composable
internal fun EmptyListState(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    sub: String,
) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(icon, null, tint = Gray400, modifier = Modifier.size(48.dp))
            Spacer(Modifier.height(12.dp))
            Text(title, color = Gray500, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            Text(sub, color = Gray400, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

private fun pluralClients(n: Int): String {
    val mod10 = n % 10
    val mod100 = n % 100
    return when {
        mod100 in 11..14 -> "клиентов"
        mod10 == 1 -> "клиент"
        mod10 in 2..4 -> "клиента"
        else -> "клиентов"
    }
}
