package com.autexa.app.data.repo

import com.autexa.app.data.network.ClientsApi
import com.autexa.app.data.network.models.Client
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ClientsRepository @Inject constructor(
    private val api: ClientsApi,
) {
    suspend fun getList(search: String? = null): Result<List<Client>> = runCatching {
        api.getList(page = 1, limit = 200, search = search?.ifBlank { null }).data
    }
}
