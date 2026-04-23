package com.autexa.app.data.network

import com.autexa.app.data.network.models.Shift
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

interface ShiftsApi {
    @GET("shifts/my")
    suspend fun getMy(): List<Shift>

    @POST("shifts/open")
    suspend fun open(): Shift

    @POST("shifts/{id}/close")
    suspend fun close(@Path("id") id: String): Shift
}
