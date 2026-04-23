package com.autexa.app.ui.screens.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.autexa.app.data.network.models.DashboardStats
import com.autexa.app.data.network.models.Shift
import com.autexa.app.data.network.models.User
import com.autexa.app.data.repo.AuthRepository
import com.autexa.app.data.repo.ChecksRepository
import com.autexa.app.data.repo.ShiftsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class HomeUiState(
    val user: User? = null,
    val stats: DashboardStats? = null,
    val currentShift: Shift? = null,
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    val isShiftBusy: Boolean = false,
    val errorMessage: String? = null,
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val authRepo: AuthRepository,
    private val checksRepo: ChecksRepository,
    private val shiftsRepo: ShiftsRepository,
) : ViewModel() {
    private val _ui = MutableStateFlow(HomeUiState())
    val ui: StateFlow<HomeUiState> = _ui.asStateFlow()

    init { load(initial = true) }

    fun refresh() = load(initial = false)

    fun openShift() {
        viewModelScope.launch {
            _ui.value = _ui.value.copy(isShiftBusy = true)
            shiftsRepo.open()
                .onSuccess { _ui.value = _ui.value.copy(currentShift = it, isShiftBusy = false) }
                .onFailure { _ui.value = _ui.value.copy(isShiftBusy = false, errorMessage = it.message) }
        }
    }

    fun closeShift() {
        val s = _ui.value.currentShift ?: return
        viewModelScope.launch {
            _ui.value = _ui.value.copy(isShiftBusy = true)
            shiftsRepo.close(s.id)
                .onSuccess { _ui.value = _ui.value.copy(currentShift = null, isShiftBusy = false) }
                .onFailure { _ui.value = _ui.value.copy(isShiftBusy = false, errorMessage = it.message) }
        }
    }

    private fun load(initial: Boolean) {
        viewModelScope.launch {
            _ui.value = _ui.value.copy(
                isLoading = initial,
                isRefreshing = !initial,
                errorMessage = null,
            )
            val userRes = authRepo.me()
            val statsRes = checksRepo.getDashboard()
            val shiftsRes = shiftsRepo.getMy()

            val open = shiftsRes.getOrNull()?.firstOrNull { it.closedAt.isNullOrBlank() }

            _ui.value = _ui.value.copy(
                user = userRes.getOrNull() ?: _ui.value.user,
                stats = statsRes.getOrNull() ?: _ui.value.stats,
                currentShift = open,
                isLoading = false,
                isRefreshing = false,
                errorMessage = statsRes.exceptionOrNull()?.message,
            )
        }
    }
}
