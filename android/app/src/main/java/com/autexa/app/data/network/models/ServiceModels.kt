package com.autexa.app.data.network.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class ServiceItem(
    val id: String,
    val name: String = "",
    val category: String? = null,
    @SerialName("defaultPrice") val defaultPrice: Double = 0.0,
    @SerialName("masterPercent") val masterPercent: Double? = null,
)

@Serializable
data class PaginatedServices(
    val data: List<ServiceItem> = emptyList(),
    val total: Int = 0,
    val page: Int = 1,
    val limit: Int = 50,
)
