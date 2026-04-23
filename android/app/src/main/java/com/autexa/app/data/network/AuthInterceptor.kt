package com.autexa.app.data.network

import com.autexa.app.data.local.TokenStore
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject

/**
 * OkHttp interceptor that attaches the JWT Bearer token to every request
 * (except explicitly public endpoints like /auth/login, /auth/register).
 */
class AuthInterceptor @Inject constructor(
    private val tokenStore: TokenStore,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val path = original.url.encodedPath
        val isPublic = path.endsWith("/auth/login") || path.endsWith("/auth/register")

        if (isPublic) return chain.proceed(original)

        val token = runBlocking { tokenStore.getToken() }
        val request = if (token.isNullOrBlank()) {
            original
        } else {
            original.newBuilder()
                .addHeader("Authorization", "Bearer $token")
                .build()
        }
        return chain.proceed(request)
    }
}
