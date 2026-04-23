package com.autexa.app.ui.screens.checks

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.autexa.app.data.network.models.CheckListItem
import com.autexa.app.data.repo.ChecksRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ChecksUiState(
    val items: List<CheckListItem> = emptyList(),
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    val errorMessage: String? = null,
)

@HiltViewModel
class ChecksViewModel @Inject constructor(
    private val repo: ChecksRepository,
) : ViewModel() {
    private val _ui = MutableStateFlow(ChecksUiState())
    val ui: StateFlow<ChecksUiState> = _ui.asStateFlow()

    init { load(initial = true) }

    fun refresh() = load(initial = false)

    private fun load(initial: Boolean) {
        viewModelScope.launch {
            _ui.value = _ui.value.copy(
                isLoading = initial,
                isRefreshing = !initial,
                errorMessage = null,
            )
            repo.getList(page = 1, limit = 100)
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
