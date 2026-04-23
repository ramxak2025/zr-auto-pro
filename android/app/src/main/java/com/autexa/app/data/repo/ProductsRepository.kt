package com.autexa.app.data.repo

import com.autexa.app.data.network.ProductsApi
import com.autexa.app.data.network.models.Product
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ProductsRepository @Inject constructor(
    private val api: ProductsApi,
) {
    suspend fun getList(search: String? = null): Result<List<Product>> = runCatching {
        api.getList(page = 1, limit = 200, search = search?.ifBlank { null }).data
    }
}
