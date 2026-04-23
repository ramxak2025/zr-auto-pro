package com.autexa.app.util

/**
 * Mirror of shared/validation/phone.ts — Russian phone formatting.
 *
 * Accepts any raw string, strips to digits, normalizes leading digit to 7
 * (auto-prefix for the common phone-pad case where user starts typing "9"),
 * then formats as +7 (XXX) XXX-XX-XX progressively.
 *
 * All substring ranges are bound-checked with a local `slice` helper so a
 * 10-digit or even shorter intermediate input never throws StringIndex OOB.
 */
object PhoneFormatter {
    fun format(raw: String): String {
        var digits = raw.filter { it.isDigit() }
        if (digits.isEmpty()) return ""
        digits = when {
            digits[0] == '8' -> "7" + digits.drop(1)
            digits[0] != '7' -> "7$digits"
            else -> digits
        }
        // Hard cap to the 11-digit Russian format.
        if (digits.length > 11) digits = digits.take(11)

        val d = digits
        val len = d.length
        return when {
            len <= 1 -> "+7"
            len <= 4 -> "+7 (${d.slice2(1, 4)}"
            len <= 7 -> "+7 (${d.slice2(1, 4)}) ${d.slice2(4, 7)}"
            len <= 9 -> "+7 (${d.slice2(1, 4)}) ${d.slice2(4, 7)}-${d.slice2(7, 9)}"
            else -> "+7 (${d.slice2(1, 4)}) ${d.slice2(4, 7)}-${d.slice2(7, 9)}-${d.slice2(9, 11)}"
        }
    }

    /** JS-style slice — silently clamps to length. */
    private fun String.slice2(start: Int, endExclusive: Int): String {
        val s = start.coerceIn(0, length)
        val e = endExclusive.coerceIn(s, length)
        return substring(s, e)
    }

    /** Canonical form for the API: +7XXXXXXXXXX. */
    fun normalize(phone: String): String {
        var digits = phone.filter { it.isDigit() }
        if (digits.length == 11 && digits[0] == '8') digits = "7" + digits.substring(1)
        return if (digits.isNotEmpty()) "+$digits" else phone
    }

    fun isValid(phone: String): Boolean = phone.filter { it.isDigit() }.length >= 10
}
