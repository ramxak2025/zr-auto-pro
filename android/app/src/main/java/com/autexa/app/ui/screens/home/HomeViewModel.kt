package com.autexa.app.ui.screens.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.autexa.app.data.network.models.User
import com.autexa.app.data.repo.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class HomeUiState(
    val user: User? = null,
    val isLoading: Boolean = true,
    val isLoggedOut: Boolean = false,
    val errorMessage: String? = null,
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val authRepo: AuthRepository,
) : ViewModel() {
    private val _ui = MutableStateFlow(HomeUiState())
    val ui: StateFlow<HomeUiState> = _ui.asStateFlow()

    init { loadMe() }

    private fun loadMe() {
        viewModelScope.launch {
            authRepo.me()
                .onSuccess { _ui.value = _ui.value.copy(user = it, isLoading = false) }
                .onFailure { _ui.value = _ui.value.copy(isLoading = false, errorMessage = it.message) }
        }
    }

    fun logout() {
        viewModelScope.launch {
            authRepo.logout()
            _ui.value = _ui.value.copy(isLoggedOut = true)
        }
    }
}
