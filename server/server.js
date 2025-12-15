const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'data');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const NOTES_FILE = path.join(DATA_DIR, 'notes.json');
const CHANGELOG_FILE = path.join(DATA_DIR, 'changelog.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// 中間件
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// 配置 multer 用於檔案上傳（無大小限制）
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: Infinity }, // 無大小限制
  fileFilter: (req, file, cb) => {
    // 接受所有文件類型（包括所有圖片格式）
    cb(null, true);
  }
});

// 確保數據目錄存在
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    // 確保數據文件存在
    const tasksExists = await fs.access(TASKS_FILE).then(() => true).catch(() => false);
    if (!tasksExists) {
      await writeDataFile(TASKS_FILE, []);
    }
    const usersExists = await fs.access(USERS_FILE).then(() => true).catch(() => false);
    if (!usersExists) {
      await writeDataFile(USERS_FILE, []);
    }
    const notesExists = await fs.access(NOTES_FILE).then(() => true).catch(() => false);
    if (!notesExists) {
      await writeDataFile(NOTES_FILE, []);
    }
    const changelogExists = await fs.access(CHANGELOG_FILE).then(() => true).catch(() => false);
    if (!changelogExists) {
      await writeDataFile(CHANGELOG_FILE, []);
    }
  } catch (error) {
    console.error('創建數據目錄失敗:', error);
  }
}

// 讀取數據文件
async function readDataFile(filePath, defaultValue = []) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // 文件不存在，返回默認值並創建文件
      await writeDataFile(filePath, defaultValue);
      return defaultValue;
    }
    console.error('讀取數據文件失敗:', error);
    return defaultValue;
  }
}

// 寫入數據文件
async function writeDataFile(filePath, data) {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('寫入數據文件失敗:', error);
    return false;
  }
}

// 生成唯一任務 ID（避免多人同時創建時衝突）
let taskIdCounter = 0;
function generateUniqueTaskId(existingIds = []) {
  let id;
  let attempts = 0;
  do {
    // 使用時間戳 + 隨機數 + 計數器確保唯一性
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000000);
    taskIdCounter = (taskIdCounter + 1) % 10000;
    id = `t_${timestamp}_${random}_${taskIdCounter}`;
    attempts++;
    if (attempts > 100) {
      // 如果嘗試100次還衝突，使用更強的隨機性
      id = `t_${timestamp}_${Math.random().toString(36).substr(2, 9)}_${Date.now()}`;
      break;
    }
  } while (existingIds.includes(id));
  return id;
}

// 生成任務的基礎欄位（補齊 version / updatedAt）
function normalizeTask(task, existingIds = []) {
  const now = new Date().toISOString();
  const normalized = { ...task };
  if (!normalized.id || normalized.id.startsWith('t_new_')) {
    normalized.id = generateUniqueTaskId(existingIds);
  }
  if (typeof normalized.version !== 'number') {
    normalized.version = 1;
  }
  if (!normalized.updatedAt) {
    normalized.updatedAt = now;
  }
  return normalized;
}

// 批次正規化並在需要時回寫
async function loadTasksWithMetadata() {
  const tasks = await readDataFile(TASKS_FILE, []);
  let changed = false;
  const existingIds = tasks.map(t => t.id).filter(Boolean);
  const normalized = tasks.map(t => {
    const nt = normalizeTask(t, existingIds);
    if (nt.version !== t.version || nt.updatedAt !== t.updatedAt || nt.id !== t.id) {
      changed = true;
    }
    return nt;
  });
  
  // 檢查並修復重複的 ID
  const idMap = new Map();
  const duplicates = [];
  normalized.forEach((task, index) => {
    if (idMap.has(task.id)) {
      duplicates.push(index);
    } else {
      idMap.set(task.id, index);
    }
  });
  
  if (duplicates.length > 0) {
    changed = true;
    duplicates.forEach(index => {
      const existingIds = normalized.map(t => t.id);
      normalized[index].id = generateUniqueTaskId(existingIds);
    });
  }
  
  if (changed) {
    await writeDataFile(TASKS_FILE, normalized);
  }
  return normalized;
}

// API 路由

// 獲取所有任務
app.get('/api/tasks', async (req, res) => {
  try {
    const tasks = await loadTasksWithMetadata();
    res.json(tasks);
  } catch (error) {
    console.error('獲取任務失敗:', error);
    res.status(500).json({ error: '獲取任務失敗' });
  }
});

// 新增單一任務或批次保存（向後相容）
app.post('/api/tasks', async (req, res) => {
  try {
    const body = req.body;
    // 單筆建立：一律忽略前端傳入的 ID，由後端生成唯一 ID
    if (!Array.isArray(body)) {
      const tasks = await loadTasksWithMetadata();
      const existingIds = tasks.map(t => t.id);
      // 強制移除客戶端 ID，避免舊版前端帶入重複 ID
      const taskData = { ...body };
      delete taskData.id;

      const newTask = normalizeTask(taskData, existingIds);
      
      // 再次檢查 ID 是否唯一（防止極端併發）
      if (existingIds.includes(newTask.id)) {
        newTask.id = generateUniqueTaskId(existingIds);
      }
      
      tasks.push(newTask);
      await writeDataFile(TASKS_FILE, tasks);
      return res.status(201).json(newTask);
    }

    // 舊版行為（一次提交整包任務）不再支持，避免舊版前端覆蓋或產生重複
    const incoming = body;
    if (Array.isArray(incoming)) {
      return res.status(410).json({ error: '前端版本過舊，請重新整理頁面後再試（不支援批次提交全部任務）' });
    }

    const currentTasks = await loadTasksWithMetadata();
    const existingIds = currentTasks.map(t => t.id);
    const map = new Map(currentTasks.map(t => [t.id, t]));
    const conflicts = [];
    const idChanges = []; // 記錄 ID 變更（臨時 ID -> 正式 ID）
    
    incoming.forEach(raw => {
      let task = normalizeTask(raw, existingIds);
      
      // 如果是臨時 ID（t_new_ 開頭），生成新 ID
      if (task.id.startsWith('t_new_')) {
        const oldId = task.id;
        task.id = generateUniqueTaskId(existingIds);
        idChanges.push({ oldId, newId: task.id });
        existingIds.push(task.id);
      }
      
      // 檢查 ID 是否已存在（防止併發衝突）
      if (map.has(task.id) && !task.id.startsWith('t_new_')) {
        const existing = map.get(task.id);
        // 版本不一致時拒絕覆蓋，保留現有資料
        if (typeof task.version === 'number' && typeof existing.version === 'number' && task.version !== existing.version) {
          conflicts.push(task.id);
          return;
        }
        // 允許更新，並提升版本
        const updated = {
          ...existing,
          ...task,
          version: (existing.version || 1) + 1,
          updatedAt: new Date().toISOString()
        };
        map.set(task.id, updated);
      } else {
        // 新任務
        map.set(task.id, task);
        existingIds.push(task.id);
      }
    });

    const merged = Array.from(map.values());
    const success = await writeDataFile(TASKS_FILE, merged);
    if (!success) {
      return res.status(500).json({ error: '保存任務失敗' });
    }

    return res.json({
      success: true,
      message: conflicts.length > 0 ? '部分任務因版本衝突未更新' : '任務已保存',
      conflicts,
      count: merged.length
    });
  } catch (error) {
    console.error('保存任務失敗:', error);
    res.status(500).json({ error: '保存任務失敗' });
  }
});

// 更新單一任務（含版本檢查）
app.put('/api/tasks/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const incoming = req.body || {};
    let tasks = await loadTasksWithMetadata();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: '任務不存在' });
    }
    const current = tasks[idx];

    const updated = {
      ...current,
      ...incoming,
      id,
      version: (current.version || 1) + 1,
      updatedAt: new Date().toISOString()
    };
    tasks[idx] = updated;
    await writeDataFile(TASKS_FILE, tasks);
    res.json(updated);
  } catch (error) {
    console.error('更新任務失敗:', error);
    res.status(500).json({ error: '更新任務失敗' });
  }
});

// 刪除單一任務
app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const id = req.params.id;
    let tasks = await loadTasksWithMetadata();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: '任務不存在' });
    }
    tasks.splice(idx, 1);
    await writeDataFile(TASKS_FILE, tasks);
    res.json({ success: true });
  } catch (error) {
    console.error('刪除任務失敗:', error);
    res.status(500).json({ error: '刪除任務失敗' });
  }
});

// 獲取所有用戶
app.get('/api/users', async (req, res) => {
  try {
    const users = await readDataFile(USERS_FILE, [
      { id: 'user1', name: 'User 1' }
    ]);
    res.json(users);
  } catch (error) {
    console.error('獲取用戶失敗:', error);
    res.status(500).json({ error: '獲取用戶失敗' });
  }
});

// 保存所有用戶
app.post('/api/users', async (req, res) => {
  try {
    const users = req.body;
    if (!Array.isArray(users)) {
      return res.status(400).json({ error: '用戶數據必須是陣列' });
    }
    const success = await writeDataFile(USERS_FILE, users);
    if (success) {
      res.json({ success: true, message: '用戶已保存', count: users.length });
    } else {
      res.status(500).json({ error: '保存用戶失敗' });
    }
  } catch (error) {
    console.error('保存用戶失敗:', error);
    res.status(500).json({ error: '保存用戶失敗' });
  }
});

// 便利貼 API

// 獲取所有便利貼
app.get('/api/notes', async (req, res) => {
  try {
    const notes = await readDataFile(NOTES_FILE, []);
    res.json(notes);
  } catch (error) {
    console.error('獲取便利貼失敗:', error);
    res.status(500).json({ error: '獲取便利貼失敗' });
  }
});

// 保存所有便利貼
app.post('/api/notes', async (req, res) => {
  try {
    const notes = req.body;
    if (!Array.isArray(notes)) {
      return res.status(400).json({ error: '便利貼數據必須是陣列' });
    }
    const success = await writeDataFile(NOTES_FILE, notes);
    if (success) {
      res.json({ success: true, message: '便利貼已保存', count: notes.length });
    } else {
      res.status(500).json({ error: '保存便利貼失敗' });
    }
  } catch (error) {
    console.error('保存便利貼失敗:', error);
    res.status(500).json({ error: '保存便利貼失敗' });
  }
});

// 上傳檔案
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '沒有上傳檔案' });
    }
    const fileUrl = `/uploads/${req.file.filename}`;
    console.log('檔案上傳成功:', {
      originalname: req.file.originalname,
      filename: req.file.filename,
      mimetype: req.file.mimetype,
      size: req.file.size,
      url: fileUrl
    });
    res.json({ 
      success: true, 
      url: fileUrl,
      filename: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype || 'application/octet-stream'
    });
  } catch (error) {
    console.error('上傳檔案失敗:', error);
    res.status(500).json({ error: '上傳檔案失敗: ' + error.message });
  }
});

// 操作日記 API

// 獲取所有更新記錄
app.get('/api/changelog', async (req, res) => {
  try {
    const changelog = await readDataFile(CHANGELOG_FILE, []);
    res.json(changelog);
  } catch (error) {
    console.error('獲取操作日記失敗:', error);
    res.status(500).json({ error: '獲取操作日記失敗' });
  }
});

// 添加更新記錄
app.post('/api/changelog', async (req, res) => {
  try {
    const { version, date, changes } = req.body;
    if (!version || !date || !Array.isArray(changes)) {
      return res.status(400).json({ error: '缺少必要欄位' });
    }
    const changelog = await readDataFile(CHANGELOG_FILE, []);
    const newEntry = {
      id: 'cl_' + Date.now(),
      version,
      date,
      changes,
      createdAt: new Date().toISOString()
    };
    changelog.unshift(newEntry); // 最新的在前面
    const success = await writeDataFile(CHANGELOG_FILE, changelog);
    if (success) {
      res.json({ success: true, entry: newEntry });
    } else {
      res.status(500).json({ error: '保存操作日記失敗' });
    }
  } catch (error) {
    console.error('保存操作日記失敗:', error);
    res.status(500).json({ error: '保存操作日記失敗' });
  }
});

// 獲取數據版本信息（用於檢測更新）
app.get('/api/version', async (req, res) => {
  try {
    const tasks = await loadTasksWithMetadata();
    const users = await readDataFile(USERS_FILE, []);
    const notes = await readDataFile(NOTES_FILE, []);
    
    // 計算數據的哈希值（簡單版本：基於最後更新時間和數量）
    const tasksHash = tasks.length + '_' + (tasks[0]?.updatedAt || '');
    const usersHash = users.length + '_' + (users[0]?.id || '');
    const notesHash = notes.length + '_' + (notes[0]?.id || '');
    
    res.json({
      tasks: {
        count: tasks.length,
        lastUpdate: tasks.length > 0 ? tasks.reduce((latest, t) => {
          const tTime = new Date(t.updatedAt || 0).getTime();
          const lTime = new Date(latest.updatedAt || 0).getTime();
          return tTime > lTime ? t : latest;
        }, tasks[0]).updatedAt : null,
        hash: tasksHash
      },
      users: {
        count: users.length,
        hash: usersHash
      },
      notes: {
        count: notes.length,
        hash: notesHash
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('獲取版本信息失敗:', error);
    res.status(500).json({ error: '獲取版本信息失敗' });
  }
});

// 健康檢查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 啟動服務器
async function startServer() {
  await ensureDataDir();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`API 服務器運行在 http://0.0.0.0:${PORT}`);
  });
}

startServer();

