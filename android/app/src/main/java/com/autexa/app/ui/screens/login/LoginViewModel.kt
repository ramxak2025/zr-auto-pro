package com.autexa.app.ui.screens.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.autexa.app.data.repo.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class LoginUiState(
    val phone: String = "",
    val password: String = "",
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    val isLoginSuccessful: Boolean = false,
)

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepo: AuthRepository,
) : ViewModel() {
    private val _ui = MutableStateFlow(LoginUiState())
    val ui: StateFlow<LoginUiState> = _ui.asStateFlow()

    fun onPhoneChange(v: String) { _ui.value = _ui.value.copy(phone = v, errorMessage = null) }
    fun onPasswordChange(v: String) { _ui.value = _ui.value.copy(password = v, errorMessage = null) }

    fun login() {
        val s = _ui.value
        if (s.phone.isBlank() || s.password.isBlank()) {
            _ui.value = s.copy(errorMessage = "Введите телефон и пароль")
            return
        }
        _ui.value = s.copy(isLoading = true, errorMessage = null)
        viewModelScope.launch {
            authRepo.login(s.phone.trim(), s.password)
                .onSuccess { _ui.value = _ui.value.copy(isLoading = false, isLoginSuccessful = true) }
                .onFailure { err ->
                    _ui.value = _ui.value.copy(
                        isLoading = false,
                        errorMessage = err.message ?: "Ошибка входа",
                    )
                }
        }
    }

    fun clearError() { _ui.value = _ui.value.copy(errorMessage = null) }
}
