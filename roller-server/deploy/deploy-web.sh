#!/usr/bin/env bash
# Web 前端发布（在 Lighthouse 上的部署目录里执行）
# ------------------------------------------------------------------
# 前后端同域：https://roll.acgun.cn
#   /api/*  -> roll 容器（后端）
#   其余     -> nginx 容器里的 /var/www/web（本脚本负责把产物放进去）
#
# 用法：
#   ./deploy-web.sh ../dist          # 把本地打包好的 dist 传上来后，指向它就发布
#   ./deploy-web.sh ../dist --keep   # 同上，但保留旧版本的备份目录不清理
#
# 做的事：
#   1. 检查产物里确实有 index.html
#   2. 先同步到 /data/docker/web.next（新目录），避免半同步状态被用户看到
#   3. 原子切换：web -> web.prev，web.next -> web
#   4. 校验线上首页可访问，失败自动回滚
#
# 注意：nginx 容器把宿主机的 /data/docker/web 以只读方式挂到 /var/www/web，
#       所以这里改宿主机目录即可，不需要 reload nginx。

set -euo pipefail

SRC="${1:-}"
KEEP="${2:-}"
WEB_ROOT="/data/docker/web"
WEB_NEXT="/data/docker/web.next"
WEB_PREV="/data/docker/web.prev"

if [[ -z "$SRC" || ! -d "$SRC" ]]; then
  echo "❌ 用法： ./deploy-web.sh <dist 目录>" >&2
  exit 1
fi

if [[ ! -f "$SRC/index.html" ]]; then
  echo "❌ $SRC 里没有 index.html，看起来不是打包产物" >&2
  exit 1
fi

echo "==> 准备新目录 $WEB_NEXT"
rm -rf "$WEB_NEXT"
mkdir -p "$WEB_NEXT"
# -a 保留权限与时间戳；末尾斜杠表示同步目录内容而不是目录本身
cp -a "$SRC/." "$WEB_NEXT/"

echo "==> 原子切换"
rm -rf "$WEB_PREV"
if [[ -d "$WEB_ROOT" ]]; then
  mv "$WEB_ROOT" "$WEB_PREV"
fi
mv "$WEB_NEXT" "$WEB_ROOT"
chmod -R a+rX "$WEB_ROOT"

echo "==> 校验首页"
if ! curl -fsS -m 5 -o /dev/null "https://roll.acgun.cn/"; then
  echo "❌ 首页不可访问，回滚到上一版本" >&2
  if [[ -d "$WEB_PREV" ]]; then
    rm -rf "$WEB_ROOT" && mv "$WEB_PREV" "$WEB_ROOT"
    echo "已回滚。" >&2
  else
    echo "没有可回滚的版本（首次发布）。" >&2
  fi
  exit 1
fi

echo "==> 校验前端路由回退（/login 应返回 200）"
curl -fsS -m 5 -o /dev/null "https://roll.acgun.cn/login" \
  && echo "    SPA 回退正常" \
  || echo "    ⚠️ /login 未返回 200，请检查 nginx 的 try_files 配置"

if [[ "$KEEP" != "--keep" && -d "$WEB_PREV" ]]; then
  rm -rf "$WEB_PREV"
fi

echo "✅ 前端已发布到 https://roll.acgun.cn"
