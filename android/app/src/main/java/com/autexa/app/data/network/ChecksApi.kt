package com.autexa.app.data.network

import com.autexa.app.data.network.models.DashboardChart
import com.autexa.app.data.network.models.DashboardStats
import com.autexa.app.data.network.models.PaginatedChecks
import retrofit2.http.GET
import retrofit2.http.Query

interface ChecksApi {
    @GET("checks/dashboard")
    suspend fun getDashboard(): DashboardStats

    @GET("checks/dashboard/chart")
    suspend fun getDashboardChart(
        @Query("period") period: String = "week",
        @Query("offset") offset: Int = 0,
    ): DashboardChart

    @GET("checks")
    suspend fun getList(
        @Query("limit") limit: Int = 50,
        @Query("page") page: Int = 1,
    ): PaginatedChecks
}
