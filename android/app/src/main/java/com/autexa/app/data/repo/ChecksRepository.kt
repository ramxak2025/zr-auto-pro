package com.autexa.app.data.repo

import com.autexa.app.data.network.ChecksApi
import com.autexa.app.data.network.models.CheckListItem
import com.autexa.app.data.network.models.DashboardChart
import com.autexa.app.data.network.models.DashboardStats
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ChecksRepository @Inject constructor(
    private val api: ChecksApi,
) {
    suspend fun getDashboard(): Result<DashboardStats> = runCatching { api.getDashboard() }

    suspend fun getDashboardChart(
        period: String = "week",
        offset: Int = 0,
    ): Result<DashboardChart> = runCatching { api.getDashboardChart(period, offset) }

    suspend fun getList(page: Int = 1, limit: Int = 50): Result<List<CheckListItem>> =
        runCatching { api.getList(limit = limit, page = page).data }
}
