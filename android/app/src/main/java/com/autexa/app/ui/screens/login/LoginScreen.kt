package com.autexa.app.ui.screens.login

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.DirectionsCar
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.autexa.app.ui.theme.BrandBlue100
import com.autexa.app.ui.theme.BrandBlue50
import com.autexa.app.ui.theme.BrandBlue500
import com.autexa.app.ui.theme.BrandBlue600
import com.autexa.app.ui.theme.BrandBlue700
import com.autexa.app.ui.theme.Gray100
import com.autexa.app.ui.theme.Gray400
import com.autexa.app.ui.theme.Gray500
import com.autexa.app.ui.theme.Gray900

@Composable
fun LoginScreen(
    onLoggedIn: () -> Unit,
    vm: LoginViewModel = hiltViewModel(),
) {
    val ui by vm.ui.collectAsState()

    LaunchedEffect(ui.isLoginSuccessful) {
        if (ui.isLoginSuccessful) onLoggedIn()
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(listOf(BrandBlue50, Color.White, Gray100)),
            ),
    ) {
        // Soft decorative blobs
        Box(
            Modifier
                .size(280.dp)
                .offset(x = 100.dp, y = (-100).dp)
                .clip(CircleShape)
                .background(BrandBlue100.copy(alpha = 0.55f))
                .align(Alignment.TopEnd),
        )
        Box(
            Modifier
                .size(220.dp)
                .offset(x = (-80).dp, y = 60.dp)
                .clip(CircleShape)
                .background(BrandBlue100.copy(alpha = 0.4f))
                .align(Alignment.BottomStart),
        )

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding()
                .padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(60.dp))

            // Logo — gradient pill with car icon + soft shadow
            Box(
                Modifier
                    .size(84.dp)
                    .shadow(
                        elevation = 24.dp,
                        shape = RoundedCornerShape(24.dp),
                        ambientColor = BrandBlue500,
                        spotColor = BrandBlue600,
                    )
                    .clip(RoundedCornerShape(24.dp))
                    .background(Brush.linearGradient(listOf(BrandBlue500, BrandBlue700))),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Outlined.DirectionsCar,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(40.dp),
                )
            }

            Spacer(Modifier.height(24.dp))

            Text(
                text = "Autexa",
                fontSize = 36.sp,
                fontWeight = FontWeight.ExtraBold,
                color = Gray900,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = "CRM для автосервиса",
                fontSize = 15.sp,
                color = Gray500,
            )

            Spacer(Modifier.height(40.dp))

            Surface(
                color = Color.White,
                shape = RoundedCornerShape(24.dp),
                shadowElevation = 6.dp,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(
                    modifier = Modifier.padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Text(
                        text = "Войти в аккаунт",
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        color = Gray900,
                    )

                    OutlinedTextField(
                        value = ui.phone,
                        onValueChange = vm::onPhoneChange,
                        placeholder = { Text("Телефон", color = Gray400) },
                        leadingIcon = { Icon(Icons.Outlined.Phone, null, tint = BrandBlue600) },
                        singleLine = true,
                        shape = RoundedCornerShape(14.dp),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = BrandBlue600,
                            unfocusedBorderColor = Gray100,
                            focusedContainerColor = Color.White,
                            unfocusedContainerColor = Gray100.copy(alpha = 0.4f),
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    )

                    OutlinedTextField(
                        value = ui.password,
                        onValueChange = vm::onPasswordChange,
                        placeholder = { Text("Пароль", color = Gray400) },
                        leadingIcon = { Icon(Icons.Outlined.Lock, null, tint = BrandBlue600) },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        shape = RoundedCornerShape(14.dp),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = BrandBlue600,
                            unfocusedBorderColor = Gray100,
                            focusedContainerColor = Color.White,
                            unfocusedContainerColor = Gray100.copy(alpha = 0.4f),
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    )

                    ui.errorMessage?.let {
                        Text(
                            text = it,
                            color = MaterialTheme.colorScheme.error,
                            fontSize = 13.sp,
                        )
                    }

                    Spacer(Modifier.height(4.dp))

                    Button(
                        onClick = vm::login,
                        enabled = !ui.isLoading,
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = BrandBlue600,
                            contentColor = Color.White,
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(54.dp)
                            .shadow(
                                elevation = 12.dp,
                                shape = RoundedCornerShape(14.dp),
                                spotColor = BrandBlue600,
                                ambientColor = BrandBlue600,
                            ),
                    ) {
                        if (ui.isLoading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                color = Color.White,
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Text("Войти", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
            Spacer(Modifier.height(40.dp))
        }
    }
}
