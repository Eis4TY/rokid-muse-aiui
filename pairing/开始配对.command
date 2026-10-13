#!/bin/zsh
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/Library/Android/sdk/platform-tools:$PATH"
for tool_dir in "$HOME"/.nvm/versions/node/*/bin(N); do
  export PATH="$tool_dir:$PATH"
done
cd "$(dirname "$0")"
python3 scripts/setup.py setup
result=$?
if (( result == 0 )); then
  echo "手机 Muse 配对前：在手机设置 → 蓝牙中忽略眼镜原有连接。配对后：关闭手机 VPN，用 Rokid App 回连眼镜。"
  echo "回连成功后，非美国地区请开启并保持手机 VPN。准备好后按回车打开 AIUI。"
  read
  python3 scripts/setup.py open
  result=$?
fi
echo "按回车关闭此窗口。"
read
exit $result
