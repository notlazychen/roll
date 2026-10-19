#!/usr/bin/env bash
# 服务器端一键更新（在 Lighthouse 上的部署目录里执行）
# ------------------------------------------------------------------
# 前置：本目录下已有 .env（从 .env.example 复制并填好），且镜像已由
#       GitHub Actions 构建推送到 Docker Hub。
#
# 用法：
#   ./update.sh              # 拉最新 latest 并滚动重启
#   ./update.sh sha-a1b2c3d  # 指定标签（回滚或灰度都靠它）
#
# 做的事：
#   1. 记录当前在跑的镜像，失败时能说清楚是从哪个版本升上来的
#   2. pull 新镜像
#   3. 只重建 api 容器（数据库容器不动，数据不受影响）
#   4. 等健康检查通过，超时则打印日志并退出非 0

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

COMPOSE_FILE="docker-compose.lighthouse.yml"
IMAGE_REPO="crazor6/roll"
TARGET_TAG="${1:-latest}"
HEALTH_URL="http://127.0.0.1:8080/health"

if [[ ! -f .env ]]; then
  echo "❌ 缺少 .env。先执行： cp .env.example .env  然后填好数据库密码和 Jwt__Key" >&2
  exit 1
fi

# 把 .env 里的 ROLL_IMAGE 改成目标标签，避免「pull 了新的但 up 的还是旧的」
set_image_tag() {
  local tag="$1"
  if grep -qE '^ROLL_IMAGE=' .env; then
    sed -i.bak -E "s|^ROLL_IMAGE=.*|ROLL_IMAGE=${IMAGE_REPO}:${tag}|" .env && rm -f .env.bak
  else
    printf '\nROLL_IMAGE=%s:%s\n' "$IMAGE_REPO" "$tag" >> .env
  fi
}

echo "==> 当前版本"
CURRENT_TAG="$(grep -E '^ROLL_IMAGE=' .env | sed -E 's|.*:||' || echo unknown)"
echo "    $CURRENT_TAG"

echo "==> 切换目标标签：$TARGET_TAG"
set_image_tag "$TARGET_TAG"

echo "==> 拉取镜像 ${IMAGE_REPO}:${TARGET_TAG}"
docker compose -f "$COMPOSE_FILE" pull api

echo "==> 重建 api 容器（数据库不受影响）"
docker compose -f "$COMPOSE_FILE" up -d --no-deps api

echo "==> 等待健康检查"
for i in $(seq 1 40); do
  if curl -fsS -m 3 "$HEALTH_URL" >/dev/null 2>&1; then
    echo "✅ 启动成功，$HEALTH_URL 已就绪"
    docker compose -f "$COMPOSE_FILE" ps
    exit 0
  fi
  sleep 2
done

echo "❌ 80 秒内健康检查未通过，最近日志：" >&2
docker compose -f "$COMPOSE_FILE" logs --tail 80 api >&2
echo "" >&2
echo "回滚命令： ./update.sh $CURRENT_TAG" >&2
exit 1
