package com.autexa.app.data.repo

import com.autexa.app.data.network.ShiftsApi
import com.autexa.app.data.network.models.Shift
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ShiftsRepository @Inject constructor(
    private val api: ShiftsApi,
) {
    suspend fun getMy(): Result<List<Shift>> = runCatching { api.getMy() }
    suspend fun open(): Result<Shift> = runCatching { api.open() }
    suspend fun close(id: String): Result<Shift> = runCatching { api.close(id) }
}
