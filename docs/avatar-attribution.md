# 程序化头像来源与移植说明

`lib/muse-avatar.js` 改写自 Meta muse-gadget-sdk 的 `esp32/avatar/muse_pixel.c`。

- 上游版本：812c46f9fe42b69d916613a9dc702cbac5ff7b54
- 来源：https://github.com/facebookincubator/muse-gadget-sdk/blob/812c46f9fe42b69d916613a9dc702cbac5ff7b54/esp32/avatar/muse_pixel.c
- 代码许可证：Apache-2.0，全文见 `muse-sdk-LICENSE.txt`。
- 保留原版权声明；修改包含 JavaScript 实现、复用缓冲、AIUI Canvas 输出和单绿色亮度映射。
- 没有图片、视频、GIF、精灵图或预渲染帧资产。

上游 AVATAR_RECIPE.md 明确说明：默认角色属于 Meta，Apache 代码许可证不授予该角色的形象权利。此 demo 保留默认角色以验证移植效果；对外发布前应取得相应形象授权或替换为有权使用的自有角色。

头像输入为状态、时间、状态持续时间、音量和开心程度。当前 Demo 返回文字，没有语音播放：等待与流式回复绑定 thinking；真实回复完成后回到 idle；不把本地接收回执当成 Muse 回复或语音播放事件。
