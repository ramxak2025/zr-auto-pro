package com.autexa.app.data.repo

import com.autexa.app.data.network.ServicesApi
import com.autexa.app.data.network.models.ServiceItem
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ServicesRepository @Inject constructor(
    private val api: ServicesApi,
) {
    suspend fun getList(search: String? = null): Result<List<ServiceItem>> = runCatching {
        api.getList(page = 1, limit = 200, search = search?.ifBlank { null }).data
    }
}
