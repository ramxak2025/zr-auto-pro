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
import androidx.compose.ui.graphics.Brush
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
import com.autexa.app.ui.components.AnimatedMeshBackground
import com.autexa.app.ui.components.GlassPill
import com.autexa.app.ui.components.GlassSurface
import com.autexa.app.ui.theme.BrandBlue600
import com.autexa.app.ui.theme.BrandBlue700
import com.autexa.app.ui.theme.ErrorRed
import com.autexa.app.ui.theme.Gray400
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

    Box(Modifier.fillMaxSize()) {
        // Living mesh — sits behind everything, blurred via GPU
        AnimatedMeshBackground()

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding()
                .padding(horizontal = 22.dp)
                .padding(vertical = 36.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            // Logo
            Image(
                painter = painterResource(id = R.drawable.logo),
                contentDescription = "Autexa",
                contentScale = ContentScale.Fit,
                modifier = Modifier.width(220.dp).height(54.dp),
            )

            Spacer(Modifier.height(10.dp))

            Text(
                text = "СИСТЕМА УПРАВЛЕНИЯ АВТОСЕРВИСОМ",
                fontSize = 11.sp,
                color = Gray500,
                letterSpacing = 1.4.sp,
                textAlign = TextAlign.Center,
            )

            Spacer(Modifier.height(28.dp))

            // Glass form card
            GlassSurface(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(20.dp),
                ) {
                    FieldLabel("ТЕЛЕФОН")
                    GlassField(
                        value = ui.phone,
                        onValueChange = vm::onPhoneChange,
                        placeholder = "+7 (___) ___-__-__",
                        keyboardType = KeyboardType.Phone,
                        isError = ui.phoneError != null,
                    )
                    ui.phoneError?.let { ErrorLine(it) }

                    Spacer(Modifier.height(18.dp))

                    FieldLabel("ПАРОЛЬ")
                    GlassField(
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
                                tint = Gray500,
                                modifier = Modifier
                                    .size(22.dp)
                                    .clickable(
                                        interactionSource = interaction,
                                        indication = null,
                                    ) { showPassword = !showPassword },
                            )
                        },
                    )
                    ui.passwordError?.let { ErrorLine(it) }

                    ui.errorMessage?.let {
                        Spacer(Modifier.height(14.dp))
                        Text(it, color = ErrorRed, fontSize = 13.sp)
                    }

                    Spacer(Modifier.height(22.dp))

                    SubmitButton(
                        text = "Войти",
                        loading = ui.isLoading,
                        onClick = { vm.login() },
                    )
                }
            }

            Spacer(Modifier.height(28.dp))

            // Demo divider
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Box(Modifier.weight(1f).height(1.dp).background(Color.White.copy(alpha = 0.6f)))
                Text(
                    "ДЕМО-ДОСТУП",
                    color = Gray500,
                    fontSize = 11.sp,
                    letterSpacing = 1.4.sp,
                    modifier = Modifier.padding(horizontal = 12.dp),
                )
                Box(Modifier.weight(1f).height(1.dp).background(Color.White.copy(alpha = 0.6f)))
            }

            Spacer(Modifier.height(14.dp))

            // Glass demo buttons — tinted, but iOS-style frosted
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                GlassDemoButton(
                    text = "Владелец",
                    accent = Color(0xFF059669),
                    enabled = !ui.isLoading,
                    modifier = Modifier.weight(1f),
                    onClick = { vm.demoLogin("+7 (000) 000-00-01") },
                )
                GlassDemoButton(
                    text = "Мастер",
                    accent = Color(0xFF1D4ED8),
                    enabled = !ui.isLoading,
                    modifier = Modifier.weight(1f),
                    onClick = { vm.demoLogin("+7 (000) 000-00-02") },
                )
            }

            Spacer(Modifier.height(36.dp))

            Text(
                "Autexa v2.1 © 2026",
                color = Gray500.copy(alpha = 0.7f),
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

/** Glass-style input row — translucent fill, subtle white rim, gradient sheen. */
@Composable
private fun GlassField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    keyboardType: KeyboardType,
    isError: Boolean = false,
    hidePassword: Boolean = false,
    trailingIcon: (@Composable () -> Unit)? = null,
) {
    val tint = if (isError) Color(0x33FCA5A5) else Color.White.copy(alpha = 0.45f)
    val borderBrush = if (isError) {
        SolidColor(Color(0xFFF87171))
    } else {
        Brush.verticalGradient(
            listOf(Color.White.copy(alpha = 0.85f), Color.White.copy(alpha = 0.25f)),
        )
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(tint)
            .border(1.dp, borderBrush, RoundedCornerShape(14.dp))
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

/** Brand-blue submit — gradient + drop shadow + inner highlight. */
@Composable
private fun SubmitButton(text: String, loading: Boolean, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val shape = RoundedCornerShape(16.dp)
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(54.dp)
            .shadow(
                elevation = 18.dp,
                shape = shape,
                spotColor = BrandBlue600,
                ambientColor = BrandBlue600,
            )
            .clip(shape)
            .background(Brush.linearGradient(listOf(BrandBlue600, BrandBlue700)))
            .border(
                1.dp,
                Brush.verticalGradient(
                    listOf(Color.White.copy(alpha = 0.55f), Color.White.copy(alpha = 0.05f)),
                ),
                shape,
            )
            .clickable(
                interactionSource = interaction,
                indication = null,
                enabled = !loading,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        if (loading) {
            CircularProgressIndicator(
                color = Color.White,
                strokeWidth = 2.dp,
                modifier = Modifier.size(22.dp),
            )
        } else {
            Text(text, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun GlassDemoButton(
    text: String,
    accent: Color,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    GlassPill(
        modifier = modifier
            .height(48.dp)
            .clickable(
                interactionSource = interaction,
                indication = null,
                enabled = enabled,
                onClick = onClick,
            ),
        tint = accent.copy(alpha = 0.18f),
        cornerRadius = 16.dp,
    ) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(
                text,
                color = accent,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}
