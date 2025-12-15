// API 服務模塊
const API_BASE = '/api';

// API 請求封裝
async function apiRequest(endpoint, options = {}) {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });
    
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      // 若非 JSON，保持原樣
      data = text;
    }

    if (!response.ok) {
      const err = new Error(data?.error || `API 請求失敗: ${response.status} ${response.statusText}`);
      err.status = response.status;
      err.data = data;
      throw err;
    }
    
    return data;
  } catch (error) {
    console.error('API 請求錯誤:', error);
    throw error;
  }
}

// 任務 API
const TaskAPI = {
  // 獲取所有任務
  async getAll() {
    return await apiRequest('/tasks');
  },
  
  // 建立單一任務
  async create(task) {
    return await apiRequest('/tasks', {
      method: 'POST',
      body: JSON.stringify(task)
    });
  },

  // 更新單一任務（需帶 version 以避免覆蓋）
  async update(id, task) {
    return await apiRequest(`/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(task)
    });
  },

  // 刪除單一任務
  async remove(id) {
    return await apiRequest(`/tasks/${id}`, {
      method: 'DELETE'
    });
  },

  // 保留舊接口（若仍有地方一次保存全部任務）
  async saveAll(tasks) {
    return await apiRequest('/tasks', {
      method: 'POST',
      body: JSON.stringify(tasks)
    });
  }
};

// 用戶 API
const UserAPI = {
  // 獲取所有用戶
  async getAll() {
    return await apiRequest('/users');
  },
  
  // 保存所有用戶
  async saveAll(users) {
    return await apiRequest('/users', {
      method: 'POST',
      body: JSON.stringify(users)
    });
  }
};

// 便利貼 API
const NoteAPI = {
  // 獲取所有便利貼
  async getAll() {
    return await apiRequest('/notes');
  },
  
  // 保存所有便利貼
  async saveAll(notes) {
    return await apiRequest('/notes', {
      method: 'POST',
      body: JSON.stringify(notes)
    });
  }
};

// 上傳檔案 API
async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    const response = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      throw new Error(`上傳失敗: ${response.status} ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('檔案上傳錯誤:', error);
    throw error;
  }
}

// 健康檢查
async function checkHealth() {
  try {
    return await apiRequest('/health');
  } catch (error) {
    console.error('API 健康檢查失敗:', error);
    return null;
  }
}

