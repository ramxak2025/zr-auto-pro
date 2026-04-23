package com.autexa.app.data.repo

import com.autexa.app.data.local.TokenStore
import com.autexa.app.data.network.AuthApi
import com.autexa.app.data.network.models.LoginRequest
import com.autexa.app.data.network.models.User
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthRepository @Inject constructor(
    private val api: AuthApi,
    private val tokenStore: TokenStore,
) {
    /** Emits true when a token is saved; UI uses this to pick login vs home flow. */
    val isAuthenticated: Flow<Boolean> = tokenStore.tokenFlow.map { !it.isNullOrBlank() }

    suspend fun login(phone: String, password: String): Result<User> = runCatching {
        val response = api.login(LoginRequest(phone, password))
        tokenStore.saveToken(response.token)
        response.user
    }

    suspend fun me(): Result<User> = runCatching { api.me() }

    suspend fun logout() {
        runCatching { api.logout() } // fire-and-forget server side
        tokenStore.clear()
    }
}
