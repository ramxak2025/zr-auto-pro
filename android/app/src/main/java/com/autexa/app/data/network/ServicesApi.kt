package com.autexa.app.data.network

import com.autexa.app.data.network.models.PaginatedServices
import retrofit2.http.GET
import retrofit2.http.Query

interface ServicesApi {
    @GET("services")
    suspend fun getList(
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 200,
        @Query("search") search: String? = null,
    ): PaginatedServices
}
