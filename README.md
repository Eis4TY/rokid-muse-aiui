# Rokid Muse AIUI

在 **Rokid glasses** 上连接和使用 **Meta 的 Muse** 的实验性项目，技术方案为 [Muse Gadgets](https://gadgets.muse.ai/) / [Muse Gadget SDK](https://github.com/facebookincubator/muse-gadget-sdk) + **Rokid AIUI 框架**。AIUI 提供眼镜上的语音输入、触控交互和回复阅读；Android 原生服务负责设备授权、加密连接和 Muse 云端会话。

本项目为独立集成实验，并非 Meta 或 Rokid 官方产品。当前仓库为私有，按后续开源维护的方式组织源码与文档。

独立复制自 rokid-prism-aiui，沿用 480×352 绿色界面与触控板交互。长按录音，单击结束，确认后选择“发送”上传语音消息，由 Muse 云端转写并回答；“阅读回复”逐段滚动，双击返回。

## 独立运行版本

运行链路：**AIUI → 眼镜 localhost:18787 → Android MuseService → Muse 云端**。运行时不需要 Mac、Python、USB 转发或 Mac VPN；眼镜自身需要能访问 Muse 的互联网连接。

现有已配对设备只需一次迁移配对凭据，之后 Android 服务自行刷新令牌、注册设备、订阅眼镜专用会话、发送消息并接收真实回复。前台服务在应用启动和开机后启动，断线自动重连。

服务不修改设备系统蓝牙名称，也不开放云端远程执行能力。本地传输收据仅用于诊断，不作为 Muse 回复展示。

### 开发环境

- Node.js（支持 `node --test`）、Python 3，以及可运行 AIUI 的 Rokid glasses。
- macOS、JDK、Android SDK Platform 31、Build Tools 35.0.0、ADB、Android 调试签名密钥，以及 `aix-cli`。当前原生构建脚本使用 macOS 的 `java_home`。
- 有效的 Muse 账号与设备配对授权；初次配对需要官方 SDK 和开发配对流程，克隆仓库不会自动获得授权。

```bash
git clone https://github.com/Eis4TY/rokid-muse-aiui.git
cd rokid-muse-aiui
npm test
sh native-pairing/build.sh
```

Node 测试不需要安装第三方依赖。Java 依赖由构建脚本从阿里 Maven 源下载，校验固定 SHA-256。安装额外 npm / Python 依赖时优先使用阿里源。

### 安装已有配对设备

连接已授权的眼镜 USB，使用本机已安装的 adb / aix-cli / Android SDK / JDK：

```bash
python3 native-pairing/deploy-standalone.py
# 多设备时加 --serial <序列号>
```

脚本编译并安装 APK，移除本 demo 的 `adb reverse`，通过标准输入将已有凭据迁入应用私有目录，再安装并打开 AIUI。凭据不出现在命令参数或日志中，不打包进 APK / AIX。首次启动使用 Android Keystore 加密保存，随后删除导入明文；后续安装保留眼镜上已刷新的凭据。

源码和构建产物：

- `native-pairing/src/com/prism/musepair/MuseService.java`：原生前台服务。
- `MuseCloud.java` / `Noise.java` / `Wire.java`：云端会话、Noise XX 加密和协议编码。
- `CredentialStore.java`：Keystore 加密与原子保存。
- `LocalApi.java`：仅监听眼镜 127.0.0.1:18787，沿用 AIUI 接口。
- `native-pairing/build/muse-pairing.apk`：开发版 APK。
- `../.aiui-build/rokid-muse-aiui/package.aix`：AIUI 包。

依赖通过阿里 Maven 源下载并核对固定 SHA-256；`sh native-pairing/build.sh` 可重新编译。APK 为可用 run-as 导入的开发调试版。持续连接使用前台服务和 CPU 唤醒锁，电量影响需要真机测量。

### 验收步骤

1. 确认眼镜能独立访问 Muse，AIUI 显示“Muse 在线”。
2. 长按说话，结束录音后发送，确认真实回复。
3. **拔掉 USB，并关闭 Mac**，再次发问并确认新回复。
4. 眼镜重启后，验证服务恢复连接及发送。

2026-10-08：APK 和 AIX 已构建；Java 协议与官方 Python SDK 互操作测试通过；同一份 Java 云端代码在电脑上已连接真实 Muse，完成注册、消息发送和完整回复。**目前 ADB 未检测到眼镜，因此新版尚未安装，尚不能宣称已通过拔线真机验证。**

## 配对与旧实验的边界

本次迁移支持**已经配对的眼镜脱离 Mac 运行**。最初 iPhone Muse → BLE → 眼镜的 v5 配对仍保留原开发方案：原生 GATT Server 加 Mac `dev/pairing-server.py`。尚未将全套初次配对协议迁到 Android；以后清除授权或新增设备时仍需开发配对流程。

历史配对记录、原 Mac 云端桥接和截图见 `docs/validation.md`。`dev/cloud-server.py` 与 `dev/bridge.mjs` 保留作对照，不是独立版的运行依赖。

## 测试

```bash
npm test
python3 -m pytest tests/test_cloud.py
sh native-pairing/build.sh
python3 native-pairing/tests/test_protocol.py
```

`test_protocol.py` 使用相邻 `muse-validation-research/linux/src` 官方 SDK，验证 Java Noise 握手、协议封装、多片 UTF-8 解码、错误认证标签和低阶公钥拒绝。测试辅助类不编译进 APK。

Python 测试还需要独立安装官方 SDK 及其依赖、`pytest` 和 `dev/requirements-cloud.txt` 中的依赖。当前默认 SDK 目录为仓库旁的 `muse-validation-research`；Python 云端桥接支持通过 `MUSE_SDK_SOURCE` 覆盖目录，协议测试仍使用默认目录。开发配对脚本还沿用实验设备的固定身份，新增设备前需要配置独立身份。

## 凭据与隐私

SDK Token、账号令牌、配对记录、私钥和调试签名密钥仅保存在本机或眼镜私有存储，不应提交到仓库或打包进 APK / AIX。`.gitignore` 排除了本地授权状态、依赖缓存、构建产物和真机截图。历史验证文档中的截图文件名为本地证据索引，图片不随源码分发。

## 许可证

项目源码采用 [Apache-2.0](LICENSE)；第三方依赖及协议来源见 [THIRD-PARTY.md](native-pairing/THIRD-PARTY.md)，Muse SDK 原始许可保留于 [MUSE-SDK-LICENSE](native-pairing/MUSE-SDK-LICENSE)。Muse 服务的使用仍须遵守其官方服务及 SDK 条款。

## Muse 原生语音消息

语音输入保留 AIUI 的 16kHz 单声道 PCM 录音，移除宿主 SpeechRecognitionSession。录音仅暂存在内存，用户确认发送后通过本机 `/voice-notes` 接口上传；取消、重录或离开页面会丢弃未发送音频。录音限制为 0.3–15 秒，15 秒自动结束。

Android 服务校验音频长度并封装标准 PCM16 WAV，以 `items` 中的 `audio/wav`、`data_base64` 文件附件发送到 Muse `/chat/stream`，复用已有授权与 Noise 连接。大请求按 16KB 请求体块传输。用户转写与助手回复分开处理，只有关联当前发送消息的 `message.user` 转写用于更新“你”的文字。

发送前显示录音时长，不显示识别草稿；Muse 转写事件若未返回，保留语音消息时长。上传失败保留录音供用户重试，已提交请求超时后需在 Muse 中核实是否收到，避免重复发送。该方案依赖 Muse 云端，未使用 SDK 默认关闭的 `/api/voice/dictation`。

录音与取消测试：`npm test`。WAV 封装、输入校验及转写隔离测试：构建 APK 后，编译并运行 `native-pairing/tests/VoiceNoteCheck.java`（classpath 包含 `build/classes` 和 `deps/*`）。
