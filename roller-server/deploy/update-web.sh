#!/usr/bin/env bash
# Web 前端一键更新（在 Lighthouse 的 /data/docker/roll 目录里执行）
# ------------------------------------------------------------------
# 前端产物由 GitHub Actions 构建并推送成镜像（crazor6/roll-web）。
# 镜像里没有进程，只是「装了静态文件的容器」，本脚本负责把文件取到宿主机，
# 再交给已经在跑的 nginx 容器去 serve。
#
# 用法：
#   ./update-web.sh                  # 拉 latest 并发布
#   ./update-web.sh sha-a1b2c3d      # 指定标签（回滚到某次提交就靠它）
#   ./update-web.sh latest --keep    # 发布后保留上一版本备份
#
# 做的事：
#   1. docker pull 目标标签
#   2. docker create 一个临时容器（不启动）
#   3. docker cp 把 /www 下的产物取到影子目录 /data/docker/web.next
#   4. 原子切换：web -> web.prev，web.next -> web
#   5. 校验首页可访问，失败自动回滚
#
# 前置（一次性）：
#   nginx 容器必须把宿主机的 /data/docker/web 挂到 /var/www/web（只读），
#   否则文件放对了位置 nginx 也看不见：
#     docker run ... -v /data/docker/web:/var/www/web:ro ...

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

IMAGE_REPO="crazor6/roll-web"
TARGET_TAG="${1:-latest}"
KEEP="${2:-}"
WEB_ROOT="/data/docker/web"
WEB_NEXT="/data/docker/web.next"
WEB_PREV="/data/docker/web.prev"
SITE_URL="${SITE_URL:-https://roll.acgun.cn}"

if [[ "$TARGET_TAG" == --* ]]; then
  echo "❌ 第一个参数应为标签，例如 ./update-web.sh sha-a1b2c3d" >&2
  exit 1
fi

IMAGE="${IMAGE_REPO}:${TARGET_TAG}"
CURRENT_TAG="unknown"
if [[ -f .env.web ]]; then
  CURRENT_TAG="$(grep -E '^ROLL_WEB_IMAGE=' .env.web | sed -E 's|.*:||' || echo unknown)"
fi

echo "==> 当前前端版本：$CURRENT_TAG"
echo "==> 拉取镜像 $IMAGE"
if ! docker pull "$IMAGE"; then
  echo "❌ 拉取失败。检查标签是否存在：https://hub.docker.com/r/${IMAGE_REPO}/tags" >&2
  exit 1
fi

echo "==> 从镜像中取出产物"
CID="$(docker create "$IMAGE")"
# 无论后面成功失败都要删掉这个临时容器，否则每次发布都留一个垃圾
cleanup() { docker rm -f "$CID" >/dev/null 2>&1 || true; }
trap cleanup EXIT

rm -rf "$WEB_NEXT"
mkdir -p "$WEB_NEXT"
docker cp "$CID:/www/." "$WEB_NEXT/"

# 镜像里那个说明文件不需要出现在站点根目录
rm -f "$WEB_NEXT/.README"

if [[ ! -f "$WEB_NEXT/index.html" ]]; then
  echo "❌ 取出的产物里没有 index.html，镜像可能打错了。已中止，线上未变更。" >&2
  exit 1
fi

echo "==> 原子切换"
rm -rf "$WEB_PREV"
if [[ -d "$WEB_ROOT" ]]; then
  mv "$WEB_ROOT" "$WEB_PREV"
fi
mv "$WEB_NEXT" "$WEB_ROOT"
chmod -R a+rX "$WEB_ROOT"

# 记录当前版本，方便下次看到「从哪个版本升上来的」
if grep -qE '^ROLL_WEB_IMAGE=' .env.web 2>/dev/null; then
  sed -i.bak -E "s|^ROLL_WEB_IMAGE=.*|ROLL_WEB_IMAGE=${IMAGE}|" .env.web && rm -f .env.web.bak
else
  printf 'ROLL_WEB_IMAGE=%s\n' "$IMAGE" >> .env.web
fi

echo "==> 校验首页"
if ! curl -fsS -m 5 -o /dev/null "$SITE_URL/"; then
  echo "❌ 首页不可访问，回滚到上一版本" >&2
  if [[ -d "$WEB_PREV" ]]; then
    rm -rf "$WEB_ROOT" && mv "$WEB_PREV" "$WEB_ROOT"
    echo "已回滚到 $CURRENT_TAG。" >&2
  else
    echo "没有可回滚的版本（首次发布）。检查 nginx 是否已挂载 /var/www/web。" >&2
  fi
  exit 1
fi

echo "==> 校验 SPA 路由回退（/login 应返回 200）"
if curl -fsS -m 5 -o /dev/null "$SITE_URL/login"; then
  echo "    SPA 回退正常"
else
  echo "    ⚠️  /login 未返回 200，检查 nginx 配置里的 try_files \$uri /index.html" >&2
fi

if [[ "$KEEP" != "--keep" && -d "$WEB_PREV" ]]; then
  rm -rf "$WEB_PREV"
fi

echo "✅ 前端已发布：$SITE_URL（$TARGET_TAG）"
echo "   回滚： ./update-web.sh $CURRENT_TAG"
