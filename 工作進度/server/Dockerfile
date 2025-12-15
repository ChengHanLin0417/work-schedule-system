FROM node:18-alpine

WORKDIR /app

# 複製 package.json 並安裝依賴
COPY package.json ./
RUN npm install

# 複製服務器文件
COPY server.js ./

# 創建數據目錄和上傳目錄
RUN mkdir -p data uploads

# 暴露端口
EXPOSE 3000

# 啟動服務器
CMD ["node", "server.js"]

