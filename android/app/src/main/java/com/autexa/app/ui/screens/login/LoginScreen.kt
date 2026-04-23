package com.autexa.app.ui.screens.login

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowForward
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.autexa.app.R
import com.autexa.app.ui.components.StaggeredReveal
import com.autexa.app.ui.theme.BrandBlue100
import com.autexa.app.ui.theme.BrandBlue500
import com.autexa.app.ui.theme.BrandBlue600
import com.autexa.app.ui.theme.BrandBlue700
import com.autexa.app.ui.theme.ErrorRed
import com.autexa.app.ui.theme.Gray200
import com.autexa.app.ui.theme.Gray300
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

    Box(
        Modifier
            .fillMaxSize()
            .background(Color.White)
            .drawBehind {
                // Single soft radial accent — top-right, static, very subtle
                drawRect(
                    brush = Brush.radialGradient(
                        colors = listOf(
                            BrandBlue100.copy(alpha = 0.55f),
                            Color.Transparent,
                        ),
                        center = Offset(size.width * 0.95f, size.height * 0.05f),
                        radius = size.width * 0.9f,
                    ),
                )
            }
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding(),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp)
                .padding(top = 56.dp, bottom = 24.dp),
        ) {
            // Logo — small, top-left, like Stripe
            StaggeredReveal(delayMs = 0) {
                Image(
                    painter = painterResource(id = R.drawable.logo),
                    contentDescription = "Autexa",
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.width(140.dp).height(34.dp),
                )
            }

            Spacer(Modifier.height(64.dp))

            StaggeredReveal(delayMs = 70) {
                Text(
                    text = "С возвращением",
                    color = Gray900,
                    fontSize = 32.sp,
                    fontWeight = FontWeight.ExtraBold,
                    lineHeight = 38.sp,
                )
            }

            Spacer(Modifier.height(10.dp))

            StaggeredReveal(delayMs = 140) {
                Text(
                    text = "Войдите, чтобы продолжить работу в Autexa",
                    color = Gray500,
                    fontSize = 15.sp,
                    lineHeight = 22.sp,
                )
            }

            Spacer(Modifier.height(48.dp))

            // Underline-style phone field
            StaggeredReveal(delayMs = 210) {
                UnderlineField(
                    value = ui.phone,
                    onValueChange = vm::onPhoneChange,
                    label = "Номер телефона",
                    placeholder = "+7 (___) ___-__-__",
                    keyboardType = KeyboardType.Phone,
                    isError = ui.phoneError != null,
                    errorText = ui.phoneError,
                )
            }

            Spacer(Modifier.height(24.dp))

            StaggeredReveal(delayMs = 280) {
                UnderlineField(
                    value = ui.password,
                    onValueChange = vm::onPasswordChange,
                    label = "Пароль",
                    placeholder = "Введите пароль",
                    keyboardType = KeyboardType.Password,
                    isError = ui.passwordError != null,
                    errorText = ui.passwordError,
                    hidePassword = !showPassword,
                    trailingIcon = {
                        val interaction = remember { MutableInteractionSource() }
                        Icon(
                            imageVector = if (showPassword) Icons.Outlined.Visibility else Icons.Outlined.VisibilityOff,
                            contentDescription = null,
                            tint = Gray400,
                            modifier = Modifier
                                .size(22.dp)
                                .clickable(
                                    interactionSource = interaction,
                                    indication = null,
                                ) { showPassword = !showPassword },
                        )
                    },
                )
            }

            ui.errorMessage?.let {
                Spacer(Modifier.height(14.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(6.dp).clip(CircleShape).background(ErrorRed))
                    Spacer(Modifier.width(8.dp))
                    Text(it, color = ErrorRed, fontSize = 13.sp)
                }
            }

            Spacer(Modifier.height(36.dp))

            StaggeredReveal(delayMs = 350) {
                PrimaryCta(
                    text = "Войти",
                    loading = ui.isLoading,
                    onClick = vm::login,
                )
            }

            Spacer(Modifier.height(36.dp))

            // Thin divider with label
            StaggeredReveal(delayMs = 420) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Box(Modifier.weight(1f).height(1.dp).background(Gray200))
                    Text(
                        "Демо-доступ",
                        color = Gray400,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(horizontal = 14.dp),
                    )
                    Box(Modifier.weight(1f).height(1.dp).background(Gray200))
                }
            }

            Spacer(Modifier.height(18.dp))

            StaggeredReveal(delayMs = 490) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    OutlinePill(
                        text = "Войти как Владелец",
                        modifier = Modifier.weight(1f),
                        enabled = !ui.isLoading,
                        onClick = { vm.demoLogin("+7 (000) 000-00-01") },
                    )
                    OutlinePill(
                        text = "Мастер",
                        modifier = Modifier.weight(0.5f),
                        enabled = !ui.isLoading,
                        onClick = { vm.demoLogin("+7 (000) 000-00-02") },
                    )
                }
            }

            Spacer(Modifier.weight(1f, fill = true))
            Spacer(Modifier.height(32.dp))

            StaggeredReveal(delayMs = 560) {
                Text(
                    "Autexa · v2.1 · © 2026",
                    color = Gray400,
                    fontSize = 11.sp,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun UnderlineField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    placeholder: String,
    keyboardType: KeyboardType,
    isError: Boolean = false,
    errorText: String? = null,
    hidePassword: Boolean = false,
    trailingIcon: (@Composable () -> Unit)? = null,
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()

    val underlineColor = when {
        isError -> ErrorRed
        focused -> BrandBlue600
        else -> Gray200
    }
    val underlineHeight by animateDpAsState(
        targetValue = if (focused) 2.dp else 1.dp,
        animationSpec = tween(180),
        label = "underline",
    )
    val density = LocalDensity.current
    val underlinePx = with(density) { underlineHeight.toPx() }

    Column(Modifier.fillMaxWidth()) {
        // Floating label
        Text(
            label,
            color = if (isError) ErrorRed else Gray500,
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium,
            letterSpacing = 0.6.sp,
        )
        Spacer(Modifier.height(8.dp))
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .drawBehind {
                    drawRect(
                        color = underlineColor,
                        topLeft = Offset(0f, size.height - underlinePx),
                        size = androidx.compose.ui.geometry.Size(size.width, underlinePx),
                    )
                }
                .padding(bottom = 10.dp),
        ) {
            Box(modifier = Modifier.weight(1f)) {
                BasicTextField(
                    value = value,
                    onValueChange = onValueChange,
                    singleLine = true,
                    interactionSource = interaction,
                    keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
                    visualTransformation = if (hidePassword) PasswordVisualTransformation() else VisualTransformation.None,
                    textStyle = TextStyle(color = Gray900, fontSize = 17.sp, fontWeight = FontWeight.Medium),
                    cursorBrush = SolidColor(BrandBlue600),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (value.isEmpty()) {
                    Text(placeholder, color = Gray300, fontSize = 17.sp)
                }
            }
            if (trailingIcon != null) {
                Spacer(Modifier.width(8.dp))
                trailingIcon()
            }
        }

        if (errorText != null) {
            Spacer(Modifier.height(6.dp))
            Text(errorText, color = ErrorRed, fontSize = 12.sp)
        }
    }
}

@Composable
private fun PrimaryCta(
    text: String,
    loading: Boolean,
    onClick: () -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    val shape = RoundedCornerShape(18.dp)
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp)
            .shadow(
                elevation = 18.dp,
                shape = shape,
                spotColor = BrandBlue500,
                ambientColor = BrandBlue500,
            )
            .clip(shape)
            .background(Brush.linearGradient(listOf(BrandBlue600, BrandBlue700)))
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
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(text, color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.width(8.dp))
                Icon(Icons.Outlined.ArrowForward, null, tint = Color.White, modifier = Modifier.size(18.dp))
            }
        }
    }
}

@Composable
private fun OutlinePill(
    text: String,
    modifier: Modifier = Modifier,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    val shape = RoundedCornerShape(14.dp)
    Box(
        modifier = modifier
            .height(46.dp)
            .clip(shape)
            .background(Color.White)
            .then(
                Modifier.drawBehind {
                    // Hairline border via draw — keeps shape consistent with clip
                    val stroke = 1.dp.toPx()
                    drawRect(
                        color = Gray200,
                        topLeft = Offset(0f, 0f),
                        size = size,
                        style = androidx.compose.ui.graphics.drawscope.Stroke(width = stroke),
                    )
                },
            )
            .clickable(
                interactionSource = interaction,
                indication = null,
                enabled = enabled,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            color = Gray900,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
        )
    }
}

