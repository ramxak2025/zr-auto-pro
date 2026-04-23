package com.autexa.app.ui.main

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.autexa.app.ui.components.KassaButton
import com.autexa.app.ui.screens.checks.ChecksScreen
import com.autexa.app.ui.screens.home.HomeScreen
import com.autexa.app.ui.screens.kassa.KassaScreen
import com.autexa.app.ui.screens.more.MoreScreen
import com.autexa.app.ui.screens.products.ProductsScreen
import com.autexa.app.ui.theme.BrandBlue600
import com.autexa.app.ui.theme.Gray400

private sealed class Tab(val route: String, val label: String, val icon: ImageVector?) {
    object Home : Tab("home", "Главная", Icons.Outlined.Home)
    object Products : Tab("products", "Склад", Icons.Outlined.Inventory2)
    object Kassa : Tab("kassa", "", null)
    object Checks : Tab("checks", "Журнал", Icons.Outlined.Description)
    object More : Tab("more", "Ещё", Icons.Outlined.GridView)
}

private val tabs = listOf(Tab.Home, Tab.Products, Tab.Kassa, Tab.Checks, Tab.More)

@Composable
fun MainScaffold(onLogout: () -> Unit) {
    val nav = rememberNavController()
    val backStack by nav.currentBackStackEntryAsState()
    val current = backStack?.destination?.route

    val openTab: (String) -> Unit = { route ->
        nav.navigate(route) {
            popUpTo(nav.graph.findStartDestination().id) { saveState = true }
            launchSingleTop = true
            restoreState = true
        }
    }

    Box(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        NavHost(
            navController = nav,
            startDestination = Tab.Home.route,
            modifier = Modifier.fillMaxSize(),
        ) {
            composable(Tab.Home.route) { HomeScreen(onOpenTab = openTab) }
            composable(Tab.Products.route) { ProductsScreen() }
            composable(Tab.Kassa.route) { KassaScreen() }
            composable(Tab.Checks.route) { ChecksScreen() }
            composable(Tab.More.route) { MoreScreen(onLogout = onLogout) }
        }

        Column(modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth()) {
            BottomBar(
                current = current,
                onSelect = openTab,
            )
            Box(
                Modifier
                    .fillMaxWidth()
                    .background(Color.White)
                    .windowInsetsBottomHeight(WindowInsets.navigationBars),
            )
        }
    }
}

@Composable
private fun BottomBar(
    current: String?,
    onSelect: (String) -> Unit,
) {
    Surface(
        color = Color.White,
        shadowElevation = 12.dp,
        modifier = Modifier
            .fillMaxWidth()
            .shadow(elevation = 16.dp, clip = false),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(72.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceAround,
        ) {
            tabs.forEach { tab ->
                if (tab is Tab.Kassa) {
                    KassaTabItem(onClick = { onSelect(tab.route) })
                } else {
                    BarItem(
                        selected = current == tab.route,
                        label = tab.label,
                        icon = tab.icon!!,
                        onClick = { onSelect(tab.route) },
                    )
                }
            }
        }
    }
}

@Composable
private fun RowScope.BarItem(
    selected: Boolean,
    label: String,
    icon: ImageVector,
    onClick: () -> Unit,
) {
    val tint = if (selected) BrandBlue600 else Gray400
    val interaction = remember { MutableInteractionSource() }
    Column(
        modifier = Modifier
            .weight(1f)
            .fillMaxSize()
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(top = 10.dp, bottom = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(icon, contentDescription = label, tint = tint, modifier = Modifier.height(22.dp))
        Text(
            text = label,
            color = tint,
            fontSize = 10.sp,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
        )
    }
}

@Composable
private fun RowScope.KassaTabItem(onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    Box(
        modifier = Modifier
            .weight(1f)
            .fillMaxSize()
            .clickable(interactionSource = interaction, indication = null, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Box(modifier = Modifier.padding(bottom = 6.dp)) {
            KassaButton()
        }
    }
}
