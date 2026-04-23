package com.autexa.app.ui.screens.home

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AttachMoney
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.PeopleAlt
import androidx.compose.material.icons.outlined.TrendingUp
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import com.autexa.app.ui.components.ModuleIcon
import com.autexa.app.ui.theme.Blue50
import com.autexa.app.ui.theme.Blue600
import com.autexa.app.ui.theme.BrandBlue500
import com.autexa.app.ui.theme.BrandBlue700
import com.autexa.app.ui.theme.Gray400
import com.autexa.app.ui.theme.Gray500
import com.autexa.app.ui.theme.Gray900
import com.autexa.app.ui.theme.Green50
import com.autexa.app.ui.theme.Green600
import com.autexa.app.ui.theme.Orange50
import com.autexa.app.ui.theme.Orange600
import com.autexa.app.ui.theme.Purple50
import com.autexa.app.ui.theme.Purple600
import java.util.Calendar

@Composable
fun HomeScreen(vm: HomeViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsState()
    val greeting = remember { greetingForHour(Calendar.getInstance().get(Calendar.HOUR_OF_DAY)) }
    val firstName = ui.user?.fullName?.substringBefore(' ').orEmpty()

    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        LazyColumn(
            contentPadding = PaddingValues(
                start = 16.dp, end = 16.dp,
                top = 0.dp, bottom = 96.dp,
            ),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.fillMaxSize().statusBarsPadding(),
        ) {
            item { Spacer(Modifier.height(8.dp)) }

            // Hero greeting card with brand gradient
            item {
                HeroCard(greeting = greeting, name = firstName.ifBlank { "" })
            }

            item {
                SectionTitle("Сегодня")
            }

            // 2×2 KPI grid
            item {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        KpiCard(
                            modifier = Modifier.weight(1f),
                            label = "Выручка",
                            value = "—",
                            icon = Icons.Outlined.AttachMoney,
                            bg = Green50, tint = Green600,
                        )
                        KpiCard(
                            modifier = Modifier.weight(1f),
                            label = "Чеки",
                            value = "—",
                            icon = Icons.Outlined.Description,
                            bg = Blue50, tint = Blue600,
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        KpiCard(
                            modifier = Modifier.weight(1f),
                            label = "Прибыль",
                            value = "—",
                            icon = Icons.Outlined.TrendingUp,
                            bg = Purple50, tint = Purple600,
                        )
                        KpiCard(
                            modifier = Modifier.weight(1f),
                            label = "Клиенты",
                            value = "—",
                            icon = Icons.Outlined.PeopleAlt,
                            bg = Orange50, tint = Orange600,
                        )
                    }
                }
            }

            item {
                SectionTitle("Скоро")
            }

            item {
                Surface(
                    color = Color.White,
                    shape = RoundedCornerShape(20.dp),
                    shadowElevation = 2.dp,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Графики, расписание и быстрые действия", color = Gray900, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                        Text(
                            "Дашборд с реальными цифрами появится в следующей итерации. Сейчас доступны: Касса, Журнал, Склад и все модули в Ещё.",
                            color = Gray500, fontSize = 13.sp,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text = text,
        color = Gray500,
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(start = 4.dp),
    )
}

@Composable
private fun HeroCard(greeting: String, name: String) {
    Box(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(24.dp))
            .background(
                Brush.linearGradient(listOf(BrandBlue500, BrandBlue700)),
            )
            .padding(20.dp),
    ) {
        Column {
            Text(greeting, color = Color.White.copy(alpha = 0.85f), fontSize = 13.sp)
            Spacer(Modifier.height(4.dp))
            Text(
                if (name.isBlank()) "Добро пожаловать" else name,
                color = Color.White,
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(12.dp))
            Text(
                "Готовы оформить заказ-наряд?",
                color = Color.White.copy(alpha = 0.85f),
                fontSize = 14.sp,
            )
        }
    }
}

@Composable
private fun KpiCard(
    modifier: Modifier = Modifier,
    label: String,
    value: String,
    icon: ImageVector,
    bg: Color,
    tint: Color,
) {
    Surface(
        color = Color.White,
        shape = RoundedCornerShape(20.dp),
        shadowElevation = 2.dp,
        modifier = modifier,
    ) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            ModuleIcon(icon = icon, bg = bg, tint = tint, size = 36.dp, iconSize = 18.dp, cornerRadius = 10.dp)
            Text(value, color = Gray900, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Text(label, color = Gray500, fontSize = 12.sp)
        }
    }
}

private fun greetingForHour(h: Int): String = when {
    h in 5..11 -> "Доброе утро"
    h in 12..16 -> "Добрый день"
    h in 17..21 -> "Добрый вечер"
    else -> "Доброй ночи"
}
