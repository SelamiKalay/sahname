# Capacitor ve eklentileri yansımayla (reflection) çağrıldığı için korunur
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep class com.getcapacitor.community.admob.** { *; }

# JavascriptInterface ile JS tarafından çağrılan metotlar
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Google Mobile Ads
-keep class com.google.android.gms.ads.** { *; }
-dontwarn com.google.android.gms.**

# Yığın izlerinde satır numarası kalsın (çökme raporları okunabilsin)
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
