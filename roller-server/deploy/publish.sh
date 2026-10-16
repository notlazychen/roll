#!/usr/bin/env bash
# 发布脚本：本地编译出可部署产物，并（可选）同步到你自己的服务器
# ------------------------------------------------------------------
# 只发布到本地 publish 目录：
#   ./deploy/publish.sh
#
# 发布并同步到服务器（在 server 目录下执行）：
#   DEPLOY_HOST=user@your-server ./deploy/publish.sh
#
# 依赖：dotnet SDK 10、rsync（同步时才需要）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT="$SERVER_DIR/RandomGroup.Api/RandomGroup.Api.csproj"
OUT_DIR="$SERVER_DIR/publish"

echo "==> 清理旧产物"
rm -rf "$OUT_DIR"

echo "==> 还原依赖"
dotnet restore "$PROJECT"

echo "==> 发布 Release"
dotnet publish "$PROJECT" \
  -c Release \
  -o "$OUT_DIR" \
  --no-restore \
  /p:UseAppHost=false

echo "==> 产物大小"
du -sh "$OUT_DIR"

if [[ -n "${DEPLOY_HOST:-}" ]]; then
  REMOTE_DIR="${DEPLOY_DIR:-/opt/random-group/app}"
  echo "==> 同步到 $DEPLOY_HOST:$REMOTE_DIR"
  # 注意：不会删除服务器上的 app.env（环境变量文件不在 publish 目录里）
  rsync -avz --delete \
    --exclude 'appsettings.Development.json' \
    "$OUT_DIR/" "$DEPLOY_HOST:$REMOTE_DIR/"

  echo "==> 重启服务"
  ssh "$DEPLOY_HOST" 'sudo systemctl restart randomgroup && sleep 2 && systemctl --no-pager status randomgroup | head -20'

  echo "==> 健康检查"
  ssh "$DEPLOY_HOST" 'curl -fsS http://127.0.0.1:5080/health && echo " OK"'
else
  echo "==> 已跳过同步。产物在 $OUT_DIR"
  echo "    如需部署，设置 DEPLOY_HOST=user@host 后重新执行。"
fi
