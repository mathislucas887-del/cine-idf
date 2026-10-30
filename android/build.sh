#!/bin/bash
# Construit l'APK sans Gradle (JDK 17 + Android SDK build-tools 34)
set -e; . ~/android/env.sh; BT=$ANDROID_HOME/build-tools/34.0.0; JAR=$ANDROID_HOME/platforms/android-34/android.jar
cd "$(dirname "$0")"; rm -rf out; mkdir -p out/classes out/dex
$BT/aapt2 compile --dir res -o out/res.zip
$BT/aapt2 link -I $JAR --manifest AndroidManifest.xml -o out/base.apk out/res.zip --java out/gen
javac -source 8 -target 8 -bootclasspath $JAR -classpath $JAR -d out/classes $(find src out/gen -name '*.java') 2>&1 | grep -v warning || true
$BT/d8 --lib $JAR --min-api 24 --output out/dex $(find out/classes -name '*.class')
cp out/base.apk out/u.apk; python3 -c "import zipfile;zipfile.ZipFile('out/u.apk','a').write('out/dex/classes.dex','classes.dex')"
$BT/zipalign -f 4 out/u.apk out/a.apk
[ -f ~/android/cineidf.keystore ] || keytool -genkeypair -keystore ~/android/cineidf.keystore -alias cineidf -keyalg RSA -keysize 2048 -validity 10000 -storepass cineidf123 -keypass cineidf123 -dname "CN=Cine IDF, C=FR"
$BT/apksigner sign --ks ~/android/cineidf.keystore --ks-pass pass:cineidf123 --out ../cine-idf.apk out/a.apk
$BT/apksigner verify ../cine-idf.apk && ls -la ../cine-idf.apk
