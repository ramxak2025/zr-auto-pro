package com.autexa.app.ui.screens.more

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AdminPanelSettings
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.Business
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.CardMembership
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.DirectionsCar
import androidx.compose.material.icons.outlined.LocalShipping
import androidx.compose.material.icons.outlined.Logout
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.SwapHoriz
import androidx.compose.material.icons.outlined.TrendingDown
import androidx.compose.material.icons.outlined.ViewInAr
import androidx.compose.material.icons.outlined.Wallet
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.autexa.app.ui.components.ModuleIcon
import com.autexa.app.ui.theme.Amber50
import com.autexa.app.ui.theme.Amber600
import com.autexa.app.ui.theme.Blue50
import com.autexa.app.ui.theme.Blue600
import com.autexa.app.ui.theme.BrandBlue100
import com.autexa.app.ui.theme.BrandBlue50
import com.autexa.app.ui.theme.BrandBlue600
import com.autexa.app.ui.theme.BrandBlue700
import com.autexa.app.ui.theme.Emerald50
import com.autexa.app.ui.theme.Emerald700
import com.autexa.app.ui.theme.Gray100
import com.autexa.app.ui.theme.Gray400
import com.autexa.app.ui.theme.Gray500
import com.autexa.app.ui.theme.Gray900
import com.autexa.app.ui.theme.Green50
import com.autexa.app.ui.theme.Green700
import com.autexa.app.ui.theme.Indigo50
import com.autexa.app.ui.theme.Indigo600
import com.autexa.app.ui.theme.Orange50
import com.autexa.app.ui.theme.Orange600
import com.autexa.app.ui.theme.Purple50
import com.autexa.app.ui.theme.Purple600
import com.autexa.app.ui.theme.Purple700
import com.autexa.app.ui.theme.Red50
import com.autexa.app.ui.theme.Red600
import com.autexa.app.ui.theme.Rose50
import com.autexa.app.ui.theme.Rose600
import com.autexa.app.ui.theme.Slate100
import com.autexa.app.ui.theme.Slate600
import com.autexa.app.ui.theme.Teal50
import com.autexa.app.ui.theme.Teal600
import com.autexa.app.ui.theme.Violet50
import com.autexa.app.ui.theme.Violet600

private data class MenuItem(
    val label: String,
    val description: String,
    val icon: ImageVector,
    val bg: Color,
    val tint: Color,
    /** Route key into MoreTab nested navigation; null → "coming soon". */
    val route: String? = null,
)

private val menuItems = listOf(
    MenuItem("Расписание", "График работы и смены", Icons.Outlined.CalendarMonth, Indigo50, Indigo600, route = "schedule"),
    MenuItem("Клиенты", "База клиентов", Icons.Outlined.People, Blue50, Blue600, route = "clients"),
    MenuItem("Автомобили", "Все автомобили клиентов", Icons.Outlined.DirectionsCar, Blue50, Blue600),
    MenuItem("Услуги", "Каталог услуг", Icons.Outlined.Build, Orange50, Orange600, route = "services"),
    MenuItem("Поставщики", "Поставки и расчёты", Icons.Outlined.LocalShipping, Amber50, Amber600),
    MenuItem("Движение денег", "Касса по дням и сотрудникам", Icons.Outlined.SwapHoriz, Teal50, Teal600),
    MenuItem("Зарплата", "Заработок мастеров", Icons.Outlined.Wallet, Green50, Green700),
    MenuItem("Расходы", "Аренда, маркетинг и др.", Icons.Outlined.TrendingDown, Rose50, Rose600),
    MenuItem("Отчёты", "Финансовые отчёты", Icons.Outlined.BarChart, Purple50, Purple700),
    MenuItem("Звонки", "Журнал звонков и записи", Icons.Outlined.Call, Blue50, Blue600),
    MenuItem("Имущество", "Инструменты и оборудование", Icons.Outlined.ViewInAr, Emerald50, Emerald700),
    MenuItem("Маркетинг", "Отзывы и рассылки", Icons.Outlined.Campaign, Violet50, Violet600),
    MenuItem("Пользователи", "Управление доступом", Icons.Outlined.Shield, Indigo50, Indigo600),
    MenuItem("Настройки компании", "Реквизиты и данные для чеков", Icons.Outlined.Business, Slate100, Slate600),
    MenuItem("Подписка", "Тариф и оплата", Icons.Outlined.CardMembership, BrandBlue50, BrandBlue600),
    MenuItem("Админ-панель", "Тенанты и планы", Icons.Outlined.AdminPanelSettings, Red50, Red600),
)

private val roleLabels = mapOf(
    "superadmin" to "Суперадмин",
    "director" to "Владелец",
    "admin" to "Администратор",
    "master" to "Мастер",
)

@Composable
fun MoreScreen(
    onLogout: () -> Unit,
    onOpenRoute: (String) -> Unit = {},
    vm: MoreViewModel = hiltViewModel(),
) {
    val ui by vm.ui.collectAsState()
    val user = ui.user
    val role = user?.role.orEmpty()
    val roleLabel = roleLabels[role] ?: role
    val initial = user?.fullName?.firstOrNull()?.uppercaseChar()?.toString() ?: "U"

    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 0.dp, bottom = 96.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.fillMaxSize().statusBarsPadding(),
        ) {
            item { Spacer(Modifier.height(8.dp)) }

            // User card
            item {
                Surface(
                    color = Color.White,
                    shape = RoundedCornerShape(20.dp),
                    shadowElevation = 3.dp,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        Box(
                            Modifier
                                .size(56.dp)
                                .clip(RoundedCornerShape(20.dp))
                                .background(BrandBlue100),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                initial,
                                color = BrandBlue700,
                                fontSize = 22.sp,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(
                                user?.fullName ?: "Пользователь",
                                color = Gray900,
                                fontSize = 16.sp,
                                fontWeight = FontWeight.Bold,
                            )
                            if (roleLabel.isNotBlank()) {
                                Box(
                                    Modifier
                                        .clip(CircleShape)
                                        .background(roleBadgeBg(role))
                                        .padding(horizontal = 8.dp, vertical = 3.dp),
                                ) {
                                    Text(
                                        roleLabel,
                                        color = roleBadgeText(role),
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.SemiBold,
                                    )
                                }
                            }
                        }
                    }
                }
            }

            // Menu list as a single rounded card with separators
            item {
                Surface(
                    color = Color.White,
                    shape = RoundedCornerShape(20.dp),
                    shadowElevation = 3.dp,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column {
                        menuItems.forEachIndexed { idx, item ->
                            if (idx > 0) {
                                Box(
                                    Modifier
                                        .padding(start = 70.dp)
                                        .fillMaxWidth()
                                        .height(1.dp)
                                        .background(Gray100),
                                )
                            }
                            MenuRow(item) {
                                item.route?.let(onOpenRoute)
                            }
                        }
                    }
                }
            }

            // Logout
            item {
                Surface(
                    color = Color.White,
                    shape = RoundedCornerShape(20.dp),
                    shadowElevation = 2.dp,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { vm.logout(onLogout) },
                ) {
                    Row(
                        modifier = Modifier.padding(vertical = 16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center,
                    ) {
                        Icon(Icons.Outlined.Logout, null, tint = Red600, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.size(8.dp))
                        Text("Выйти из аккаунта", color = Red600, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                    }
                }
            }
        }
    }
}

@Composable
private fun MenuRow(item: MenuItem, onClick: () -> Unit) {
    val available = item.route != null
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = available, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        ModuleIcon(icon = item.icon, bg = item.bg, tint = item.tint)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(item.label, color = if (available) Gray900 else Gray400, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            Text(item.description, color = Gray400, fontSize = 11.sp)
        }
        if (available) {
            Icon(Icons.Outlined.ChevronRight, null, tint = Gray400, modifier = Modifier.size(18.dp))
        } else {
            androidx.compose.foundation.layout.Box(
                Modifier
                    .clip(androidx.compose.foundation.shape.RoundedCornerShape(8.dp))
                    .background(androidx.compose.ui.graphics.Color(0xFFF3F4F6))
                    .padding(horizontal = 8.dp, vertical = 3.dp),
            ) {
                Text("скоро", color = Gray400, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

private fun roleBadgeBg(role: String): Color = when (role) {
    "superadmin" -> Red50
    "director" -> Purple50
    "admin" -> Blue50
    "master" -> Green50
    else -> Gray100
}

private fun roleBadgeText(role: String): Color = when (role) {
    "superadmin" -> Red600
    "director" -> Purple600
    "admin" -> Blue600
    "master" -> Green700
    else -> Gray500
}
