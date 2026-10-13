# Rokid Muse AIUI

**English** | [简体中文](README.zh-CN.md)

Use Meta Muse on Rokid glasses with voice input, streaming Markdown replies, and an animated pixel avatar. Built with [Muse Gadget SDK](https://github.com/facebookincubator/muse-gadget-sdk) and Rokid AIUI. This is an independent integration.

Each pair of glasses has its own device identity. The native component handles BLE pairing and securely hands authorization to AIUI. AIUI connects to Muse through the Rokid phone network and manages token refresh. Daily use requires no computer, USB forwarding, or glasses Wi-Fi.

![Muse recording and reply reading on Rokid glasses](media/glasses-experience.jpg)

## Setup

Use the complete `rokid-muse-pairing` release folder, including its APK, AIX, and scripts. Install Python 3, adb, and aix-cli, then connect the glasses via USB with USB debugging enabled. Run from the release folder:

```bash
python3 scripts/setup.py setup
python3 scripts/setup.py open
```

1. Get your own [Muse SDK token](https://gadgets.muse.ai/settings/sdk-tokens) and enter it at the hidden prompt.
2. Forget the glasses in your phone’s Bluetooth settings. In Muse, open **Developer mode → Add Device** and confirm the device shown by the installer.
3. Turn off the phone VPN and reconnect through the Rokid app. Outside the US, enable and keep the phone VPN on after reconnecting.

Existing authorization is preserved during updates. See the [pairing guide](pairing/SKILL.md) for setup, updates, and troubleshooting. Windows and other glasses models still need device validation.

### Phone pairing

Scan for your device → confirm pairing and device access → select **Use current connection** → tap **Connect**. The device name shown below is an example; use the name displayed by your installer.

![Muse phone pairing flow](media/phone-pairing.jpg)

## Use

Hold the touchpad to record, tap to stop, then choose **Send**. Muse transcribes the audio and returns a reply. Scroll to read; double-tap to go back. Recordings last 0.3–15 seconds and remain in memory until sent or discarded.

## FAQ

### Cannot reconnect to the Rokid app after connecting to Muse

Try these steps in order:

1. Manually connect to the glasses in your phone’s Bluetooth settings.
2. If that fails, forget the previously paired glasses in Bluetooth settings, turn Bluetooth off and on, unpair the glasses in the Rokid app, triple-tap to reset the glasses’ Bluetooth, then pair again in the Rokid app.
3. If you still cannot reconnect, manually connect to the glasses in Bluetooth settings again, then pair again in the Rokid app.

## Build

On macOS: Node.js, Python 3, adb, aix-cli 0.10.1, JDK, Android SDK Platform 31, and Build Tools 35.0.0. Java dependencies use the Aliyun Maven mirror with SHA-256 verification.

```bash
npm test
python3 scripts/build-release.py
python3 scripts/deploy-phone.py --serial <device-serial>
```

Releases are built outside the repository. The application ID stays stable; each AIX build gets a new internal version. `--rebind` repairs the local authorization binding.

## Privacy and license

SDK tokens, account tokens, private keys, and pairing records stay in local or device-private storage and must never be committed or bundled. Local handoff receipts are not Muse replies.

Source: [Apache-2.0](LICENSE). See [Muse and JavaScript dependencies](THIRD-PARTY-MUSE.md), [native dependencies](native-pairing/THIRD-PARTY.md). Muse service and SDK terms also apply.
