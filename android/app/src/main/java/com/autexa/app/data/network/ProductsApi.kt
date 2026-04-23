package com.autexa.app.data.network

import com.autexa.app.data.network.models.PaginatedProducts
import retrofit2.http.GET
import retrofit2.http.Query

interface ProductsApi {
    @GET("products")
    suspend fun getList(
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 100,
        @Query("search") search: String? = null,
    ): PaginatedProducts
}
