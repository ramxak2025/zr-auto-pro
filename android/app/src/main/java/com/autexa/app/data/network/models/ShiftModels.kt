package com.autexa.app.data.network.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Shift(
    val id: String,
    @SerialName("userId") val userId: String,
    val date: String,
    @SerialName("openedAt") val openedAt: String,
    @SerialName("closedAt") val closedAt: String? = null,
    @SerialName("isAutoClosed") val isAutoClosed: Boolean = false,
    val note: String? = null,
)
