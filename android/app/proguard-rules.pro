# Retrofit + kotlinx.serialization
-keep,allowobfuscation,allowshrinking interface retrofit2.Call
-keep,allowobfuscation,allowshrinking class retrofit2.Response
-keepattributes Signature
-keepattributes *Annotation*

# kotlinx.serialization
-keepattributes RuntimeVisibleAnnotations,AnnotationDefault
-keep,includedescriptorclasses class com.autexa.app.**$$serializer { *; }
-keepclassmembers class com.autexa.app.** { *** Companion; }
-keepclasseswithmembers class com.autexa.app.** { kotlinx.serialization.KSerializer serializer(...); }

# Hilt
-keep class dagger.hilt.** { *; }
-keep class * extends dagger.hilt.android.internal.managers.* { *; }
