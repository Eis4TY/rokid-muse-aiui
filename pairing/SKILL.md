---
name: rokid-muse-pairing
description: 通过 USB 为 Rokid 眼镜安装 Muse 像素头像 AIUI 和原生 BLE 配对组件，引导手机 Muse 确认配对，自动交接授权并通过 Rokid 手机网络收发消息；支持已有授权升级、重配和远程诊断。
---

# Rokid Muse 配对与像素头像 AIUI

0.3.1 使用像素头像版 AIUI。先读 [快速上手](references/快速上手.md)。随包提供 APK、AIX、脚本与公开源码；安装不需要原工程、JDK 或 Android SDK。Windows 入口沿用旧版，尚未完成 Windows 实机验证。

## 安装与配对

运行 `python3 scripts/setup.py check`，再运行 `python3 scripts/setup.py setup`；Windows 使用 `python`。自动选择唯一在线眼镜，多设备时指定 `--serial`。用户已要求安装或配对时直接执行授权范围内操作，不重复确认。

新用户需要自己的 SDK token，入口：https://gadgets.muse.ai/settings/sdk-tokens 。脚本隐藏输入，也支持 `--sdk-token-file`。SDK token 是开发者标识，不是设备授权。不要复用他人的 SDK token、设备授权或身份，不将它们写入命令参数、日志、回复或发布包。

安装沿用当前像素头像版应用 ID；AIX 内部 VERSION 每次改变以刷新代码缓存。已有眼镜身份、应用存储和授权保留。绑定目标应用改变或执行 `--rebind` 时，通过 USB 临时 localhost 传递随机绑定密钥；确认后移除 reverse。已有像素版授权时直接启动，不要求重新配对。

新眼镜由原生组件生成独立身份和广播名；只在脚本核实当前进程广播成功后提示手机扫描。手机操作：

1. 手机系统设置 → 蓝牙 → 忽略眼镜原有连接，仅断开不够。
2. Muse → Developer mode → Add Device，选择脚本显示的实际 MuseGadget 名称，确认。
3. 关闭手机 VPN，用 Rokid App 回连眼镜。
4. 回连成功后，非美国地区开启并保持手机 VPN，运行 `setup.py open`。

授权经眼镜本机挑战/HMAC/AES-GCM 交接，由 AIUI 经手机通道验证云端、保存、回读并确认；不输入六位交接码。失败保留旧授权，自动重试。配对组件收到确认后只保留交接回执；AIUI 负责刷新令牌。日常运行不依赖 Mac、USB 网络转发或眼镜 Wi-Fi。

## 升级边界

升级保留当前应用的身份与授权，见 [升级说明](references/升级说明.md)。禁止从开发者电脑导入账号令牌作为通用安装方案。

`setup --rebind` 修复本机绑定，不撤销 Muse 授权。`pair` 重新打开 10 分钟广播窗口；重新配对前按用户意图在 Muse 移除旧 Gadget，完成上述手机流程。禁止为测试而卸载、清空数据或恢复出厂。

## 验证与诊断

区分安装、广播、配对、交接和对话。`binding_ready` 是本机绑定；`handoff_ready` 是待交接；`delivered` 是保存回执。`native.auto cloud_verified=true` 才说明新授权已验证；“Muse 在线”或 HTTP 200 不等于收到助手回复。核实运行日志 `loaded release=0.3.1`，并实际发送一次录音、等待真实回复。

默认 main：/chat/subscribe 正文 {}、hatch-web，发送不指定 session_id，手机与眼镜共享账号主会话。回复优先关联父消息 ID；无父 ID 仅在本次用户回显、ACK 会话一致、非 thread、90 秒窗口内接收。不得放开过滤接收账号所有文本，不按全局 seq 丢弃不同事件流。

广播失败、授权错误、超时或无回复，读 [故障排查](references/故障排查.md)，用 `remote_test.py collect` / `watch` 收集脱敏 ZIP。不得打包完整 logcat、令牌或录音。当前已验证的范围与最新结果见 [版本说明](版本说明.md)，不要把旧版实测等同本次所有型号验收。
