package com.autexa.app.util

/**
 * Mirror of shared/validation/phone.ts — Russian phone formatting.
 * Accepts any raw string, keeps only digits, then masks into +7 (XXX) XXX-XX-XX.
 * Leading 8 is converted to 7.
 */
object PhoneFormatter {
    fun format(raw: String): String {
        var digits = raw.filter { it.isDigit() }
        if (digits.isNotEmpty() && digits[0] == '8') digits = "7" + digits.drop(1)
        if (digits.isEmpty()) return ""
        if (digits.length <= 1) return "+$digits"
        if (digits.length <= 4) return "+${digits.take(1)} (${digits.drop(1)}"
        if (digits.length <= 7) return "+${digits.take(1)} (${digits.substring(1, 4)}) ${digits.drop(4)}"
        if (digits.length <= 9) return "+${digits.take(1)} (${digits.substring(1, 4)}) ${digits.substring(4, 7)}-${digits.drop(7)}"
        val d = digits.take(11)
        return "+${d.take(1)} (${d.substring(1, 4)}) ${d.substring(4, 7)}-${d.substring(7, 9)}-${d.substring(9, 11)}"
    }

    /** Canonical form for the API: +7XXXXXXXXXX. */
    fun normalize(phone: String): String {
        var digits = phone.filter { it.isDigit() }
        if (digits.length == 11 && digits[0] == '8') digits = "7" + digits.substring(1)
        return if (digits.isNotEmpty()) "+$digits" else phone
    }

    fun isValid(phone: String): Boolean = phone.filter { it.isDigit() }.length >= 10
}
