package com.autexa.app.data.network.models

import kotlinx.serialization.Serializable

@Serializable
data class Client(
    val id: String,
    val fullName: String = "",
    val phone: String = "",
    val comment: String? = null,
    val createdAt: String = "",
)

@Serializable
data class PaginatedClients(
    val data: List<Client> = emptyList(),
    val total: Int = 0,
    val page: Int = 1,
    val limit: Int = 50,
)
