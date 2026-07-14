FROM node:20-alpine

# Cài đặt serve toàn cục
RUN npm install -g serve

# Thiết lập thư mục làm việc
WORKDIR /app

# Copy file cấu hình package
COPY package*.json ./

# Cài đặt thư viện
RUN npm ci || npm install

# Copy toàn bộ source code
COPY . .

# Build ứng dụng Vite
RUN npm run build

# Phục vụ thư mục dist ở port 5173
EXPOSE 5173
CMD ["serve", "-s", "dist", "-l", "5173"]
