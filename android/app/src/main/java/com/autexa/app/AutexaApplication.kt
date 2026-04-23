package com.autexa.app

import android.app.Application
import dagger.hilt.android.HiltAndroidApp

/**
 * Application class — entry point for Hilt DI.
 * Registered in AndroidManifest.xml via android:name=".AutexaApplication".
 */
@HiltAndroidApp
class AutexaApplication : Application()
