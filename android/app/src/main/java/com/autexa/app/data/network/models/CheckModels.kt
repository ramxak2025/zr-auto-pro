package com.autexa.app.data.network.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// ═══════════════════════════════════════════════════════════════════════
//  Dashboard — /api/checks/dashboard
// ═══════════════════════════════════════════════════════════════════════

@Serializable
data class DashboardStats(
    @SerialName("todayRevenue") val todayRevenue: Double = 0.0,
    @SerialName("todayChecks") val todayChecks: Int = 0,
    @SerialName("weekRevenue") val weekRevenue: Double = 0.0,
    @SerialName("monthRevenue") val monthRevenue: Double = 0.0,
    @SerialName("todayProfit") val todayProfit: Double = 0.0,
    @SerialName("monthProfit") val monthProfit: Double = 0.0,
)

// ═══════════════════════════════════════════════════════════════════════
//  Check list — /api/checks (paginated)
//  Only the fields we render on the list screen; extend as we build the
//  check-detail screen.
// ═══════════════════════════════════════════════════════════════════════

@Serializable
data class CheckListItem(
    val id: String,
    val number: Int = 0,
    val date: String = "",
    val masterId: String = "",
    val master: CheckRefUser? = null,
    val client: CheckRefClient? = null,
    val car: CheckRefCar? = null,
    val mileage: Int? = null,
    val paymentMethod: String = "cash",
    @SerialName("totalRevenue") val totalRevenue: Double = 0.0,
    @SerialName("profit") val profit: Double = 0.0,
    @SerialName("cashAmount") val cashAmount: Double = 0.0,
    @SerialName("cardAmount") val cardAmount: Double = 0.0,
    @SerialName("isDeferred") val isDeferred: Boolean = false,
    @SerialName("createdAt") val createdAt: String = "",
)

@Serializable
data class CheckRefUser(
    val id: String = "",
    @SerialName("fullName") val fullName: String = "",
)

@Serializable
data class CheckRefClient(
    val id: String = "",
    @SerialName("fullName") val fullName: String = "",
    val phone: String? = null,
)

@Serializable
data class CheckRefCar(
    val id: String = "",
    val plate: String? = null,
    val brand: String? = null,
    val model: String? = null,
)

@Serializable
data class PaginatedChecks(
    val data: List<CheckListItem> = emptyList(),
    val total: Int = 0,
    val page: Int = 1,
    val limit: Int = 50,
)

// ═══════════════════════════════════════════════════════════════════════
//  Chart — /api/checks/dashboard/chart?period=week&offset=0
// ═══════════════════════════════════════════════════════════════════════

@Serializable
data class DashboardChart(
    val points: List<DashboardChartPoint> = emptyList(),
    @SerialName("totalRevenue") val totalRevenue: Double = 0.0,
    @SerialName("totalProfit") val totalProfit: Double = 0.0,
    @SerialName("totalChecks") val totalChecks: Int = 0,
)

@Serializable
data class DashboardChartPoint(
    val date: String = "",
    val revenue: Double = 0.0,
    val profit: Double = 0.0,
    @SerialName("checkCount") val checkCount: Int = 0,
)
