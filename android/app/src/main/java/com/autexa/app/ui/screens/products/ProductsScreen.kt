package com.autexa.app.ui.screens.products

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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Inventory2
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
import com.autexa.app.data.network.models.Product
import com.autexa.app.ui.theme.BrandBlue600
import com.autexa.app.ui.theme.Gray100
import com.autexa.app.ui.theme.Gray200
import com.autexa.app.ui.theme.Gray400
import com.autexa.app.ui.theme.Gray50
import com.autexa.app.ui.theme.Gray500
import com.autexa.app.ui.theme.Gray900
import com.autexa.app.ui.theme.Orange50
import com.autexa.app.ui.theme.Orange600
import com.autexa.app.ui.theme.Red600

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProductsScreen(vm: ProductsViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsState()

    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(Modifier.fillMaxSize().statusBarsPadding()) {
            // Header
            Column(Modifier.padding(horizontal = 16.dp, vertical = 16.dp)) {
                Text("Склад", color = Gray900, fontSize = 28.sp, fontWeight = FontWeight.ExtraBold)
                Text(
                    when {
                        ui.isLoading -> "Загружаем товары…"
                        ui.items.isEmpty() && ui.search.isBlank() -> "Товаров пока нет"
                        ui.items.isEmpty() -> "Ничего не найдено"
                        else -> "${ui.items.size} ${pluralProducts(ui.items.size)}"
                    },
                    color = Gray500,
                    fontSize = 13.sp,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }

            // Search
            SearchBar(
                value = ui.search,
                onValueChange = vm::onSearchChange,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )

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
                            start = 16.dp, end = 16.dp, top = 12.dp, bottom = 96.dp,
                        ),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(items = ui.items, key = { it.id }) { product ->
                            ProductRow(product)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SearchBar(
    value: String,
    onValueChange: (String) -> Unit,
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
        Box(modifier = Modifier.weight(1f)) {
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = true,
                keyboardOptions = KeyboardOptions.Default,
                textStyle = TextStyle(color = Gray900, fontSize = 14.sp),
                cursorBrush = SolidColor(BrandBlue600),
                modifier = Modifier.fillMaxWidth(),
            )
            if (value.isEmpty()) {
                Text("Поиск по названию", color = Gray400, fontSize = 14.sp)
            }
        }
        if (value.isNotEmpty()) {
            val interaction = remember { MutableInteractionSource() }
            Icon(
                Icons.Outlined.Close,
                null,
                tint = Gray400,
                modifier = Modifier
                    .size(18.dp)
                    .clickable(
                        interactionSource = interaction,
                        indication = null,
                    ) { onValueChange("") },
            )
        }
    }
}

@Composable
private fun ProductRow(product: Product) {
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
            // Icon thumbnail
            Box(
                Modifier
                    .size(48.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Orange50),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Outlined.Inventory2,
                    null,
                    tint = Orange600,
                    modifier = Modifier.size(22.dp),
                )
            }

            Spacer(Modifier.width(12.dp))

            Column(Modifier.weight(1f)) {
                Text(
                    product.name,
                    color = Gray900,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 2,
                )
                val sub = buildString {
                    product.category?.takeIf { it.isNotBlank() }?.let { append(it) }
                    product.unit?.takeIf { it.isNotBlank() }?.let {
                        if (isNotEmpty()) append(" · ")
                        append(it)
                    }
                }
                if (sub.isNotBlank()) {
                    Text(sub, color = Gray400, fontSize = 11.sp, modifier = Modifier.padding(top = 2.dp))
                }
            }

            Spacer(Modifier.width(8.dp))

            Column(horizontalAlignment = Alignment.End) {
                Text(
                    formatMoney(product.sellPrice),
                    color = Gray900,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                )
                StockPill(stock = product.stock, min = product.minStock, unit = product.unit)
            }
        }
    }
}

@Composable
private fun StockPill(stock: Double, min: Double, unit: String?) {
    val low = min > 0 && stock <= min
    val empty = stock <= 0
    val color = when {
        empty -> Red600
        low -> Orange600
        else -> Gray500
    }
    val bg = when {
        empty -> Color(0xFFFEF2F2)
        low -> Orange50
        else -> Gray100
    }
    val label = buildString {
        append(trimStock(stock))
        unit?.takeIf { it.isNotBlank() }?.let { append(" $it") }
    }
    Box(
        Modifier
            .padding(top = 4.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(bg)
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
            Icon(Icons.Outlined.Inventory2, null, tint = Gray400, modifier = Modifier.size(48.dp))
            Spacer(Modifier.height(12.dp))
            Text("Товаров не найдено", color = Gray500, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            Text("Попробуйте другой запрос", color = Gray400, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

private fun formatMoney(value: Double): String {
    val rounded = value.toLong()
    val s = rounded.toString().reversed().chunked(3).joinToString(" ").reversed()
    return "$s ₽"
}

private fun trimStock(v: Double): String {
    return if (v % 1.0 == 0.0) v.toLong().toString() else "%.2f".format(v).trimEnd('0').trimEnd('.')
}

private fun pluralProducts(n: Int): String {
    val mod10 = n % 10
    val mod100 = n % 100
    return when {
        mod100 in 11..14 -> "товаров"
        mod10 == 1 -> "товар"
        mod10 in 2..4 -> "товара"
        else -> "товаров"
    }
}
