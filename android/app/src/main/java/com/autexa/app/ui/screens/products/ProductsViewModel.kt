package com.autexa.app.ui.screens.products

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.autexa.app.data.network.models.Product
import com.autexa.app.data.repo.ProductsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ProductsUiState(
    val items: List<Product> = emptyList(),
    val search: String = "",
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    val errorMessage: String? = null,
)

@HiltViewModel
class ProductsViewModel @Inject constructor(
    private val repo: ProductsRepository,
) : ViewModel() {
    private val _ui = MutableStateFlow(ProductsUiState())
    val ui: StateFlow<ProductsUiState> = _ui.asStateFlow()

    private var searchJob: Job? = null

    init { load(initial = true, query = "") }

    fun refresh() = load(initial = false, query = _ui.value.search)

    fun onSearchChange(q: String) {
        _ui.value = _ui.value.copy(search = q)
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(300) // debounce
            load(initial = false, query = q)
        }
    }

    private fun load(initial: Boolean, query: String) {
        viewModelScope.launch {
            _ui.value = _ui.value.copy(
                isLoading = initial,
                isRefreshing = !initial && _ui.value.items.isEmpty().not(),
                errorMessage = null,
            )
            repo.getList(query)
                .onSuccess {
                    _ui.value = _ui.value.copy(
                        items = it,
                        isLoading = false,
                        isRefreshing = false,
                    )
                }
                .onFailure {
                    _ui.value = _ui.value.copy(
                        isLoading = false,
                        isRefreshing = false,
                        errorMessage = it.message,
                    )
                }
        }
    }
}
