package com.autexa.app.data.network

import com.autexa.app.data.network.models.LoginRequest
import com.autexa.app.data.network.models.LoginResponse
import com.autexa.app.data.network.models.User
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

interface AuthApi {
    @POST("auth/login")
    suspend fun login(@Body req: LoginRequest): LoginResponse

    @GET("auth/me")
    suspend fun me(): User

    @POST("auth/logout")
    suspend fun logout(): Map<String, String>
}
