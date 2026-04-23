package com.autexa.app.ui.screens.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.autexa.app.data.repo.AuthRepository
import com.autexa.app.util.PhoneFormatter
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
    val phoneError: String? = null,
    val passwordError: String? = null,
    val errorMessage: String? = null,
    val isLoginSuccessful: Boolean = false,
)

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepo: AuthRepository,
) : ViewModel() {
    private val _ui = MutableStateFlow(LoginUiState())
    val ui: StateFlow<LoginUiState> = _ui.asStateFlow()

    /** Applies +7 (XXX) XXX-XX-XX mask as the user types. */
    fun onPhoneChange(raw: String) {
        _ui.value = _ui.value.copy(
            phone = PhoneFormatter.format(raw),
            phoneError = null,
            errorMessage = null,
        )
    }

    fun onPasswordChange(v: String) {
        _ui.value = _ui.value.copy(password = v, passwordError = null, errorMessage = null)
    }

    fun login() {
        val s = _ui.value
        var phoneError: String? = null
        var passwordError: String? = null
        if (s.phone.isBlank()) phoneError = "Введите номер телефона"
        if (s.password.isBlank()) passwordError = "Введите пароль"
        if (phoneError != null || passwordError != null) {
            _ui.value = s.copy(phoneError = phoneError, passwordError = passwordError)
            return
        }
        submit(s.phone, s.password)
    }

    /** One-tap demo entry — matches PWA buttons (password = "demo123"). */
    fun demoLogin(phone: String) {
        submit(phone, "demo123")
    }

    private fun submit(phone: String, password: String) {
        _ui.value = _ui.value.copy(isLoading = true, errorMessage = null)
        viewModelScope.launch {
            authRepo.login(PhoneFormatter.normalize(phone), password)
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
