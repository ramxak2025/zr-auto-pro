package com.autexa.app.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.autexa.app.data.repo.AuthRepository
import com.autexa.app.ui.screens.home.HomeScreen
import com.autexa.app.ui.screens.login.LoginScreen
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

/**
 * Root composable — picks Login or Home based on auth state.
 * Auth state is reactive: token added → HomeScreen, token cleared → LoginScreen.
 */
@Composable
fun AutexaApp(gateVm: AuthGateViewModel = hiltViewModel()) {
    val state by gateVm.authState.collectAsState()

    when (state) {
        AuthState.Loading -> Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center,
        ) { CircularProgressIndicator() }

        AuthState.LoggedOut -> LoginScreen(onLoggedIn = {})
        AuthState.LoggedIn -> HomeScreen(onLogout = {})
    }
}

enum class AuthState { Loading, LoggedIn, LoggedOut }

@HiltViewModel
class AuthGateViewModel @Inject constructor(
    authRepo: AuthRepository,
) : ViewModel() {
    val authState: StateFlow<AuthState> = authRepo.isAuthenticated
        .map { authed -> if (authed) AuthState.LoggedIn else AuthState.LoggedOut }
        .stateIn(viewModelScope, SharingStarted.Eagerly, AuthState.Loading)
}
