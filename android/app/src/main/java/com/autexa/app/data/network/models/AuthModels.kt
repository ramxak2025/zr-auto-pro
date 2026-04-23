package com.autexa.app.data.network.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// ═══════════════════════════════════════════════════════════════════════
//  Auth — request / response models matching NestJS /api/auth contract
// ═══════════════════════════════════════════════════════════════════════

@Serializable
data class LoginRequest(
    val phone: String,
    val password: String,
)

@Serializable
data class LoginResponse(
    val token: String,
    val user: User,
)

@Serializable
data class User(
    val id: String,
    val phone: String,
    @SerialName("fullName") val fullName: String,
    val role: String,
    val avatar: String? = null,
    @SerialName("salaryPercent") val salaryPercent: Double = 0.0,
    val permissions: Permissions? = null,
    @SerialName("isActive") val isActive: Boolean = true,
    @SerialName("tenantId") val tenantId: String? = null,
    val tenant: Tenant? = null,
)

@Serializable
data class Tenant(
    val id: String,
    val name: String,
    val slug: String? = null,
    val phone: String? = null,
    val address: String? = null,
    val email: String? = null,
    @SerialName("isActive") val isActive: Boolean = true,
    @SerialName("maxUsers") val maxUsers: Int = 10,
    @SerialName("subscriptionEnd") val subscriptionEnd: String? = null,
)

@Serializable
data class Permissions(
    @SerialName("checks_view") val checksView: Boolean = false,
    @SerialName("checks_create") val checksCreate: Boolean = false,
    @SerialName("checks_edit") val checksEdit: Boolean = false,
    @SerialName("checks_delete") val checksDelete: Boolean = false,
    @SerialName("profit_view") val profitView: Boolean = false,
    @SerialName("clients_view") val clientsView: Boolean = false,
    @SerialName("clients_edit") val clientsEdit: Boolean = false,
    @SerialName("warehouse_access") val warehouseAccess: Boolean = false,
    @SerialName("suppliers_access") val suppliersAccess: Boolean = false,
    @SerialName("financial_reports") val financialReports: Boolean = false,
    @SerialName("export_data") val exportData: Boolean = false,
    @SerialName("user_management") val userManagement: Boolean = false,
    @SerialName("schedule_view") val scheduleView: Boolean = false,
    @SerialName("salary_view") val salaryView: Boolean = false,
    @SerialName("marketing_access") val marketingAccess: Boolean = false,
)
