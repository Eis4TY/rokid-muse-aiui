# 真机验证记录

日期：2026-10-08；Rokid RG_glasses，Android 12；AIUI 逻辑视口 480×352。

| 项目 | 结果与证据 |
| --- | --- |
| aix 安装与启动 | 安装成功，实际截图确认页面渲染 |
| 会话 / 诊断 / 返回 | 真机界面切换通过，用户确认触控正常 |
| 语音输入 | 用户确认正常；09:30:27–34 日志连续 voice.result，最终 21 字符；09:30:41 voice.end，hasDraft=true |
| USB 桥接 | health=online；transport.ok，32 字符，museSent=false |
| BLE 服务发现 | 蓝牙可用，按 Muse UUID 找到 1 个未命名设备 |
| BLE 双向通信 | GATT 连接与订阅成功；收到 device_info，model=hatch_link，pairing_protocol=5 |
| 自动测试 | 4 项：UTF-8 分帧、丢帧恢复、传输收据与真实 Muse 发送区分、已配对不等于会话通道可用 |
| Muse 云端会话 | 蓝牙配对与账号 Token 验证通过；Noise 在线注册与对话通道未接入 |

BLE 对端为本机 MuseMacProbe，成功读取其设备信息仅证明眼镜与探针的蓝牙传输。首次语音尝试曾报错，后续实际输入成功；未验证长期稳定性与全部宿主异常状态。

截图：device-chat.png、device-diagnostics.png。SDK 凭据未加入项目和打包产物。

## 官方手机配对实验（补充）

核心验收为手机 Muse → 眼镜 Gadget 的官方配对，前面的 AIUI → Mac 探针通信不等同于此项。

- 已安装独立原生辅助 APK；眼镜 `isMultipleAdvertisementSupported=true`，GATT Server 注册成功。
- 已广播官方 UUID、manufacturer=FFFF00、完整名字 MuseGadgetA17C09；Mac 扫描验证三项一致。
- Mac Central 实际连接眼镜 Server、订阅 TX、写 RX，收到 device_info（hatch_link / v5）。
- 用户断开原 Rokid 手机连接后，Muse App 成功发现眼镜。
- 09:49:11 Muse App 的 get_device_info 请求与回复通过，进入 Connect to MuseGadgetA17C09 确认页。
- 官方 Linux pairing / ble_setup 的 74 项测试通过（独立测试环境，依赖使用阿里源）。
- 09:49:47 官方手机握手通过：pairing_client_hello → pairing_ready → encrypted pairing_client_finished → pairing_confirmed；09:49:55 encrypted wifi_scan / wifi_scan_result 通过。
- 09:52:27 第二次加密握手通过；修正 current connection 的 secure=false，手机不再要求 Wi-Fi 密码。
- 09:53:34 encrypted provision_v2 通过；wifi_connecting / wifi_connected 均加密发送。
- 09:53:35 官方 VM fetch 返回 1 VM，设备 Token 验证成功；加密 auth_ok、setup complete、PAIRING_COMPLETE 均确认。
- /health paired=true；pairing.json 权限为 600；手机结束配对流程返回会话界面。账号配对完整成功。

当前架构：iPhone Muse App ← BLE → 眼镜原生辅助 APK ← USB localhost:18788 → Mac 官方 SDK。AIUI 负责界面；完整独立运行仍需把配对与账号逻辑迁到眼镜宿主。

最终 AIUI /health 显示 muse=paired、message_channel=not_connected。已更新并安装 AIUI 和原生辅助程序，重启原生辅助程序能读取已配对状态。Muse 手机设备列表目前只显示 iPhone；还未启动 Noise link.register，因此不宣称 Gadget 云端在线。

## 云端对话接入（2026-10-08）

- 官方 Noise XX 握手与 link.register 成功；注册名称 Glasses_0068 · Muse，未开放远程执行 commands。
- POST /chat/subscribe 必须传眼镜会话 session_id；默认 {} 订阅主会话，收不到眼镜侧会话回复。
- session_id 使用合法 UUID；非 UUID 测试被服务器 HTTP 400 拒绝。
- POST /chat/stream 返回真实接收回执；订阅收到 delta.message_start / delta.text_append / delta.message_done。
- 真机截图 device-reply.png 显示 Muse 在线及真实回复“成功了。”；用户随后确认语音发送能看到新回复。
- 已加入连接重试、消息失败保留草稿、会话隔离、流式回复轮询与阅读滚动。
- 回归验证：Node 5 项、Python 云端 3 项全部通过。
- 蓝牙系统名再次核实为 Glasses_0068。

当前运行仍需要 Mac + USB；云端通道已接入。上文“尚未接入”描述的是此前实验阶段状态。

## 脱离 Mac 的运行链路迁移（2026-10-08）

- 新链路：AIUI → 眼镜 localhost:18787 → 原生 MuseService → Muse 云端。
- Java 实现 Noise_XX_25519_AESGCM_SHA256、官方 protobuf/Noise 分片、WebSocket /v1/noise、link.register、专用会话订阅和消息提交；同一会话 UUID 保留。
- 增加前台服务、开机恢复、断线重连、设备令牌刷新；凭据用 Android Keystore 加密并原子写入。
- 迁移工具仅通过 ADB 标准输入导入已有凭据，不记录令牌，不打包凭据。保留设备已刷新的加密凭据，不重复覆盖。
- 移除本 demo 18787/18788 的 USB reverse；原 Mac Node/Python 服务不再是运行依赖。
- Java 与未经修改的官方 SDK Noise Responder 互操作通过：握手、/chat/subscribe 请求解析、70002 字节含 UTF-8 回复分片解码、错误 GCM 标签与低阶 X25519 公钥拒绝、分片数量上限。
- 同一份 Java MuseCloud 在电脑上连接真实 Muse：云端注册 + 指定会话订阅成功；发送测试问题后收到完整真实回复（11 字符）。该测试使用电脑网络代理，不能代表眼镜自身网络已通过。
- 本机 HTTP → Java 云端 → 真实 Muse 回复的完整链路通过；本机 transport-check 的回执不声称消息已送到 Muse。
- Node 5 项、Python 云端 3 项回归通过；APK / AIX 构建通过，APK 确认未包含 JVM 测试辅助类。ADB 当前没有已连接的眼镜，新版部署、Keystore 真机测试、拔 USB 对话和重启恢复尚待验证。
- 初次 BLE 配对仍使用旧开发桥接；本次迁移覆盖当前已配对设备的独立运行，不宣称已实现所有新设备的无 Mac 首次配对。
