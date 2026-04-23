package com.autexa.app.data.repo

import com.autexa.app.data.network.ScheduleApi
import com.autexa.app.data.network.models.TodayEmployeeStatus
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ScheduleRepository @Inject constructor(
    private val api: ScheduleApi,
) {
    suspend fun getToday(): Result<List<TodayEmployeeStatus>> = runCatching { api.getToday() }
}
