# Protocol and dependencies

Noise.java and Wire.java implement the protocol described by Meta's Apache-2.0 Muse Gadget SDK:
https://github.com/facebookincubator/muse-gadget-sdk (checked locally at cafaad4).
The original license is retained in MUSE-SDK-LICENSE.

- OkHttp 3.14.9 / Okio 1.17.2: Apache-2.0, https://github.com/square/okhttp and https://github.com/square/okio
- Bouncy Castle 1.78.1: MIT-style Bouncy Castle license, https://www.bouncycastle.org/licence.html

JARs retain their upstream META-INF notices. Test-only org.json is not included in the Android APK; Android provides org.json.
