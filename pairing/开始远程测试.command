#!/bin/zsh
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/Library/Android/sdk/platform-tools:$PATH"
for tool_dir in "$HOME"/.nvm/versions/node/*/bin(N); do export PATH="$tool_dir:$PATH"; done
cd "$(dirname "$0")"
echo "1 安装修复包；2 自动对比订阅；3 收集最终诊断包；4 持续记录 120 秒；5 默认主会话；6 旧 official 对照"
read "choice?请选择 1 至 6："
case "$choice" in
  1) python3 scripts/setup.py setup --rebind ;;
  2) python3 scripts/remote_test.py matrix ;;
  3) python3 scripts/remote_test.py collect ;;
  4) python3 scripts/remote_test.py watch --seconds 120 ;;
  5) python3 scripts/remote_test.py open --profile main ;;
  6) python3 scripts/remote_test.py open --profile official ;;
esac
echo "按回车关闭窗口。"
read
