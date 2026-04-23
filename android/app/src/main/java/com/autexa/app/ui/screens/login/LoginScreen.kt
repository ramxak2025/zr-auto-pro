package com.autexa.app.ui.screens.login

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.autexa.app.R
import com.autexa.app.ui.theme.BrandBlue600
import com.autexa.app.ui.theme.ErrorRed
import com.autexa.app.ui.theme.Gray200
import com.autexa.app.ui.theme.Gray300
import com.autexa.app.ui.theme.Gray400
import com.autexa.app.ui.theme.Gray50
import com.autexa.app.ui.theme.Gray500
import com.autexa.app.ui.theme.Gray900

@Composable
fun LoginScreen(
    onLoggedIn: () -> Unit,
    vm: LoginViewModel = hiltViewModel(),
) {
    val ui by vm.ui.collectAsState()
    var showPassword by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(ui.isLoginSuccessful) {
        if (ui.isLoginSuccessful) onLoggedIn()
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color.White)
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding(),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp)
                .padding(vertical = 48.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Image(
                painter = painterResource(id = R.drawable.logo),
                contentDescription = "Autexa",
                contentScale = ContentScale.Fit,
                modifier = Modifier.width(240.dp).height(58.dp),
            )

            Spacer(Modifier.height(12.dp))

            Text(
                text = "СИСТЕМА УПРАВЛЕНИЯ АВТОСЕРВИСОМ",
                fontSize = 11.sp,
                color = Gray400,
                letterSpacing = 1.4.sp,
                textAlign = TextAlign.Center,
            )

            Spacer(Modifier.height(40.dp))

            FieldLabel("ТЕЛЕФОН")
            FlatField(
                value = ui.phone,
                onValueChange = vm::onPhoneChange,
                placeholder = "+7 (___) ___-__-__",
                keyboardType = KeyboardType.Phone,
                isError = ui.phoneError != null,
            )
            ui.phoneError?.let { ErrorLine(it) }

            Spacer(Modifier.height(20.dp))

            FieldLabel("ПАРОЛЬ")
            FlatField(
                value = ui.password,
                onValueChange = vm::onPasswordChange,
                placeholder = "Введите пароль",
                keyboardType = KeyboardType.Password,
                isError = ui.passwordError != null,
                hidePassword = !showPassword,
                trailingIcon = {
                    val interaction = remember { MutableInteractionSource() }
                    Icon(
                        imageVector = if (showPassword) Icons.Outlined.Visibility else Icons.Outlined.VisibilityOff,
                        contentDescription = null,
                        tint = Gray400,
                        modifier = Modifier
                            .size(22.dp)
                            .clickable(interactionSource = interaction, indication = null) {
                                showPassword = !showPassword
                            },
                    )
                },
            )
            ui.passwordError?.let { ErrorLine(it) }

            ui.errorMessage?.let {
                Spacer(Modifier.height(16.dp))
                Text(it, color = ErrorRed, fontSize = 13.sp)
            }

            Spacer(Modifier.height(24.dp))

            SubmitButton(
                text = "Войти",
                loading = ui.isLoading,
                onClick = vm::login,
            )

            Spacer(Modifier.height(32.dp))

            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Box(Modifier.weight(1f).height(1.dp).background(Gray200))
                Text(
                    "ДЕМО-ДОСТУП",
                    color = Gray400,
                    fontSize = 11.sp,
                    letterSpacing = 1.4.sp,
                    modifier = Modifier.padding(horizontal = 12.dp),
                )
                Box(Modifier.weight(1f).height(1.dp).background(Gray200))
            }

            Spacer(Modifier.height(16.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                DemoButton(
                    text = "Владелец",
                    bg = Color(0xFFECFDF5),
                    border = Color(0xFFA7F3D0),
                    textColor = Color(0xFF047857),
                    enabled = !ui.isLoading,
                    modifier = Modifier.weight(1f),
                    onClick = { vm.demoLogin("+7 (000) 000-00-01") },
                )
                DemoButton(
                    text = "Мастер",
                    bg = Color(0xFFEFF6FF),
                    border = Color(0xFFBFDBFE),
                    textColor = Color(0xFF1D4ED8),
                    enabled = !ui.isLoading,
                    modifier = Modifier.weight(1f),
                    onClick = { vm.demoLogin("+7 (000) 000-00-02") },
                )
            }

            Spacer(Modifier.height(40.dp))

            Text(
                "Autexa v2.1 © 2026",
                color = Gray300,
                fontSize = 11.sp,
            )
        }
    }
}

@Composable
private fun FieldLabel(text: String) {
    Box(modifier = Modifier.fillMaxWidth()) {
        Text(
            text,
            color = Gray500,
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium,
            letterSpacing = 1.4.sp,
            modifier = Modifier.padding(bottom = 8.dp),
        )
    }
}

@Composable
private fun FlatField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    keyboardType: KeyboardType,
    isError: Boolean = false,
    hidePassword: Boolean = false,
    trailingIcon: (@Composable () -> Unit)? = null,
) {
    val bg = if (isError) Color(0xFFFEF2F2) else Gray50
    val borderColor = if (isError) Color(0xFFF87171) else Gray200

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(bg)
            .border(1.dp, borderColor, RoundedCornerShape(14.dp))
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.weight(1f)) {
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
                visualTransformation = if (hidePassword) PasswordVisualTransformation() else VisualTransformation.None,
                textStyle = TextStyle(color = Gray900, fontSize = 15.sp),
                cursorBrush = SolidColor(BrandBlue600),
                modifier = Modifier.fillMaxWidth(),
            )
            if (value.isEmpty()) {
                Text(placeholder, color = Gray400, fontSize = 15.sp)
            }
        }
        if (trailingIcon != null) {
            Spacer(Modifier.width(8.dp))
            trailingIcon()
        }
    }
}

@Composable
private fun ErrorLine(text: String) {
    Box(modifier = Modifier.fillMaxWidth().padding(top = 6.dp, start = 2.dp)) {
        Text(text, color = ErrorRed, fontSize = 12.sp)
    }
}

@Composable
private fun SubmitButton(text: String, loading: Boolean, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val shape = RoundedCornerShape(14.dp)
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(52.dp)
            .shadow(
                elevation = 10.dp,
                shape = shape,
                spotColor = BrandBlue600,
                ambientColor = BrandBlue600,
            )
            .clip(shape)
            .background(BrandBlue600)
            .clickable(
                interactionSource = interaction,
                indication = null,
                enabled = !loading,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        if (loading) {
            CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
        } else {
            Text(text, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun DemoButton(
    text: String,
    bg: Color,
    border: Color,
    textColor: Color,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    Box(
        modifier = modifier
            .height(44.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(bg)
            .border(1.dp, border, RoundedCornerShape(14.dp))
            .clickable(
                interactionSource = interaction,
                indication = null,
                enabled = enabled,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = textColor, fontSize = 14.sp, fontWeight = FontWeight.Medium)
    }
}
