# Web 前端的「发布介质」
# ------------------------------------------------------------------
# 这个 Dockerfile 不跑任何进程 —— 它只是把 dist/ 打成一个镜像，
# 让前端产物能像后端一样走「Actions 构建 → Docker Hub → 服务器 pull」。
#
# 为什么不用 nginx 直接当运行时：
#   线上已经有独立的 nginx 容器（/data/docker/nginx）在管 80/443 和证书，
#   再起第二个 nginx 抢端口只会更乱。所以这里只在构建阶段产出静态文件，
#   运行时用一个空的 alpine 占位，服务器通过 `docker create` + `docker cp`
#   把文件取到宿主机，交给现有 nginx 去 serve。
#
# 好处：
#   · 产物有版本（sha-xxxx），可回滚到任意一次提交
#   · 前端发布不再依赖「本地打包 + scp」，CI 上产出的就是线上跑的
#   · 镜像很小（几 MB），推送和拉取都很快

# ---- 构建阶段：Node 里跑 vite build ----
FROM node:22-alpine AS build
WORKDIR /app

# 先只拷依赖清单，利用层缓存：只改业务代码时 npm ci 这一步会命中缓存
COPY package.json package-lock.json ./
RUN npm ci

# 再拷源码构建
COPY . .
RUN npm run build

# ---- 运行时：纯占位，只为让 docker pull 有个可拉的壳 ----
FROM alpine:3.20
WORKDIR /www

# 产物放在 /www 下，服务器 pull 后从这里 cp 出来
COPY --from=build /app/dist /www

# 留个说明文件，进容器看的时候不至于一脸茫然
RUN printf '%s\n' \
  '静态产物在 /www，由宿主机取出后交给 nginx serve。' \
  '取出方式见 roller-server/deploy/update-web.sh。' \
  > /www/.README

# 没有任何进程需要启动；用 CMD 而非 ENTRYPOINT，
# 这样 `docker run <image> sh` 仍然能进容器排查。
CMD ["true"]
