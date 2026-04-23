package com.autexa.app.ui.screens.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.autexa.app.data.network.models.DashboardStats
import com.autexa.app.data.network.models.User
import com.autexa.app.data.repo.AuthRepository
import com.autexa.app.data.repo.ChecksRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class HomeUiState(
    val user: User? = null,
    val stats: DashboardStats? = null,
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    val errorMessage: String? = null,
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val authRepo: AuthRepository,
    private val checksRepo: ChecksRepository,
) : ViewModel() {
    private val _ui = MutableStateFlow(HomeUiState())
    val ui: StateFlow<HomeUiState> = _ui.asStateFlow()

    init { load(initial = true) }

    fun refresh() = load(initial = false)

    private fun load(initial: Boolean) {
        viewModelScope.launch {
            _ui.value = _ui.value.copy(
                isLoading = initial,
                isRefreshing = !initial,
                errorMessage = null,
            )
            val userRes = authRepo.me()
            val statsRes = checksRepo.getDashboard()
            _ui.value = _ui.value.copy(
                user = userRes.getOrNull() ?: _ui.value.user,
                stats = statsRes.getOrNull() ?: _ui.value.stats,
                isLoading = false,
                isRefreshing = false,
                errorMessage = listOfNotNull(
                    statsRes.exceptionOrNull()?.message,
                ).firstOrNull(),
            )
        }
    }
}
