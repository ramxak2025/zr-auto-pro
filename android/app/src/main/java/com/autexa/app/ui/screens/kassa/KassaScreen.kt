package com.autexa.app.ui.screens.kassa

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Receipt
import androidx.compose.runtime.Composable
import com.autexa.app.ui.screens.common.PlaceholderScreen
import com.autexa.app.ui.theme.BrandBlue50
import com.autexa.app.ui.theme.BrandBlue600

@Composable
fun KassaScreen() {
    PlaceholderScreen(
        title = "Касса",
        subtitle = "Новый чек",
        description = "Оформление заказ-наряда: товары, услуги, оплата.\nЭкран в разработке.",
        icon = Icons.Outlined.Receipt,
        bg = BrandBlue50, tint = BrandBlue600,
    )
}
