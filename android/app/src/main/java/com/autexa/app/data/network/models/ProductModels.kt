package com.autexa.app.data.network.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Product(
    val id: String,
    val name: String,
    val category: String? = null,
    val photo: String? = null,
    @SerialName("costPrice") val costPrice: Double = 0.0,
    @SerialName("sellPrice") val sellPrice: Double = 0.0,
    val stock: Double = 0.0,
    @SerialName("minStock") val minStock: Double = 0.0,
    val unit: String? = null,
    @SerialName("isBundle") val isBundle: Boolean = false,
    @SerialName("supplierId") val supplierId: String? = null,
)

@Serializable
data class PaginatedProducts(
    val data: List<Product> = emptyList(),
    val total: Int = 0,
    val page: Int = 1,
    val limit: Int = 50,
)
