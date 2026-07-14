# Build Stage
FROM node:20-alpine AS build

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


# Serve Stage với Nginx
FROM nginx:alpine

# Copy cấu hình nginx tùy chỉnh vào container
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy thư mục build từ Stage 1 sang thư mục phục vụ của Nginx
COPY --from=build /app/dist /usr/share/nginx/html

# Expose port 80 cho container
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
