package com.autexa.app.data.network.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class TodayEmployeeStatus(
    @SerialName("userId") val userId: String,
    @SerialName("fullName") val fullName: String = "",
    val role: String = "",
    @SerialName("isDayOff") val isDayOff: Boolean = false,
    @SerialName("shiftStart") val shiftStart: String? = null,
    @SerialName("shiftEnd") val shiftEnd: String? = null,
    @SerialName("actualArrival") val actualArrival: String? = null,
    @SerialName("lateMinutes") val lateMinutes: Int = 0,
    @SerialName("lateStatus") val lateStatus: String? = null,
    val note: String? = null,
    @SerialName("isWorking") val isWorking: Boolean = false,
    @SerialName("hasSchedule") val hasSchedule: Boolean = false,
)
