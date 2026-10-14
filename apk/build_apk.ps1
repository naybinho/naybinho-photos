$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:Path = "$env:JAVA_HOME\bin;" + $env:Path
Set-Location "c:\Users\Douglas\Documents\Apps\Photos\apk"
.\gradlew.bat assembleDebug --no-daemon
