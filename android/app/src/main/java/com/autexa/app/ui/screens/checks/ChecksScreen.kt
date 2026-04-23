package com.autexa.app.ui.screens.checks

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Description
import androidx.compose.runtime.Composable
import com.autexa.app.ui.screens.common.PlaceholderScreen
import com.autexa.app.ui.theme.Indigo50
import com.autexa.app.ui.theme.Indigo600

@Composable
fun ChecksScreen() {
    PlaceholderScreen(
        title = "Журнал",
        subtitle = "Заказ-наряды",
        description = "История чеков, фильтры, поиск.\nСкоро.",
        icon = Icons.Outlined.Description,
        bg = Indigo50, tint = Indigo600,
    )
}
