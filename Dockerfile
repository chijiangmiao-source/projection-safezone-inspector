# syntax=docker/dockerfile:1

# 构建阶段：安装依赖并产出静态文件
FROM node:20-alpine AS build
WORKDIR /app
# 构建阶段不需要浏览器，跳过 playwright 浏览器下载
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# 运行阶段：nginx 托管静态产物
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
