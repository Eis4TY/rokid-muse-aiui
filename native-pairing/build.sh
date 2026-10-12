#!/bin/sh
set -eu
cd "$(dirname "$0")"
python3 fetch-deps.py
SDK="${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}"
BUILD_TOOLS="$SDK/build-tools/35.0.0"
JAVA_HOME="$(/usr/libexec/java_home)"
rm -rf build/classes build/dex
mkdir -p build/classes build/dex
DEPS="deps/okhttp-3.14.9.jar:deps/okio-1.17.2.jar:deps/bcprov-jdk18on-1.78.1.jar"
"$JAVA_HOME/bin/javac" --release 8 -classpath "$SDK/platforms/android-31/android.jar:$DEPS" -d build/classes src/com/prism/musepair/*.java
"$BUILD_TOOLS/d8" --lib "$SDK/platforms/android-31/android.jar" --output build/dex build/classes/com/prism/musepair/*.class deps/okhttp-3.14.9.jar deps/okio-1.17.2.jar deps/bcprov-jdk18on-1.78.1.jar
"$BUILD_TOOLS/aapt" package -f -M AndroidManifest.xml -I "$SDK/platforms/android-31/android.jar" -F build/unsigned.apk
(cd build/dex && zip -q -u ../unsigned.apk classes.dex)
"$BUILD_TOOLS/zipalign" -f 4 build/unsigned.apk build/aligned.apk
"$BUILD_TOOLS/apksigner" sign --ks "$HOME/.android/debug.keystore" --ks-pass pass:android --out build/muse-pairing.apk build/aligned.apk
"$BUILD_TOOLS/apksigner" verify build/muse-pairing.apk
