package com.autexa.app.ui.screens.schedule

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.autexa.app.data.network.models.TodayEmployeeStatus
import com.autexa.app.data.repo.ScheduleRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ScheduleUiState(
    val items: List<TodayEmployeeStatus> = emptyList(),
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    val errorMessage: String? = null,
)

@HiltViewModel
class ScheduleViewModel @Inject constructor(
    private val repo: ScheduleRepository,
) : ViewModel() {
    private val _ui = MutableStateFlow(ScheduleUiState())
    val ui: StateFlow<ScheduleUiState> = _ui.asStateFlow()

    init { load(initial = true) }

    fun refresh() = load(initial = false)

    private fun load(initial: Boolean) {
        viewModelScope.launch {
            _ui.value = _ui.value.copy(
                isLoading = initial,
                isRefreshing = !initial,
                errorMessage = null,
            )
            repo.getToday()
                .onSuccess {
                    _ui.value = _ui.value.copy(
                        items = it, isLoading = false, isRefreshing = false,
                    )
                }
                .onFailure {
                    _ui.value = _ui.value.copy(
                        isLoading = false, isRefreshing = false,
                        errorMessage = it.message,
                    )
                }
        }
    }
}
