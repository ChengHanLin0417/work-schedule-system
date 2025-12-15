# 使用官方 nginx 鏡像作為基礎
FROM nginx:alpine

# 複製網站文件到 nginx 的默認目錄
COPY . /usr/share/nginx/html

# 複製自定義 nginx 配置
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 暴露 80 端口
EXPOSE 80

# 啟動 nginx
CMD ["nginx", "-g", "daemon off;"]

