# MindMate Backend Dockerfile for Railway

# 构建阶段
FROM node:18-alpine AS builder

WORKDIR /app

# 复制 package 文件
COPY package*.json ./
COPY server/package*.json ./server/

# 安装依赖
RUN npm install
RUN cd server && npm install

# 复制源代码
COPY server ./server
COPY tsconfig.json ./

# 构建 TypeScript
RUN cd server && npm run build 2>/dev/null || echo "No build script, skipping..."

# 运行阶段
FROM node:18-alpine

WORKDIR /app

# 安装 dumb-init 以处理信号
RUN apk add --no-cache dumb-init

# 复制 package 文件
COPY package*.json ./
COPY server/package*.json ./server/

# 安装生产依赖
RUN npm install --production
RUN cd server && npm install --production

# 复制构建结果和源代码
COPY server ./server

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# 使用 dumb-init 启动应用
ENTRYPOINT ["/sbin/dumb-init", "--"]

# 启动命令
CMD ["node", "server/index.js"]
