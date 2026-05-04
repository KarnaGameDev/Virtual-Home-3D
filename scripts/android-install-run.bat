@echo off
setlocal
cd /d "%~dp0\.."
set "ANDROID_HOME=%USERPROFILE%\AppData\Local\Android\Sdk"
set "PATH=%ANDROID_HOME%\platform-tools;%PATH%"
adb install -r "android\app\build\outputs\apk\debug\app-debug.apk"
adb shell am start -n com.roomscanner/.MainActivity
