package com.autexa.app.data.network

import com.autexa.app.data.network.models.TodayEmployeeStatus
import retrofit2.http.GET

interface ScheduleApi {
    @GET("schedule/today")
    suspend fun getToday(): List<TodayEmployeeStatus>
}
