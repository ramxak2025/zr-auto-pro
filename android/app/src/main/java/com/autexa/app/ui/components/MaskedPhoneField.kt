package com.autexa.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autexa.app.ui.theme.BrandBlue600
import com.autexa.app.ui.theme.Gray200
import com.autexa.app.ui.theme.Gray400
import com.autexa.app.ui.theme.Gray50
import com.autexa.app.ui.theme.Gray900
import com.autexa.app.util.PhoneFormatter

/**
 * Masked phone input using TextFieldValue so selection always follows
 * the formatter's output — fixes "typing reversed" when +/()- are inserted
 * and the cursor would otherwise stick to position 0.
 *
 * Parent owns only the formatted String; cursor state is internal.
 */
@Composable
fun MaskedPhoneField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String = "+7 (___) ___-__-__",
    isError: Boolean = false,
    trailingIcon: (@Composable () -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    // Local TextFieldValue — lets us force selection to end after each reformat.
    var field by rememberSaveable(stateSaver = TextFieldValue.Saver) {
        mutableStateOf(TextFieldValue(value, TextRange(value.length)))
    }

    // Keep local field in sync when parent resets externally (e.g. clear on submit error).
    if (field.text != value) {
        field = TextFieldValue(value, TextRange(value.length))
    }

    val bg = if (isError) Color(0xFFFEF2F2) else Gray50
    val borderColor = if (isError) Color(0xFFF87171) else Gray200

    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(bg)
            .border(1.dp, borderColor, RoundedCornerShape(14.dp))
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.weight(1f)) {
            BasicTextField(
                value = field,
                onValueChange = { incoming ->
                    val formatted = PhoneFormatter.format(incoming.text)
                    // Always park cursor at the end — predictable and avoids reversed
                    // typing when mask inserts/removes chars during edit.
                    field = TextFieldValue(formatted, TextRange(formatted.length))
                    if (formatted != value) onValueChange(formatted)
                },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                textStyle = TextStyle(color = Gray900, fontSize = 15.sp),
                cursorBrush = SolidColor(BrandBlue600),
                modifier = Modifier.fillMaxWidth(),
            )
            if (field.text.isEmpty()) {
                Text(placeholder, color = Gray400, fontSize = 15.sp)
            }
        }
        if (trailingIcon != null) {
            Spacer(Modifier.width(8.dp))
            trailingIcon()
        }
    }
}
