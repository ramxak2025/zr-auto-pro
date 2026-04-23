package com.autexa.app.ui.screens.clients

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.autexa.app.data.network.models.Client
import com.autexa.app.data.repo.ClientsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ClientsUiState(
    val items: List<Client> = emptyList(),
    val search: String = "",
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    val errorMessage: String? = null,
)

@HiltViewModel
class ClientsViewModel @Inject constructor(
    private val repo: ClientsRepository,
) : ViewModel() {
    private val _ui = MutableStateFlow(ClientsUiState())
    val ui: StateFlow<ClientsUiState> = _ui.asStateFlow()

    private var searchJob: Job? = null

    init { load(initial = true, query = "") }

    fun refresh() = load(initial = false, query = _ui.value.search)

    fun onSearchChange(q: String) {
        _ui.value = _ui.value.copy(search = q)
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(300)
            load(initial = false, query = q)
        }
    }

    private fun load(initial: Boolean, query: String) {
        viewModelScope.launch {
            _ui.value = _ui.value.copy(
                isLoading = initial,
                isRefreshing = !initial && _ui.value.items.isNotEmpty(),
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
