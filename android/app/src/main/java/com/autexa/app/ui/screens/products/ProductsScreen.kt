package com.autexa.app.ui.screens.products

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.runtime.Composable
import com.autexa.app.ui.screens.common.PlaceholderScreen
import com.autexa.app.ui.theme.Orange50
import com.autexa.app.ui.theme.Orange600

@Composable
fun ProductsScreen() {
    PlaceholderScreen(
        title = "Склад",
        subtitle = "Товары и остатки",
        description = "Каталог товаров и контроль остатков.\nСкоро появится — синхронизация с PWA в работе.",
        icon = Icons.Outlined.Inventory2,
        bg = Orange50, tint = Orange600,
    )
}
