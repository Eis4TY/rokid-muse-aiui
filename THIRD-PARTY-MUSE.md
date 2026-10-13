Noise XX 和协议封装改写自 Meta Muse Gadget SDK（Apache-2.0）：https://github.com/facebookincubator/muse-gadget-sdk 。协议实现文件为 lib/muse-noise.js、lib/muse-wire.js。
加密算法使用 @noble/curves 1.4.2、@noble/ciphers 0.5.3、@noble/hashes 1.4.0（MIT），以纯 JavaScript ES module 打包进 lib/muse-crypto.js，无 Node.js 运行时依赖。许可证随 AIX 放在 legal/。


## Lucide 状态图标

本地 `assets/icons/cloud.svg`、`cloud-off.svg` 和 `loader.svg` 来自 https://github.com/lucide-icons/lucide 。仅将描边颜色改为眼镜显示绿色。许可证见 `legal/LUCIDE-LICENSE`。图标随 AIX 打包，运行时不访问在线图标地址。
