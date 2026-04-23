package com.autexa.app.ui.screens.kassa

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Receipt
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autexa.app.ui.theme.BrandBlue500
import com.autexa.app.ui.theme.BrandBlue700
import com.autexa.app.ui.theme.Gray500
import com.autexa.app.ui.theme.Gray900

@Composable
fun KassaScreen() {
    Box(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .statusBarsPadding()
            .padding(16.dp),
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            com.autexa.app.ui.components.ScreenTitle(
                title = "Касса",
                subtitle = "Оформление нового заказ-наряда",
                modifier = Modifier.padding(top = 4.dp),
            )

            // Hero card
            Box(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(24.dp))
                    .background(Brush.linearGradient(listOf(BrandBlue500, BrandBlue700)))
                    .padding(20.dp),
            ) {
                Column {
                    Box(
                        Modifier
                            .size(48.dp)
                            .clip(RoundedCornerShape(14.dp))
                            .background(Color.White.copy(alpha = 0.18f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Outlined.Receipt, null, tint = Color.White, modifier = Modifier.size(26.dp))
                    }
                    Spacer(Modifier.height(14.dp))
                    Text("Новый чек", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    Text(
                        "Добавление товаров, услуг, оформление оплаты — экран готовится. Пока создавайте чеки в PWA, они сразу появятся в Журнале.",
                        color = Color.White.copy(alpha = 0.85f),
                        fontSize = 13.sp,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
            }

            // Secondary card — checklist of what will come
            Surface(
                color = Color.White,
                shape = RoundedCornerShape(20.dp),
                shadowElevation = 2.dp,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Что войдёт", color = Gray900, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                    FeatureLine("Поиск товаров и услуг")
                    FeatureLine("Корзина с расчётом итога и прибыли")
                    FeatureLine("Привязка клиента и авто, номер по маске")
                    FeatureLine("Оплата — наличные / карта / смешанная / гарантия")
                    FeatureLine("Отложенные чеки и доработка")
                }
            }
        }
    }
}

@Composable
private fun FeatureLine(text: String) {
    androidx.compose.foundation.layout.Row(
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(6.dp)
                .clip(androidx.compose.foundation.shape.CircleShape)
                .background(BrandBlue500),
        )
        Spacer(Modifier.padding(horizontal = 6.dp))
        Text(text, color = Gray500, fontSize = 13.sp, textAlign = TextAlign.Start)
    }
}
