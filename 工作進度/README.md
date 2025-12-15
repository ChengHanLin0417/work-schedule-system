# 工作排程系統 (Work Schedule System)

這是一個簡單且高效的工作排程與任務管理系統，提供完整的任務追蹤、進度管理和團隊協作功能。

## 📋 功能特色

### 核心功能
- **任務管理**：創建、編輯、刪除任務，支援多種狀態（待辦、進行中、完成）
- **進度追蹤**：任務完成度（0-100%）、截止日期、完成日期管理
- **優先級管理**：高、中、低三級優先級設定
- **人員分配**：負責人和執行人多選功能
- **搜尋與篩選**：即時搜尋任務標題和備註，支援多種篩選條件
- **排序功能**：支援多欄位排序（標題、狀態、優先級、日期、完成度等）
- **內聯編輯**：直接在列表中編輯任務欄位，自動儲存
- **多人協作**：支援多人同時連線，自動同步數據，防止資料衝突

### 視覺化功能
- **首頁儀表板**：統計卡片、快速操作、最近任務、即將到期任務
- **行事曆**：整合台灣假日，視覺化顯示任務日期
- **便利貼**：快速筆記功能，支援多色標籤、圖片和檔案上傳
- **主題切換**：支援暗色/亮色模式切換
- **響應式設計**：適配各種螢幕尺寸

### 檔案管理
- **PDF 上傳**：支援 PDF 檔案上傳和管理，可線上預覽
- **圖片上傳**：支援圖片上傳和即時預覽，支援貼上圖片
- **檔案管理**：檔案列表顯示和刪除功能
- **無大小限制**：支援大檔案上傳

### 使用者功能
- **使用者管理**：新增、編輯、刪除使用者
- **登入認證**：使用者登入驗證機制
- **導航排序**：可拖曳調整導航選單順序
- **自動重定向**：訪問根路徑自動跳轉到預設頁面

### 數據同步與版本控制
- **版本控制**：每個任務都有版本號，防止資料覆蓋
- **自動同步**：每 30 秒自動從伺服器同步最新數據
- **衝突檢測**：自動檢測並處理多人同時編輯的衝突
- **唯一 ID 生成**：後端生成唯一任務 ID，避免重複

## 🏗️ 技術架構

### 前端
- **HTML5 / CSS3**：響應式設計，支援現代瀏覽器
- **Vanilla JavaScript**：原生 JavaScript，無框架依賴
- **API 整合**：RESTful API 通訊
- **性能優化**：搜尋輸入防抖（Debounce）機制
- **單頁應用**：使用 Hash 路由實現 SPA 體驗

### 後端
- **Node.js**：運行環境
- **Express.js**：Web 框架
- **Multer**：檔案上傳處理（無大小限制）
- **JSON 儲存**：輕量級資料儲存方案
- **版本控制**：任務版本管理和衝突檢測
- **唯一 ID 生成**：防止多人同時創建任務時 ID 衝突

### 部署
- **Docker**：容器化部署
- **Docker Compose**：多容器編排
- **Nginx**：Web 伺服器，支援 SPA 路由
- **API 服務**：獨立後端 API 服務（端口 3000）
- **數據持久化**：使用 Volume 掛載確保數據不丟失

## 📁 專案結構

```
project-root/
├── assets/
│   ├── css/
│   │   └── style.css          # 樣式表
│   └── js/
│       ├── app.js             # 主要應用邏輯
│       ├── api.js             # API 封裝
│       └── data.js            # 資料定義
├── server/
│   ├── data/                  # 資料儲存目錄
│   │   ├── tasks.json         # 任務資料
│   │   ├── users.json         # 使用者資料
│   │   ├── notes.json         # 便利貼資料
│   │   └── changelog.json     # 更新記錄（保留）
│   ├── uploads/               # 上傳檔案目錄
│   ├── server.js              # 後端伺服器
│   ├── package.json           # Node.js 依賴
│   └── Dockerfile             # API 服務 Docker 配置
├── index.html                 # 主頁面
├── nginx.conf                 # Nginx 配置
├── Dockerfile                 # Web 應用 Docker 配置
├── docker-compose.yml         # Docker Compose 配置
└── README.md                  # 本文件
```

## 🚀 快速開始

### 前置需求
- Docker Desktop（Windows/Mac）或 Docker Engine（Linux）
- Docker Compose

### 安裝步驟

1. **克隆專案**
```bash
git clone <repository-url>
cd work-schedule-system
```

2. **啟動服務**
```bash
docker-compose up -d
```

3. **訪問應用**
   - 本機訪問：http://localhost:8080
   - 預設會自動跳轉到：`/?sort=completeDate&dir=asc&owner=all#home`

### 停止服務
```bash
docker-compose down
```

### 重新構建
```bash
docker-compose up -d --build
```

或分別構建特定服務：
```bash
docker-compose up -d --build web    # 只重新構建前端
docker-compose up -d --build api    # 只重新構建後端
```

## 🔧 配置說明

### 修改端口
編輯 `docker-compose.yml` 文件：
```yaml
services:
  web:
    ports:
      - "8080:80"  # 將 8080 改為你想要的端口
```

然後重新啟動：
```bash
docker-compose down
docker-compose up -d
```

### 資料持久化
資料儲存在以下目錄，會自動掛載到容器：
- `server/data/`：任務、使用者、便利貼資料
- `server/uploads/`：上傳的檔案

**重要**：這些目錄的資料會持久保存，即使容器重新構建也不會丟失。

## 📖 使用說明

### 任務管理

1. **創建任務**
   - 點擊「+ 新頁面」按鈕
   - 填寫任務名稱、狀態、優先級等資訊
   - 設定負責人和執行人
   - 設定截止日期和完成度
   - 系統會自動生成唯一 ID

2. **編輯任務**
   - 在任務列表中點擊任務名稱進入詳情頁面
   - 或直接在列表中編輯欄位（內聯編輯）
   - 修改後會自動儲存

3. **篩選任務**
   - 使用搜尋框搜尋任務標題或備註（2秒防抖）
   - 使用「全部執行人」下拉選單篩選
   - 點擊首頁統計卡片快速篩選

4. **排序任務**
   - 點擊表格標題欄進行排序
   - 支援多欄位排序（標題、狀態、優先級、日期、完成度）
   - 排序狀態會保存在 URL 中

### 首頁功能

- **統計卡片**：顯示任務總數、已完成、進行中、待辦數量
- **快速操作**：快速跳轉到各功能頁面
- **最近任務**：顯示最近更新的任務
- **即將到期**：顯示即將到期的任務，包含逾期提醒

### 行事曆

- 顯示台灣假日（2024-2026年）
- 標記任務的截止日期和完成日期
- 點擊日期查看相關任務

### 便利貼

- 創建、編輯、刪除便利貼
- 支援多個便利貼同時管理
- 支援顏色標籤
- 支援圖片和檔案上傳
- 支援富文本編輯

## 🔍 開發說明

### API 端點

#### 任務 API
- `GET /api/tasks`：獲取所有任務
- `POST /api/tasks`：創建單一任務或批次保存（向後相容）
- `PUT /api/tasks/:id`：更新單一任務（含版本檢查）
- `DELETE /api/tasks/:id`：刪除單一任務

#### 使用者 API
- `GET /api/users`：獲取所有使用者
- `POST /api/users`：保存所有使用者

#### 便利貼 API
- `GET /api/notes`：獲取所有便利貼
- `POST /api/notes`：保存所有便利貼

#### 檔案 API
- `POST /api/upload`：上傳檔案（無大小限制）

#### 其他 API
- `GET /api/health`：健康檢查
- `GET /api/version`：獲取數據版本信息
- `GET /api/changelog`：獲取更新記錄
- `POST /api/changelog`：添加更新記錄

### 本地開發

如果需要本地開發（不使用 Docker）：

1. **啟動後端 API**
```bash
cd server
npm install
node server.js
```
後端服務會在 http://localhost:3000 運行

2. **啟動前端**
   - 使用任何靜態檔案伺服器（如 `python -m http.server 8080` 或 `npx serve -p 8080`）
   - 或直接開啟 `index.html`（需配置 CORS）

## 📄 授權

MIT License

## 👥 維護者
ChengHanLin
