FROM node:20-alpine

# Cài đặt pm2 toàn cục
RUN npm install -g pm2

# Thiết lập thư mục làm việc
WORKDIR /app

# Copy cấu hình package
COPY package*.json ./

# Cài đặt thư viện
RUN npm ci || npm install

# Copy source code
COPY . .

# Phục vụ port 3001
EXPOSE 3001

# Chạy PM2 Cluster Mode sử dụng tất cả số nhân CPU
CMD ["pm2-runtime", "start", "server.js", "-i", "max"]
