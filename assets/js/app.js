(function () {
  // 等待 DOM 載入完成
  function init() {
    // 檢查是否需要重定向到預設頁面
    const url = new URL(location);
    const hasQueryParams = url.searchParams.toString() !== '';
    const hasHash = location.hash && location.hash !== '';

    // 如果沒有查詢參數和 hash，重定向到預設頁面
    if (!hasQueryParams && !hasHash) {
      location.href = '/?sort=completeDate&dir=asc&owner=all#home';
      return; // 停止執行，等待重定向
    }

    const elApp = document.getElementById('app');
    const navLinks = document.querySelectorAll('[data-route]');
    const modal = document.getElementById('taskModal');
    const form = document.getElementById('taskForm');
    const btnSave = document.getElementById('saveTask');
    const btnClose = document.getElementById('closeModal');
    const btnDelete = document.getElementById('deleteTask');
    const inputImport = document.getElementById('importFile');
    const toast = document.getElementById('toast');
    const themeToggle = document.getElementById('themeToggle');
    const LS_THEME_KEY = 'work_app_theme';
    const LS_AUTH_KEY = 'work_app_auth';
    const loginModal = document.getElementById('loginModal');
    const loginForm = document.getElementById('loginForm');
    const btnLogin = document.getElementById('btnLogin');
    const btnLogout = document.getElementById('btnLogout');
    const appHeader = document.getElementById('appHeader');
    const loginError = document.getElementById('loginError');

    // 搜索輸入框防抖計時器（提升到 init 作用域，避免重複綁定）
    let searchDebounceTimer = null;
    let searchInputHandler = null;

    // API 數據儲存（替代 localStorage）
    let isDataLoading = false;

    // 確保任務有版本與時間戳，避免覆蓋
    function ensureTaskMeta(task) {
      if (typeof task.version !== 'number') task.version = 1;
      if (!task.updatedAt) task.updatedAt = new Date().toISOString();
      return task;
    }

    async function persistTask(task) {
      ensureTaskMeta(task);
      const isNew = !task.id || String(task.id).startsWith('t_new_');
      const payload = { ...task };
      const originalId = task.id;

      try {
        let saved;
        if (isNew) {
          // 新任務：不傳 ID，讓後端生成唯一 ID
          delete payload.id;
          saved = await TaskAPI.create(payload);
        } else {
          // 更新現有任務
          saved = await TaskAPI.update(task.id, payload);
        }

        const merged = ensureTaskMeta({ ...task, ...saved });
        // 如果 ID 改變了（新任務），需要更新本地引用
        if (originalId && originalId !== merged.id) {
          const oldIdx = TASKS.findIndex(t => t.id === originalId);
          if (oldIdx > -1) {
            TASKS[oldIdx] = merged;
          }
        } else {
          const idx = TASKS.findIndex(t => t.id === merged.id || t.id === originalId);
          if (idx > -1) {
            TASKS[idx] = merged;
          } else {
            TASKS.unshift(merged);
          }
        }
        return merged;
      } catch (e) {
        console.error('儲存任務失敗:', e);
        const errorMsg = e?.data?.error || e?.message || '儲存失敗，請重新整理後再試';
        if (typeof alert === 'function') {
          alert(errorMsg);
        }
        throw e;
      }
    }

    async function removeTask(id) {
      try {
        await TaskAPI.remove(id);
        const idx = TASKS.findIndex(t => t.id === id);
        if (idx > -1) TASKS.splice(idx, 1);
      } catch (e) {
        console.error('刪除任務失敗:', e);
        alert(e?.data?.error || '刪除失敗，請重新整理後再試');
        throw e;
      }
    }

    // 從 API 載入任務
    async function loadTasks() {
      isDataLoading = true;
      try {
        const tasks = await TaskAPI.getAll();
        if (Array.isArray(tasks)) {
          while (TASKS.length) TASKS.pop();
          TASKS.push(...tasks.map(t => ensureTaskMeta(t)));
        } else {
          while (TASKS.length) TASKS.pop();
        }
      } catch (e) {
        console.error('載入任務失敗:', e);
        // 如果 API 失敗，保持當前數據或使用空陣列
        if (TASKS.length === 0) {
          // API 載入失敗，使用空任務列表
        }
      } finally {
        isDataLoading = false;
      }
    }

    // 初始化載入任務（異步），載入完成後渲染
    let isInitialLoad = true;
    loadTasks().then(() => {
      if (isInitialLoad && checkAuth()) {
        isInitialLoad = false;
        render();
      }
    });

    // 定期同步數據（每30秒），避免多人操作時數據不一致
    let syncInterval = null;
    function startPeriodicSync() {
      if (syncInterval) clearInterval(syncInterval);
      syncInterval = setInterval(async () => {
        if (!checkAuth() || isDataLoading) return;
        try {
          const tasks = await TaskAPI.getAll();
          if (Array.isArray(tasks)) {
            // 合併策略：保留本地未保存的變更，但更新已保存的任務
            const localMap = new Map(TASKS.map(t => [t.id, t]));
            const serverMap = new Map(tasks.map(t => [t.id, t]));

            // 更新或新增服務器上的任務
            tasks.forEach(serverTask => {
              const localTask = localMap.get(serverTask.id);
              if (!localTask) {
                // 服務器有新任務，直接添加
                TASKS.push(ensureTaskMeta(serverTask));
              } else {
                // 比較版本，如果服務器版本更新，則更新本地
                const localVersion = localTask.version || 0;
                const serverVersion = serverTask.version || 0;
                if (serverVersion > localVersion) {
                  const index = TASKS.findIndex(t => t.id === serverTask.id);
                  if (index > -1) {
                    TASKS[index] = ensureTaskMeta(serverTask);
                  }
                }
              }
            });

            // 移除服務器上已刪除的任務（但保留本地臨時任務）
            for (let i = TASKS.length - 1; i >= 0; i--) {
              const localTask = TASKS[i];
              if (!localTask.id.startsWith('t_new_') && !serverMap.has(localTask.id)) {
                // 服務器上沒有這個任務，可能是被其他用戶刪除了
                TASKS.splice(i, 1);
              }
            }

            // 如果當前在列表頁面，重新渲染
            const currentRoute = (location.hash || '#home').replace('#', '');
            if (['all', 'incomplete', 'completed_week', 'completed_all', 'todo', 'doing', 'overdue', 'high_priority'].includes(currentRoute)) {
              render();
            }
          }
        } catch (e) {
          console.error('定期同步失敗:', e);
        }
      }, 30000); // 每30秒同步一次
    }

    // 啟動定期同步
    if (checkAuth()) {
      startPeriodicSync();
    }

    // 監聽登入狀態變化，啟動或停止同步
    const originalCheckAuth = checkAuth;
    window.addEventListener('storage', () => {
      if (checkAuth() && !syncInterval) {
        startPeriodicSync();
      } else if (!checkAuth() && syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
      }
    });

    function setActiveRoute() {
      const hash = location.hash || '#all';
      navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === hash));
    }

    // 導航選單拖動排序
    const LS_NAV_ORDER_KEY = 'work_nav_order';

    function saveNavOrder(mainNav) {
      if (!mainNav) return;
      const order = Array.from(mainNav.children).map(a => a.getAttribute('href'));
      localStorage.setItem(LS_NAV_ORDER_KEY, JSON.stringify(order));
    }

    function loadNavOrder(mainNav) {
      if (!mainNav) return;
      const raw = localStorage.getItem(LS_NAV_ORDER_KEY);
      if (raw) {
        try {
          const order = JSON.parse(raw);
          const items = Array.from(mainNav.children);
          const itemsMap = new Map(items.map(a => [a.getAttribute('href'), a]));
          // 按照儲存的順序重新排列
          order.forEach(href => {
            const item = itemsMap.get(href);
            if (item && item.parentNode === mainNav) {
              mainNav.appendChild(item);
            }
          });
        } catch (e) {
          console.error('載入導航順序失敗:', e);
        }
      }
    }

    // 初始化拖動排序
    function initDragSort() {
      const mainNav = document.getElementById('mainNav');
      if (!mainNav) return;

      // 載入儲存的順序
      loadNavOrder(mainNav);

      let draggedElement = null;

      mainNav.addEventListener('dragstart', (e) => {
        if (e.target.tagName === 'A' && e.target.draggable) {
          draggedElement = e.target;
          e.target.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/html', e.target.outerHTML);
        }
      });

      mainNav.addEventListener('dragend', (e) => {
        if (e.target.tagName === 'A') {
          e.target.classList.remove('dragging');
          mainNav.querySelectorAll('a').forEach(a => a.classList.remove('drag-over'));
        }
        draggedElement = null;
      });

      mainNav.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        const target = e.target.closest('a');
        if (target && target !== draggedElement && target.draggable) {
          target.classList.add('drag-over');
        }
      });

      mainNav.addEventListener('dragleave', (e) => {
        const target = e.target.closest('a');
        if (target) {
          target.classList.remove('drag-over');
        }
      });

      mainNav.addEventListener('drop', (e) => {
        e.preventDefault();
        const target = e.target.closest('a');

        if (draggedElement && target && target !== draggedElement && target.draggable) {
          target.classList.remove('drag-over');

          // 計算插入位置
          const allItems = Array.from(mainNav.children);
          const draggedIndex = allItems.indexOf(draggedElement);
          const targetIndex = allItems.indexOf(target);

          if (draggedIndex < targetIndex) {
            mainNav.insertBefore(draggedElement, target.nextSibling);
          } else {
            mainNav.insertBefore(draggedElement, target);
          }

          saveNavOrder(mainNav);
        }
      });
    }

    function render() {
      setActiveRoute();
      const route = (location.hash || '#home').replace('#', '');
      if (route.startsWith('task/')) {
        const id = route.split('/')[1];
        return renderTaskDetail(id);
      }
      switch (route) {
        case 'home':
        case '': return renderHome();
        case 'all': return renderTasks({ title: '所有工作', filter: () => true });
        case 'incomplete': return renderTasks({ title: '未完成的工作', filter: t => t.status !== '完成' });
        case 'completed_week': return renderTasks({ title: '這週已完成的工作', filter: isCompletedThisWeek });
        case 'completed_all': return renderTasks({ title: '所有已完成的工作', filter: t => t.status === '完成' });
        case 'high_priority': return renderTasks({ title: '高優先級未完成的工作', filter: t => t.priority === '高' && t.status !== '完成' });
        case 'overdue': return renderTasks({
          title: '逾期任務', filter: t => {
            if (t.status === '完成' || !t.dueDate) return false;
            return new Date(t.dueDate) < new Date();
          }
        });
        case 'todo': return renderTasks({ title: '待辦任務', filter: t => t.status === '待辦' });
        case 'doing': return renderTasks({ title: '進行中的任務', filter: t => t.status === '進行中' });
        case 'users': return renderUsers();
        case 'calendar': return renderCalendar();
        case 'notes': return renderNotes(true); // 首次進入時強制載入
        default: return renderHome();
      }
    }

    // 渲染首頁
    function renderHome() {
      // 計算統計數據
      const totalTasks = TASKS.length;
      const completedTasks = TASKS.filter(t => t.status === '完成').length;
      const inProgressTasks = TASKS.filter(t => t.status === '進行中').length;
      const todoTasks = TASKS.filter(t => t.status === '待辦').length;
      const completedThisWeek = TASKS.filter(isCompletedThisWeek).length;
      const highPriorityTasks = TASKS.filter(t => t.priority === '高' && t.status !== '完成').length;
      const overdueTasks = TASKS.filter(t => {
        if (t.status === '完成' || !t.dueDate) return false;
        return new Date(t.dueDate) < new Date();
      }).length;

      // 計算平均完成度
      const avgProgress = totalTasks > 0
        ? Math.round(TASKS.reduce((sum, t) => sum + (t.progress || 0), 0) / totalTasks)
        : 0;

      // 獲取最近的任務（最多5個）
      const recentTasks = [...TASKS]
        .sort((a, b) => {
          const dateA = a.completeDate || a.dueDate || '';
          const dateB = b.completeDate || b.dueDate || '';
          return dateB.localeCompare(dateA);
        })
        .slice(0, 5);

      // 獲取待辦任務（最多5個）
      const upcomingTasks = TASKS
        .filter(t => t.status !== '完成' && t.dueDate)
        .sort((a, b) => {
          const dateA = new Date(a.dueDate);
          const dateB = new Date(b.dueDate);
          return dateA - dateB;
        })
        .slice(0, 5);

      elApp.innerHTML = `
        <div class="home-container" style="padding:24px;max-width:1400px;margin:0 auto">
          <!-- 歡迎區塊 -->
          <div style="margin-bottom:32px">
            <h1 style="font-size:32px;font-weight:700;margin:0 0 8px 0;color:var(--text)">工作排程系統</h1>
            <p style="font-size:16px;color:var(--muted);margin:0">歡迎回來！以下是您們的工作概覽</p>
          </div>
          
          <!-- 主要統計卡片 -->
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px;margin-bottom:32px">
            <div class="stat-card" style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;padding:24px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.15);cursor:pointer;transition:transform 0.2s,box-shadow 0.2s" 
                 onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 16px rgba(0,0,0,0.2)'" 
                 onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.15)'"
                 onclick="location.href='?sort=progress&dir=asc#all'">
              <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px">
                <div>
                  <div style="font-size:14px;opacity:0.9;margin-bottom:4px">任務總數</div>
                  <div style="font-size:36px;font-weight:700">${totalTasks}</div>
                </div>
                <div style="font-size:32px;opacity:0.8">📋</div>
              </div>
              <div style="font-size:12px;opacity:0.8">所有工作項目</div>
            </div>
            
            <div class="stat-card" style="background:linear-gradient(135deg,#f093fb 0%,#f5576c 100%);color:#fff;padding:24px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.15);cursor:pointer;transition:transform 0.2s,box-shadow 0.2s" 
                 onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 16px rgba(0,0,0,0.2)'" 
                 onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.15)'"
                 onclick="location.href='?sort=progress&dir=asc#completed_all'">
              <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px">
                <div>
                  <div style="font-size:14px;opacity:0.9;margin-bottom:4px">已完成</div>
                  <div style="font-size:36px;font-weight:700">${completedTasks}</div>
                </div>
                <div style="font-size:32px;opacity:0.8">✅</div>
              </div>
              <div style="font-size:12px;opacity:0.8">已完成的任務列表</div>
            </div>
            
            <div class="stat-card" style="background:linear-gradient(135deg,#4facfe 0%,#00f2fe 100%);color:#fff;padding:24px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.15);cursor:pointer;transition:transform 0.2s,box-shadow 0.2s" 
                 onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 16px rgba(0,0,0,0.2)'" 
                 onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.15)'"
                 onclick="location.href='?sort=progress&dir=asc#doing'">
              <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px">
                <div>
                  <div style="font-size:14px;opacity:0.9;margin-bottom:4px">進行中</div>
                  <div style="font-size:36px;font-weight:700">${inProgressTasks}</div>
                </div>
                <div style="font-size:32px;opacity:0.8">🔄</div>
              </div>
              <div style="font-size:12px;opacity:0.8">正在處理的任務</div>
            </div>
            
            <div class="stat-card" style="background:linear-gradient(135deg,#43e97b 0%,#38f9d7 100%);color:#fff;padding:24px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.15);cursor:pointer;transition:transform 0.2s,box-shadow 0.2s" 
                 onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 16px rgba(0,0,0,0.2)'" 
                 onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.15)'"
                 onclick="location.href='?sort=progress&dir=asc#todo'">
              <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px">
                <div>
                  <div style="font-size:14px;opacity:0.9;margin-bottom:4px">待辦</div>
                  <div style="font-size:36px;font-weight:700">${todoTasks}</div>
                </div>
                <div style="font-size:32px;opacity:0.8">📝</div>
              </div>
              <div style="font-size:12px;opacity:0.8">等待開始的任務</div>
            </div>
          </div>
          
          <!-- 次要統計和快速操作 -->
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px;margin-bottom:32px">
            <!-- 本週完成 -->
            <div style="background:var(--panel-2);padding:20px;border-radius:12px;border:1px solid var(--border);cursor:pointer;transition:all 0.2s" 
                 onmouseover="this.style.background='var(--panel-1)'; this.style.borderColor='var(--primary)'" 
                 onmouseout="this.style.background='var(--panel-2)'; this.style.borderColor='var(--border)'"
                 onclick="location.href='?sort=progress&dir=asc#completed_week'">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                <h3 style="margin:0;font-size:18px;font-weight:600;color:var(--text)">本週完成</h3>
                <span style="font-size:24px">📅</span>
              </div>
              <div style="font-size:32px;font-weight:700;color:var(--primary);margin-bottom:8px">${completedThisWeek}</div>
              <div style="font-size:14px;color:var(--muted)">本週已完成的任務數</div>
            </div>
            
            <!-- 高優先級 -->
            <div style="background:var(--panel-2);padding:20px;border-radius:12px;border:1px solid var(--border);cursor:pointer;transition:all 0.2s" 
                 onmouseover="this.style.background='var(--panel-1)'; this.style.borderColor='var(--primary)'" 
                 onmouseout="this.style.background='var(--panel-2)'; this.style.borderColor='var(--border)'"
                 onclick="location.href='?sort=progress&dir=asc#high_priority'">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                <h3 style="margin:0;font-size:18px;font-weight:600;color:var(--text)">高優先級</h3>
                <span style="font-size:24px">🔥</span>
              </div>
              <div style="font-size:32px;font-weight:700;color:#f5576c;margin-bottom:8px">${highPriorityTasks}</div>
              <div style="font-size:14px;color:var(--muted)">待處理的高優先級任務</div>
            </div>
            
            <!-- 逾期任務 -->
            <div style="background:var(--panel-2);padding:20px;border-radius:12px;border:1px solid var(--border);cursor:pointer;transition:all 0.2s" 
                 onmouseover="this.style.background='var(--panel-1)'; this.style.borderColor='var(--primary)'" 
                 onmouseout="this.style.background='var(--panel-2)'; this.style.borderColor='var(--border)'"
                 onclick="location.href='?sort=progress&dir=asc#overdue'">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                <h3 style="margin:0;font-size:18px;font-weight:600;color:var(--text)">逾期任務</h3>
                <span style="font-size:24px">⚠️</span>
              </div>
              <div style="font-size:32px;font-weight:700;color:${overdueTasks > 0 ? '#f5576c' : 'var(--success)'};margin-bottom:8px">${overdueTasks}</div>
              <div style="font-size:14px;color:var(--muted)">${overdueTasks > 0 ? '需要立即處理' : '沒有逾期任務'}</div>
            </div>
            
            <!-- 平均完成度 -->
            <div style="background:var(--panel-2);padding:20px;border-radius:12px;border:1px solid var(--border)">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                <h3 style="margin:0;font-size:18px;font-weight:600;color:var(--text)">平均完成度</h3>
                <span style="font-size:24px">📊</span>
              </div>
              <div style="font-size:32px;font-weight:700;color:var(--primary);margin-bottom:8px">${avgProgress}%</div>
              <div style="background:var(--panel-1);height:8px;border-radius:4px;overflow:hidden;margin-top:12px">
                <div style="background:var(--primary);height:100%;width:${avgProgress}%;transition:width 0.3s"></div>
              </div>
            </div>
          </div>
          
          <!-- 快速操作 -->
          <div style="background:var(--panel-2);padding:24px;border-radius:12px;border:1px solid var(--border);margin-bottom:32px">
            <h3 style="margin:0 0 20px 0;font-size:20px;font-weight:600;color:var(--text)">快速操作</h3>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
              <a href="#all" data-route style="padding:16px;background:var(--panel-1);border-radius:8px;border:1px solid var(--border);text-decoration:none;color:var(--text);display:flex;align-items:center;gap:12px;transition:all 0.2s;cursor:pointer" 
                 onmouseover="this.style.background='var(--primary)'; this.style.color='#fff'; this.style.borderColor='var(--primary)'" 
                 onmouseout="this.style.background='var(--panel-1)'; this.style.color='var(--text)'; this.style.borderColor='var(--border)'">
                <span style="font-size:24px">📋</span>
                <div>
                  <div style="font-weight:500">所有工作</div>
                  <div style="font-size:12px;opacity:0.7">查看全部任務</div>
                </div>
              </a>
              <a href="#incomplete" data-route style="padding:16px;background:var(--panel-1);border-radius:8px;border:1px solid var(--border);text-decoration:none;color:var(--text);display:flex;align-items:center;gap:12px;transition:all 0.2s;cursor:pointer" 
                 onmouseover="this.style.background='var(--primary)'; this.style.color='#fff'; this.style.borderColor='var(--primary)'" 
                 onmouseout="this.style.background='var(--panel-1)'; this.style.color='var(--text)'; this.style.borderColor='var(--border)'">
                <span style="font-size:24px">⏳</span>
                <div>
                  <div style="font-weight:500">未完成工作</div>
                  <div style="font-size:12px;opacity:0.7">查看待處理任務</div>
                </div>
              </a>
              <a href="#calendar" data-route style="padding:16px;background:var(--panel-1);border-radius:8px;border:1px solid var(--border);text-decoration:none;color:var(--text);display:flex;align-items:center;gap:12px;transition:all 0.2s;cursor:pointer" 
                 onmouseover="this.style.background='var(--primary)'; this.style.color='#fff'; this.style.borderColor='var(--primary)'" 
                 onmouseout="this.style.background='var(--panel-1)'; this.style.color='var(--text)'; this.style.borderColor='var(--border)'">
                <span style="font-size:24px">📅</span>
                <div>
                  <div style="font-weight:500">行事曆</div>
                  <div style="font-size:12px;opacity:0.7">查看日程安排</div>
                </div>
              </a>
              <a href="#notes" data-route style="padding:16px;background:var(--panel-1);border-radius:8px;border:1px solid var(--border);text-decoration:none;color:var(--text);display:flex;align-items:center;gap:12px;transition:all 0.2s;cursor:pointer" 
                 onmouseover="this.style.background='var(--primary)'; this.style.color='#fff'; this.style.borderColor='var(--primary)'" 
                 onmouseout="this.style.background='var(--panel-1)'; this.style.color='var(--text)'; this.style.borderColor='var(--border)'">
                <span style="font-size:24px">📝</span>
                <div>
                  <div style="font-weight:500">便利貼</div>
                  <div style="font-size:12px;opacity:0.7">查看筆記</div>
                </div>
              </a>
            </div>
          </div>
          
          <!-- 內容區域：最近任務和待辦事項 -->
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(400px,1fr));gap:24px;margin-bottom:32px">
            <!-- 最近任務 -->
            <div style="background:var(--panel-2);padding:24px;border-radius:12px;border:1px solid var(--border)">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
                <h3 style="margin:0;font-size:20px;font-weight:600;color:var(--text)">最近任務</h3>
                <a href="#all" data-route style="color:var(--primary);text-decoration:none;font-size:14px;font-weight:500">查看全部 →</a>
              </div>
              ${recentTasks.length > 0 ? `
                <div style="display:flex;flex-direction:column;gap:12px">
                  ${recentTasks.map(t => `
                    <div style="padding:12px;background:var(--panel-1);border-radius:8px;border:1px solid var(--border);cursor:pointer;transition:all 0.2s" 
                         onmouseover="this.style.background='var(--panel-2)'; this.style.borderColor='var(--primary)'" 
                         onmouseout="this.style.background='var(--panel-1)'; this.style.borderColor='var(--border)'"
                         onclick="location.hash='#task/${t.id}'">
                      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
                        <div style="flex:1;min-width:0">
                          <div style="font-weight:500;color:var(--text);margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${(t.title || '未命名任務').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                          <div style="font-size:12px;color:var(--muted)">${t.completeDate || t.dueDate || '無日期'}</div>
                        </div>
                        <div style="margin-left:12px;flex-shrink:0">
                          ${badgeStatus(t.status)}
                        </div>
                      </div>
                      <div style="display:flex;gap:8px;align-items:center">
                        ${badgePriority(t.priority)}
                        <div style="font-size:12px;color:var(--muted)">完成度: ${t.progress || 0}%</div>
                      </div>
                    </div>
                  `).join('')}
                </div>
              ` : `
                <div style="text-align:center;padding:40px;color:var(--muted)">
                  <div style="font-size:48px;margin-bottom:12px">📭</div>
                  <div>暫無最近任務</div>
                </div>
              `}
            </div>
            
            <!-- 即將到期 -->
            <div style="background:var(--panel-2);padding:24px;border-radius:12px;border:1px solid var(--border)">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
                <h3 style="margin:0;font-size:20px;font-weight:600;color:var(--text)">即將到期</h3>
                <a href="#incomplete" data-route style="color:var(--primary);text-decoration:none;font-size:14px;font-weight:500">查看全部 →</a>
              </div>
              ${upcomingTasks.length > 0 ? `
                <div style="display:flex;flex-direction:column;gap:12px">
                  ${upcomingTasks.map(t => {
        const dueDate = new Date(t.dueDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const daysLeft = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
        const isOverdue = daysLeft < 0;
        const isUrgent = daysLeft >= 0 && daysLeft <= 3;

        return `
                    <div style="padding:12px;background:var(--panel-1);border-radius:8px;border:1px solid ${isOverdue ? '#f5576c' : isUrgent ? '#ffa500' : 'var(--border)'};cursor:pointer;transition:all 0.2s" 
                         onmouseover="this.style.background='var(--panel-2)'" 
                         onmouseout="this.style.background='var(--panel-1)'"
                         onclick="location.hash='#task/${t.id}'">
                      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
                        <div style="flex:1;min-width:0">
                          <div style="font-weight:500;color:var(--text);margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${(t.title || '未命名任務').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                          <div style="font-size:12px;color:${isOverdue ? '#f5576c' : isUrgent ? '#ffa500' : 'var(--muted)'};font-weight:${isOverdue || isUrgent ? '600' : '400'}">
                            ${isOverdue ? `逾期 ${Math.abs(daysLeft)} 天` : isUrgent ? `剩餘 ${daysLeft} 天` : `還有 ${daysLeft} 天`}
                          </div>
                        </div>
                        <div style="margin-left:12px;flex-shrink:0">
                          ${badgeStatus(t.status)}
                        </div>
                      </div>
                      <div style="display:flex;gap:8px;align-items:center">
                        ${badgePriority(t.priority)}
                        <div style="font-size:12px;color:var(--muted)">完成度: ${t.progress || 0}%</div>
                      </div>
                    </div>
                  `;
      }).join('')}
                </div>
              ` : `
                <div style="text-align:center;padding:40px;color:var(--muted)">
                  <div style="font-size:48px;margin-bottom:12px">🎉</div>
                  <div>沒有即將到期的任務</div>
                </div>
              `}
            </div>
          </div>
        </div>
      `;
    }

    function isCompletedThisWeek(task) {
      if (task.status !== '完成' || !task.completeDate) return false;
      const d = new Date(task.completeDate);
      const now = new Date();
      const first = new Date(now);
      first.setDate(now.getDate() - now.getDay() + 1); // 週一
      first.setHours(0, 0, 0, 0);
      const last = new Date(first);
      last.setDate(first.getDate() + 6);
      last.setHours(23, 59, 59, 999);
      return d >= first && d <= last;
    }

    function renderUsers() {
      elApp.innerHTML = `
      <div class="toolbar">
        <h2 style="margin:0">使用者</h2>
        <button class="btn primary" id="btnNewUser">新增使用者</button>
      </div>
      <div class="grid cols-3">
        ${USERS.map(u => `
          <div class="card" data-user-id="${u.id}">
            <div class="avatars" style="margin-bottom:8px"><span class="avatar">${u.name[0]}</span></div>
            <div style="font-weight:600;margin-bottom:6px">
              <span contenteditable="true" data-field="name" class="editable-cell" style="outline:none;padding:4px;display:inline-block">${u.name}</span>
            </div>
            <div style="display:flex;gap:8px;margin-top:12px">
              <button class="btn danger" style="padding:4px 8px;font-size:12px" data-delete-user="${u.id}">刪除</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;

      // 新增使用者
      document.getElementById('btnNewUser').addEventListener('click', () => {
        const name = prompt('請輸入使用者名稱：');
        if (name && name.trim()) {
          const newUser = {
            id: 'u_' + Date.now(),
            name: name.trim()
          };
          USERS.push(newUser);
          saveUsers();
          notify('已新增使用者');
          renderUsers();
        }
      });

      // 編輯使用者名稱
      elApp.querySelectorAll('[data-field="name"]').forEach(el => {
        const card = el.closest('[data-user-id]');
        const userId = card ? card.getAttribute('data-user-id') : null;
        if (!userId) return;
        el.addEventListener('blur', () => {
          const user = USERS.find(u => u.id === userId);
          if (user) {
            user.name = el.textContent.trim();
            saveUsers();
            notify('已更新使用者');
            renderUsers();
          }
        });
      });

      // 刪除使用者
      elApp.querySelectorAll('[data-delete-user]').forEach(btn => {
        btn.addEventListener('click', () => {
          const userId = btn.getAttribute('data-delete-user');
          const user = USERS.find(u => u.id === userId);
          if (user && confirm(`確定要刪除使用者「${user.name}」嗎？`)) {
            const idx = USERS.findIndex(u => u.id === userId);
            if (idx > -1) {
              USERS.splice(idx, 1);
              saveUsers();
              notify('已刪除使用者');
              renderUsers();
            }
          }
        });
      });
    }

    // 使用者 API 儲存
    async function saveUsers() {
      try {
        await UserAPI.saveAll(USERS);
        console.log('已儲存使用者到服務器:', USERS.length, '筆');
      } catch (e) {
        console.error('儲存使用者失敗:', e);
        alert('儲存失敗，請檢查網路連接');
      }
    }

    // 從 API 載入使用者
    async function loadUsers() {
      try {
        const users = await UserAPI.getAll();
        if (Array.isArray(users) && users.length > 0) {
          while (USERS.length) USERS.pop();
          USERS.push(...users);
          console.log('已從服務器載入使用者:', USERS.length, '筆');
        } else {
          // 如果服務器沒有使用者，使用預設資料並保存
          if (USERS.length === 0) {
            console.log('服務器沒有使用者資料，使用預設資料');
            saveUsers();
          }
        }
      } catch (e) {
        console.error('載入使用者失敗:', e);
        // 如果 API 失敗，保持當前數據
        if (USERS.length === 0) {
          console.log('API 載入失敗，使用預設使用者列表');
        }
      }
    }

    // 初始化載入使用者（異步）
    loadUsers();

    // 便利貼 API 儲存
    async function saveNotes() {
      try {
        await NoteAPI.saveAll(NOTES);
        console.log('已儲存便利貼到服務器:', NOTES.length, '筆');
      } catch (e) {
        console.error('儲存便利貼失敗:', e);
        alert('儲存失敗，請檢查網路連接');
      }
    }

    // 從 API 載入便利貼
    async function loadNotes() {
      try {
        const notes = await NoteAPI.getAll();
        if (Array.isArray(notes)) {
          while (NOTES.length) NOTES.pop();
          NOTES.push(...notes);
          console.log('已從服務器載入便利貼:', NOTES.length, '筆');
        }
      } catch (e) {
        console.error('載入便利貼失敗:', e);
      }
    }

    // 初始化載入便利貼（異步）
    loadNotes();

    function badgeStatus(s) {
      if (s === '待辦') return '<span class="chip status-todo">待辦</span>';
      if (s === '進行中') return '<span class="chip status-doing">進行中</span>';
      return '<span class="chip status-done">完成</span>';
    }
    function badgePriority(p) {
      if (p === '高') return '<span class="chip p-high">高</span>';
      if (p === '低') return '<span class="chip p-low">低</span>';
      return '<span class="chip p-mid">中</span>';
    }
    function stateFromURL() {
      const url = new URL(location);
      return {
        q: url.searchParams.get('q') || '',
        s: url.searchParams.get('s') || 'all', // 狀態：all/todo/doing/done
        p: url.searchParams.get('p') || 'all', // 優先級：all/high/mid/low
        owner: url.searchParams.get('owner') || 'all', // 負責人篩選
        sort: url.searchParams.get('sort') || '', // 排序：title_asc, status_asc, priority_asc, due_asc, complete_asc, owner_asc, progress_asc
        sortDir: url.searchParams.get('dir') || 'asc' // 排序方向：asc/desc
      };
    }
    function updateURL(part) {
      const url = new URL(location);
      Object.entries(part).forEach(([k, v]) => { if (v === undefined || v === '') url.searchParams.delete(k); else url.searchParams.set(k, v); });
      history.replaceState({}, '', url.toString());
    }

    function renderTasks({ title, filter }) {
      const { q, s, p, sort, sortDir, owner } = stateFromURL();

      // 先應用自定義篩選器
      let tasks = TASKS.filter(filter);

      // 應用所有篩選條件
      tasks = tasks.filter(t => {
        // 修復搜尋邏輯：如果搜尋字串為空，則顯示所有任務
        if (!q || q.trim() === '') return true;
        const titleStr = (t.title || '').toString();
        const notesStr = (t.notes || '').toString();
        return titleStr.includes(q) || notesStr.includes(q);
      })
        .filter(t => {
          if (s === 'todo') return t.status === '待辦';
          if (s === 'doing') return t.status === '進行中';
          if (s === 'done') return t.status === '完成';
          return true;
        })
        .filter(t => {
          if (p === 'high') return t.priority === '高';
          if (p === 'mid') return t.priority === '中';
          if (p === 'low') return t.priority === '低';
          return true;
        })
        .filter(t => {
          if (owner && owner !== 'all') {
            // 確保 executors 是陣列格式
            let executors = [];
            if (Array.isArray(t.executors)) {
              executors = t.executors;
            } else if (t.executors) {
              // 如果是字符串，嘗試分割
              if (typeof t.executors === 'string') {
                executors = t.executors.split(',').map(s => s.trim()).filter(Boolean);
              } else {
                executors = [t.executors];
              }
            }
            const hasExecutor = executors.length > 0 && executors.includes(owner);
            return hasExecutor;
          }
          // 如果沒有設置 owner 篩選或 owner 為 'all'，顯示所有任務（包括沒有執行人的任務）
          return true;
        })
        .filter(t => {
          // 確保任務有必要的字段
          if (!t || !t.id) {
            return false;
          }
          return true;
        })
        .sort((a, b) => {
          if (!sort) return 0;
          const get = (x, k) => x[k] || '';
          const dir = sortDir === 'desc' ? -1 : 1;
          let result = 0;
          if (sort === 'title') {
            result = String(get(a, 'title')).localeCompare(String(get(b, 'title')));
          } else if (sort === 'status') {
            const rank = { 待辦: 0, 進行中: 1, 完成: 2 };
            result = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
          } else if (sort === 'priority') {
            const rank = { 高: 0, 中: 1, 低: 2 };
            result = (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9);
          } else if (sort === 'dueDate') {
            result = String(get(a, 'dueDate') || '9999-99-99').localeCompare(String(get(b, 'dueDate') || '9999-99-99'));
          } else if (sort === 'completeDate') {
            result = String(get(a, 'completeDate') || '9999-99-99').localeCompare(String(get(b, 'completeDate') || '9999-99-99'));
          } else if (sort === 'owner') {
            const aOwner = Array.isArray(a.owner) ? a.owner.join(', ') : (a.owner || '');
            const bOwner = Array.isArray(b.owner) ? b.owner.join(', ') : (b.owner || '');
            result = String(aOwner).localeCompare(String(bOwner));
          } else if (sort === 'progress') {
            result = (a.progress || 0) - (b.progress || 0);
          }
          return result * dir;
        });

      // KPI - 使用 TASKS 的總數，而不是篩選後的 tasks
      const totalAll = TASKS.length;
      const total = tasks.length;
      const done = tasks.filter(t => t.status === '完成').length;
      const notDone = total - done;
      const avg = total ? Math.round(tasks.reduce((s, t) => s + (t.progress || 0), 0) / total) : 0;

      const rows = tasks.length > 0 ? tasks.map(t => {
        const title = (t.title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const notes = (t.notes || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        // 確保 owner 是陣列格式
        let ownerArray = [];
        if (Array.isArray(t.owner)) {
          ownerArray = t.owner;
        } else if (t.owner) {
          if (typeof t.owner === 'string') {
            ownerArray = t.owner.split(',').map(s => s.trim()).filter(Boolean);
          } else {
            ownerArray = [t.owner];
          }
        }
        const owner = ownerArray.join(', ');
        const ownerEscaped = owner.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        // 確保 executors 是陣列格式
        let executorsArray = [];
        if (Array.isArray(t.executors)) {
          executorsArray = t.executors;
        } else if (t.executors) {
          if (typeof t.executors === 'string') {
            executorsArray = t.executors.split(',').map(s => s.trim()).filter(Boolean);
          } else {
            executorsArray = [t.executors];
          }
        }
        const executors = executorsArray.join(', ').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const isNewTask = t.id && t.id.startsWith('t_new_');
        return `
        <tr data-task-id="${t.id}" class="${isNewTask ? 'new-task-row' : ''}">
        <td style="min-width:200px;max-width:300px;padding-right:16px">
          <div style="display:flex;align-items:center;gap:8px;min-width:0">
            <span contenteditable="true" data-field="title" style="flex:1;min-width:0;outline:none;padding:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" class="editable-cell" title="${title}">${title}</span>
            <button class="btn ghost" style="padding:4px 8px;font-size:12px;flex-shrink:0" onclick="location.hash='#task/${t.id}'">打開</button>
          </div>
        </td>
        <td style="padding-left:8px">
          <select class="editable-select" data-field="status" style="background:transparent;border:none;color:inherit;padding:4px;width:100%">
            <option value="待辦" ${t.status === '待辦' ? 'selected' : ''}>待辦</option>
            <option value="進行中" ${t.status === '進行中' ? 'selected' : ''}>進行中</option>
            <option value="完成" ${t.status === '完成' ? 'selected' : ''}>完成</option>
          </select>
        </td>
        <td>
          <select class="editable-select" data-field="priority" style="background:transparent;border:none;color:inherit;padding:4px;width:100%">
            <option value="高" ${t.priority === '高' ? 'selected' : ''}>高</option>
            <option value="中" ${t.priority === '中' ? 'selected' : ''}>中</option>
            <option value="低" ${t.priority === '低' ? 'selected' : ''}>低</option>
          </select>
        </td>
        <td>
          <input type="date" class="editable-input" data-field="completeDate" value="${t.completeDate || ''}" style="background:transparent;border:none;color:inherit;padding:4px;width:100%">
        </td>
        <td>
          <input type="date" class="editable-input" data-field="dueDate" value="${t.dueDate || ''}" style="background:transparent;border:none;color:inherit;padding:4px;width:100%">
        </td>
        <td>
          <div class="custom-dropdown" data-field="owner" data-task-id="${t.id}" style="min-width:150px"></div>
        </td>
        <td>
          <div class="custom-dropdown" data-field="executors" data-task-id="${t.id}" style="min-width:150px"></div>
        </td>
        <td style="min-width:120px">
          <input type="number" min="0" max="100" class="editable-input" data-field="progress" value="${t.progress || 0}" style="background:transparent;border:none;color:inherit;padding:4px;width:60px;text-align:right">
          <div class="progress" aria-label="完成度" style="margin-top:4px"><i style="width:${t.progress || 0}%"></i></div>
        </td>
        <td>
          <button class="btn danger" style="padding:4px 8px;font-size:12px" data-delete-task="${t.id}">刪除工作</button>
        </td>
      </tr>
      `;
      }).join('') : '';

      console.log('生成的 rows 長度:', rows ? rows.length : 0);
      console.log('rows 內容前200字符:', rows ? rows.substring(0, 200) : '空');

      elApp.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%">
        <div class="toolbar">
          <h2 style="margin:0">${title}</h2>
          <select id="selOwner" class="select" style="min-width:120px">
            <option value="all" ${owner === 'all' ? 'selected' : ''}>全部執行人</option>
            ${[...new Set(TASKS.flatMap(t => (t.executors || [])).filter(Boolean))].map(e => `<option value="${e}" ${owner === e ? 'selected' : ''}>${e}</option>`).join('')}
          </select>
          <div class="search"><input id="search" type="search" placeholder="搜尋任務/備註..." value="${q}" aria-label="搜尋"></div>
          <button class="btn primary" id="btnNewRowToolbar" style="display:flex;align-items:center;gap:6px;white-space:nowrap">
            <span style="font-size:18px">+</span>
            <span>新頁面</span>
          </button>
        </div>
        <div class="kpis">
          <div class="kpi-card"><div class="kpi-title">任務總數</div><div class="kpi-val">${totalAll}</div></div>
          ${title !== '未完成的工作' ? `<div class="kpi-card"><div class="kpi-title">已完成</div><div class="kpi-val">${done}</div></div>` : ''}
          ${title !== '這週已完成的工作' && title !== '所有已完成的工作' ? `<div class="kpi-card"><div class="kpi-title">未完成</div><div class="kpi-val">${notDone}</div></div>` : ''}
          <div class="kpi-card"><div class="kpi-title">平均完成度</div><div class="kpi-val">${avg}%</div></div>
        </div>
        <div style="background:var(--panel-2);border-bottom:1px solid var(--border);padding:8px 12px;margin-bottom:0">
          <table style="width:100%;border-collapse:collapse;table-layout:fixed">
            <colgroup>
              <col style="width:250px">
              <col style="width:100px">
              <col style="width:100px">
              <col style="width:120px">
              <col style="width:120px">
              <col style="width:150px">
              <col style="width:150px">
              <col style="width:120px">
              <col style="width:100px">
            </colgroup>
            <thead>
              <tr>
                <th class="sortable" data-sort="title" style="text-align:left;padding:8px 12px;font-weight:500;white-space:nowrap;font-size:13px;color:var(--muted)">
                  <div style="display:flex;align-items:center;gap:6px;cursor:pointer">
                    <span>任務名稱</span>
                    <span class="sort-icon">${sort === 'title' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅'}</span>
                  </div>
                </th>
                <th class="sortable" data-sort="status" style="text-align:left;padding:8px 12px;font-weight:500;white-space:nowrap;font-size:13px;color:var(--muted)">
                  <div style="display:flex;align-items:center;gap:6px;cursor:pointer">
                    <span>狀態</span>
                    <span class="sort-icon">${sort === 'status' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅'}</span>
                  </div>
                </th>
                <th class="sortable" data-sort="priority" style="text-align:left;padding:8px 12px;font-weight:500;white-space:nowrap;font-size:13px;color:var(--muted)">
                  <div style="display:flex;align-items:center;gap:6px;cursor:pointer">
                    <span>優先級</span>
                    <span class="sort-icon">${sort === 'priority' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅'}</span>
                  </div>
                </th>
                <th class="sortable" data-sort="completeDate" style="text-align:left;padding:8px 12px;font-weight:500;white-space:nowrap;font-size:13px;color:var(--muted)">
                  <div style="display:flex;align-items:center;gap:6px;cursor:pointer">
                    <span>完成日期</span>
                    <span class="sort-icon">${sort === 'completeDate' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅'}</span>
                  </div>
                </th>
                <th class="sortable" data-sort="dueDate" style="text-align:left;padding:8px 12px;font-weight:500;white-space:nowrap;font-size:13px;color:var(--muted)">
                  <div style="display:flex;align-items:center;gap:6px;cursor:pointer">
                    <span>截止日期</span>
                    <span class="sort-icon">${sort === 'dueDate' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅'}</span>
                  </div>
                </th>
                <th class="sortable" data-sort="owner" style="text-align:left;padding:8px 12px;font-weight:500;white-space:nowrap;font-size:13px;color:var(--muted)">
                  <div style="display:flex;align-items:center;gap:6px;cursor:pointer">
                    <span>負責人</span>
                    <span class="sort-icon">${sort === 'owner' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅'}</span>
                  </div>
                </th>
                <th style="text-align:left;padding:8px 12px;font-weight:500;white-space:nowrap;font-size:13px;color:var(--muted)">執行人</th>
                <th class="sortable" data-sort="progress" style="text-align:left;padding:8px 12px;font-weight:500;white-space:nowrap;font-size:13px;color:var(--muted)">
                  <div style="display:flex;align-items:center;gap:6px;cursor:pointer">
                    <span># 完成度</span>
                    <span class="sort-icon">${sort === 'progress' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅'}</span>
                  </div>
                </th>
                <th style="text-align:left;padding:8px 12px;font-weight:500;white-space:nowrap;font-size:13px;color:var(--muted)">操作</th>
              </tr>
            </thead>
          </table>
        </div>
        ${totalAll > 0 && total === 0 ? '<div style="padding:16px;background:var(--warn);color:var(--text);border-radius:8px;margin:16px 0;border:var(--border)"><strong>提示：</strong>有 ' + totalAll + ' 個任務，但被目前的篩選條件過濾掉了。請清除搜尋條件或調整篩選器。</div>' : ''}
        <div class="table-wrapper" role="region" aria-label="工作表">
          <table style="width:100%;table-layout:fixed">
            <colgroup>
              <col style="width:250px">
              <col style="width:100px">
              <col style="width:100px">
              <col style="width:120px">
              <col style="width:120px">
              <col style="width:150px">
              <col style="width:150px">
              <col style="width:120px">
              <col style="width:100px">
            </colgroup>
            <tbody>
              ${rows || '<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--muted)">尚無任務</td></tr>'}
            </tbody>
          </table>
          <div style="padding:8px 12px;border-top:1px solid var(--border);background:var(--panel-2);display:flex;align-items:center;gap:8px">
            <button class="btn ghost" id="btnNewRow" style="display:flex;align-items:center;gap:6px;color:var(--muted);font-size:14px;padding:6px 12px">
              <span style="font-size:18px">+</span>
              <span>新頁面</span>
            </button>
          </div>
        </div>
      </div>
      `;

      // 防抖函數：延遲執行搜索，提升性能
      const input = document.getElementById('search');
      if (input) {
        // 先移除舊的事件監聽器（如果存在）
        if (searchInputHandler) {
          input.removeEventListener('input', searchInputHandler);
        }

        // 創建新的事件處理函數
        searchInputHandler = (e) => {
          const searchValue = e.target.value;
          // 清除之前的計時器
          if (searchDebounceTimer) {
            clearTimeout(searchDebounceTimer);
          }
          // 設置新的計時器，2000毫秒後執行搜索
          searchDebounceTimer = setTimeout(() => {
            updateURL({ q: searchValue });
            render();
          }, 2000);
        };

        // 添加新的事件監聽器
        input.addEventListener('input', searchInputHandler);
      }


      // 創建新任務的函數
      const createNewTask = async () => {
        // 創建一個新的空白任務（使用臨時 ID，讓後端生成正式 ID）
        const tempId = 't_new_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const newTask = ensureTaskMeta({
          id: tempId,
          title: '',
          status: '待辦',
          priority: '中',
          owner: [],
          executors: [],
          completeDate: null,
          dueDate: null,
          progress: 0,
          notes: '',
          content: '',
          files: []
        });

        // 添加到 TASKS 陣列的最前面（先顯示）
        TASKS.unshift(newTask);

        // 先重新渲染表格（新增空白行）
        render();

        try {
          // 不傳 ID，讓後端生成唯一 ID
          const taskToSave = { ...newTask };
          delete taskToSave.id; // 讓後端生成 ID

          const saved = await TaskAPI.create(taskToSave);
          // 更新本地任務的 ID 和版本
          const index = TASKS.findIndex(t => t.id === tempId);
          if (index > -1) {
            Object.assign(TASKS[index], saved);
            // 然後跳轉到新任務的詳情頁面
            setTimeout(() => {
              location.hash = '#task/' + saved.id;
            }, 50);
          }
        } catch (e) {
          // 如果創建失敗，移除臨時任務
          const index = TASKS.findIndex(t => t.id === tempId);
          if (index > -1) {
            TASKS.splice(index, 1);
            render();
          }
          notify(e?.data?.error || '建立任務失敗，請重新整理後再試');
        }
      };

      // 事件：新頁面（在表格中新增空白行，並打開詳情頁面）
      const btnNewRow = document.getElementById('btnNewRow');
      if (btnNewRow) {
        btnNewRow.addEventListener('click', createNewTask);
      }

      // 事件：工具欄中的新頁面按鈕
      const btnNewRowToolbar = document.getElementById('btnNewRowToolbar');
      if (btnNewRowToolbar) {
        btnNewRowToolbar.addEventListener('click', createNewTask);
      }

      // 列表內聯編輯
      let inlineSaveTimer;
      const saveTaskField = (taskId, field, value) => {
        const task = TASKS.find(t => t.id === taskId);
        if (!task) return;
        clearTimeout(inlineSaveTimer);
        inlineSaveTimer = setTimeout(async () => {
          if (field === 'executors') {
            task.executors = value.split(',').map(s => s.trim()).filter(Boolean);
          } else if (field === 'owner') {
            task.owner = value.split(',').map(s => s.trim()).filter(Boolean);
          } else if (field === 'progress') {
            task.progress = parseInt(value) || 0;
          } else if (field === 'completeDate') {
            const dateVal = value || null;
            task.completeDate = dateVal;
            // 完成日期邏輯
            if (dateVal) {
              task.status = '完成';
              task.progress = 100;
              // 更新UI
              const row = elApp.querySelector(`[data-task-id="${taskId}"]`);
              if (row) {
                const statusSel = row.querySelector('[data-field="status"]');
                const progressInput = row.querySelector('[data-field="progress"]');
                if (statusSel) statusSel.value = '完成';
                if (progressInput) progressInput.value = '100';
              }
            }
          } else if (field === 'dueDate') {
            task.dueDate = value || null;
          } else {
            task[field] = value;
          }
          try {
            await persistTask(task);
            notify('已自動儲存');
          } catch (err) {
            notify(err?.data?.error || '儲存失敗，請重新整理後再試');
          }
          // 如果 ID 改變了，需要重新渲染
          if (task.id !== taskId) {
            render();
          } else {
            // 只更新進度條等，不需要完全重新渲染
            const row = elApp.querySelector(`[data-task-id="${task.id}"]`);
            if (row) {
              const progressBar = row.querySelector('.progress > i');
              if (progressBar) {
                progressBar.style.width = (task.progress || 0) + '%';
              }
            }
          }
        }, 800);
      };

      elApp.querySelectorAll('.editable-cell').forEach(el => {
        const row = el.closest('[data-task-id]');
        const taskId = row ? row.getAttribute('data-task-id') : null;
        const field = el.getAttribute('data-field');
        if (!taskId) return;
        el.addEventListener('blur', () => {
          saveTaskField(taskId, field, el.textContent.trim());
        });
      });

      // 初始化自定義下拉選單（負責人和執行人）
      elApp.querySelectorAll('.custom-dropdown[data-field="owner"], .custom-dropdown[data-field="executors"]').forEach(container => {
        const taskId = container.getAttribute('data-task-id');
        const field = container.getAttribute('data-field');
        if (!taskId) return;

        const task = TASKS.find(t => t.id === taskId);
        if (!task) return;

        // 獲取當前值
        let values = [];
        if (field === 'owner') {
          values = Array.isArray(task.owner) ? task.owner : (task.owner ? [task.owner] : []);
        } else if (field === 'executors') {
          values = Array.isArray(task.executors) ? task.executors : (task.executors ? [task.executors] : []);
        }

        // 初始化自定義下拉選單
        renderCustomDropdown(container, field, values);

        // 監聽變更事件
        container.addEventListener('change', (e) => {
          const newValues = e.detail.values;
          if (field === 'owner') {
            task.owner = newValues;
          } else if (field === 'executors') {
            task.executors = newValues;
          }
          persistTask(task).then(() => notify('已自動儲存')).catch(err => notify(err?.data?.error || '儲存失敗，請重新整理'));
        });
      });

      elApp.querySelectorAll('.editable-select, .editable-input').forEach(el => {
        const row = el.closest('[data-task-id]');
        const taskId = row ? row.getAttribute('data-task-id') : null;
        const field = el.getAttribute('data-field');
        if (!taskId) return;

        // 處理單選下拉選單和輸入框
        el.addEventListener('change', () => {
          saveTaskField(taskId, field, el.value);
        });
      });

      // 刪除任務按鈕
      elApp.querySelectorAll('[data-delete-task]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const taskId = btn.getAttribute('data-delete-task');
          const task = TASKS.find(t => t.id === taskId);
          if (task && confirm(`確定要刪除任務「${task.title}」嗎？`)) {
            const idx = TASKS.findIndex(t => t.id === taskId);
            if (idx > -1) {
              removeTask(taskId)
                .then(() => {
                  notify('已刪除任務');
                  render();
                })
                .catch(err => notify(err?.data?.error || '刪除失敗，請重新整理'));
            }
          }
        });
      });

      // 篩選/排序
      const selOwner = document.getElementById('selOwner');
      if (selOwner) selOwner.addEventListener('change', () => { updateURL({ owner: selOwner.value }); render(); });

      // 表頭排序點擊
      elApp.querySelectorAll('.sortable').forEach(th => {
        th.addEventListener('click', () => {
          const sortField = th.getAttribute('data-sort');
          const { sort: currentSort, sortDir: currentDir } = stateFromURL();
          let newDir = 'asc';
          if (currentSort === sortField && currentDir === 'asc') {
            newDir = 'desc';
          }
          updateURL({ sort: sortField, dir: newDir });
          render();
        });
      });
    }

    // 台灣勞工假日數據（2024-2026年）
    const TAIWAN_HOLIDAYS = {
      '2024': {
        '2024-01-01': '元旦',
        '2024-02-08': '小年夜',
        '2024-02-09': '除夕',
        '2024-02-10': '春節',
        '2024-02-11': '春節',
        '2024-02-12': '春節',
        '2024-02-13': '春節',
        '2024-02-14': '春節',
        '2024-02-28': '和平紀念日',
        '2024-04-04': '兒童節',
        '2024-04-05': '清明節',
        '2024-05-01': '勞動節',
        '2024-06-10': '端午節',
        '2024-09-17': '中秋節',
        '2024-10-10': '國慶日',
        '2024-10-25': '台灣光復節',
        '2024-12-25': '行憲紀念日',
      },
      '2025': {
        '2025-01-01': '元旦',
        '2025-01-27': '小年夜',
        '2025-01-28': '除夕',
        '2025-01-29': '春節',
        '2025-01-30': '春節',
        '2025-01-31': '春節',
        '2025-02-28': '和平紀念日',
        '2025-04-03': '兒童節',
        '2025-04-04': '清明節',
        '2025-05-01': '勞動節',
        '2025-05-30': '端午節',
        '2025-09-28': '教師節',
        '2025-10-04': '中秋節',
        '2025-10-10': '國慶日',
        '2025-10-25': '台灣光復節',
        '2025-12-25': '行憲紀念日',
      },
      '2026': {
        '2026-01-01': '元旦',
        '2026-02-16': '春假',
        '2026-02-17': '春假',
        '2026-02-18': '春假',
        '2026-02-19': '春假',
        '2026-02-20': '春假',
        '2026-02-27': '補假',
        '2026-02-28': '和平紀念日',
        '2026-04-03': '補節',
        '2026-04-04': '兒童節',
        '2026-04-05': '清明節',
        '2026-04-06': '補假',
        '2026-05-01': '勞動節',
        '2026-06-19': '端午節',
        '2026-09-25': '中秋節',
        '2026-09-28': '教師節',
        '2026-10-09': '補假',
        '2026-10-10': '國慶日',
        '2026-10-26': '光復節',
        '2026-12-25': '行憲紀念日',
      }
    };

    // 獲取假日名稱
    function getHolidayName(dateStr) {
      const year = dateStr.substring(0, 4);
      const holidays = TAIWAN_HOLIDAYS[year] || {};
      return holidays[dateStr] || null;
    }

    // 儲存當前顯示的年月
    let currentCalendarDate = new Date();

    function renderCalendar() {
      const year = currentCalendarDate.getFullYear();
      const month = currentCalendarDate.getMonth();
      const first = new Date(year, month, 1);
      const startDay = first.getDay() === 0 ? 7 : first.getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const today = new Date();
      const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();

      const cells = [];
      // 上個月的日期（填充空白）
      for (let i = 1; i < startDay; i++) {
        cells.push('<div class="day other-month"></div>');
      }

      // 當月的日期
      for (let d = 1; d <= daysInMonth; d++) {
        const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const isToday = isCurrentMonth && d === today.getDate();
        const holidayName = getHolidayName(ds);
        const isHolidayDay = !!holidayName;

        const items = TASKS.filter(t => t.dueDate === ds).map(t => {
          const title = (t.title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          return `<div class="chip p-mid calendar-task" data-task-id="${t.id}" style="margin-top:6px;cursor:pointer" title="${title}">${title}</div>`;
        }).join('');

        const dayClass = `day ${isToday ? 'today' : ''} ${isHolidayDay ? 'holiday' : ''}`;
        const holidayLabel = holidayName ? `<div class="holiday-label">${holidayName}</div>` : '';
        cells.push(`<div class="${dayClass}"><div class="d">${d}</div>${holidayLabel}${items}</div>`);
      }

      // 下個月的日期（填充到完整的一週，確保是7的倍數）
      const totalCells = cells.length;
      const weeks = Math.ceil(totalCells / 7);
      const remainingCells = weeks * 7 - totalCells;
      for (let i = 0; i < remainingCells; i++) {
        cells.push('<div class="day other-month"></div>');
      }

      const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
      const weekdays = ['一', '二', '三', '四', '五', '六', '日'];

      elApp.innerHTML = `
        <div class="toolbar" style="display:flex;justify-content:space-between;align-items:center">
          <h2 style="margin:0">行事曆</h2>
          <div style="display:flex;align-items:center;gap:12px">
            <button class="btn ghost" id="btnPrevMonth" style="padding:6px 12px">‹ 上個月</button>
            <div style="font-size:18px;font-weight:600;min-width:180px;text-align:center">
              ${year}年 ${monthNames[month]}
            </div>
            <button class="btn ghost" id="btnNextMonth" style="padding:6px 12px">下個月 ›</button>
            <button class="btn ghost" id="btnToday" style="padding:6px 12px">今天</button>
          </div>
        </div>
        <div class="calendar-weekdays">
          ${weekdays.map(w => `<div class="weekday">${w}</div>`).join('')}
        </div>
        <div class="calendar-grid">${cells.join('')}</div>
      `;

      // 月份切換事件
      document.getElementById('btnPrevMonth').addEventListener('click', () => {
        currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
        renderCalendar();
      });

      document.getElementById('btnNextMonth').addEventListener('click', () => {
        currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
        renderCalendar();
      });

      document.getElementById('btnToday').addEventListener('click', () => {
        currentCalendarDate = new Date();
        renderCalendar();
      });

      // 添加任務點擊事件
      elApp.querySelectorAll('.calendar-task').forEach(el => {
        el.addEventListener('click', () => {
          const taskId = el.getAttribute('data-task-id');
          if (taskId) {
            location.hash = `#task/${taskId}`;
          }
        });
      });
    }

    // ===== 便利貼頁面 =====
    let notesLoaded = false; // 追蹤是否已載入過便利貼數據
    let expandedNotes = new Set(); // 追蹤展開的便利貼 ID

    // 獲取便利貼標題（從內容第一行提取，或使用默認標題）
    function getNoteTitle(note) {
      if (note.title) return note.title;
      if (note.content) {
        const firstLine = note.content.split('\n')[0].trim();
        if (firstLine) return firstLine.length > 50 ? firstLine.substring(0, 50) + '...' : firstLine;
      }
      return '無標題';
    }

    function renderNotes(forceReload = false) {
      // 如果尚未載入過數據，或強制重新載入，則從服務器載入
      const shouldLoad = !notesLoaded || forceReload;
      const loadPromise = shouldLoad ? loadNotes().then(() => { notesLoaded = true; }) : Promise.resolve();

      loadPromise.then(() => {
        const colors = ['#ffd700', '#ff6b6b', '#4ecdc4', '#95e1d3', '#f38181', '#aa96da', '#fcbad3', '#a8e6cf'];

        elApp.innerHTML = `
          <div class="toolbar" style="display:flex;justify-content:space-between;align-items:center">
            <h2 style="margin:0">便利貼</h2>
            <button class="btn primary" id="btnNewNote">+ 新增便利貼</button>
          </div>
          <div class="notes-list" id="notesList">
            ${NOTES.map((note, index) => {
          const color = note.color || colors[index % colors.length];
          const isExpanded = expandedNotes.has(note.id);
          const title = getNoteTitle(note);

          return `
                <div class="note-list-item" data-note-id="${note.id}" style="border-left:4px solid ${color}">
                  <div class="note-list-header" data-note-id="${note.id}">
                    <div class="note-list-title-section">
                      <button class="note-toggle" data-note-id="${note.id}" title="${isExpanded ? '收合' : '展開'}">
                        ${isExpanded ? '▼' : '▶'}
                      </button>
                      <span class="note-list-title" contenteditable="true" data-note-id="${note.id}" data-field="title">${title}</span>
                    </div>
                    <div class="note-list-actions">
                      <input type="color" class="note-color-picker-small" data-note-id="${note.id}" value="${color}" title="選擇顏色" />
                      <button class="note-delete" data-note-id="${note.id}" title="刪除">×</button>
                    </div>
                  </div>
                  <div class="note-list-content ${isExpanded ? 'expanded' : ''}" data-note-id="${note.id}">
                    <div class="note-files-section">
                      ${(() => {
              // 顯示所有文件
              const allFiles = note.files || [];

              if (allFiles.length > 0) {
                return `
                            <div class="note-files-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin:0 16px 12px">
                              ${allFiles.map(file => {
                  const isPdf = file.mimetype === 'application/pdf' || file.filename.toLowerCase().endsWith('.pdf');
                  // 確保 URL 是完整的路徑
                  let fileUrl = file.url;
                  if (!fileUrl.startsWith('http') && !fileUrl.startsWith('/')) {
                    fileUrl = '/' + fileUrl;
                  }
                  return `
                              <div class="note-file-item" style="position:relative">
                                ${isPdf ? `
                                  <div style="position:relative">
                                    <iframe src="${fileUrl}" class="note-pdf-display" style="width:100%;height:500px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.2);margin-bottom:8px;border:none" frameborder="0"></iframe>
                                    <button class="note-pdf-expand" data-pdf-url="${fileUrl}" style="position:absolute;bottom:12px;right:12px;background:rgba(0,0,0,0.7);border:none;color:#fff;padding:8px 12px;border-radius:6px;cursor:pointer;font-size:14px;z-index:10;display:flex;align-items:center;gap:6px" title="放大查看">🔍 放大</button>
                                  </div>
                                  <button class="note-file-delete" data-note-id="${note.id}" data-file-url="${file.url}" title="刪除檔案" style="position:absolute;top:4px;right:4px;background:rgba(239,68,68,0.9);border:none;color:#fff;width:24px;height:24px;border-radius:50%;cursor:pointer;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;z-index:10;box-shadow:0 2px 4px rgba(0,0,0,0.2)">×</button>
                                ` : `
                                  <a href="${fileUrl}" target="_blank" class="note-file-link-display" style="color:var(--primary);text-decoration:none;font-size:14px;display:block;padding:8px 12px;background:var(--panel-2);border-radius:8px;margin-bottom:8px">📎 ${file.filename}</a>
                                  <button class="note-file-delete" data-note-id="${note.id}" data-file-url="${file.url}" title="刪除檔案" style="position:absolute;top:4px;right:4px;background:rgba(239,68,68,0.9);border:none;color:#fff;width:24px;height:24px;border-radius:50%;cursor:pointer;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;z-index:10;box-shadow:0 2px 4px rgba(0,0,0,0.2)">×</button>
                                `}
                              </div>
                            `;
                }).join('')}
                            </div>
                          `;
              }
              return '';
            })()}
                    </div>
                    <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
                      <span style="display:block;margin-bottom:8px;margin-left:16px;color:var(--text);font-size:14px;font-weight:500">內容</span>
                      <div class="prop-value" contenteditable="true" data-field="content" data-note-id="${note.id}" style="min-height:200px;padding:12px;background:var(--panel-2);border-radius:8px;white-space:pre-wrap;outline:none">${note.content || ''}</div>
                    </div>
                  </div>
                </div>
              `;
        }).join('')}
          </div>
        `;

        // 新增便利貼按鈕
        document.getElementById('btnNewNote').addEventListener('click', async () => {
          const newNote = {
            id: 'n_' + Date.now(),
            title: '',
            content: '',
            color: colors[NOTES.length % colors.length],
            images: [],
            files: [],
            createdAt: new Date().toISOString()
          };
          NOTES.push(newNote);
          expandedNotes.add(newNote.id); // 新增的便利貼自動展開
          // 等待保存完成後再重新渲染
          await saveNotes();
          renderNotes(false); // 不重新載入，直接使用當前數據渲染
        });

        // 展開/收合便利貼
        elApp.querySelectorAll('.note-toggle').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const noteId = btn.getAttribute('data-note-id');
            if (expandedNotes.has(noteId)) {
              expandedNotes.delete(noteId);
            } else {
              expandedNotes.add(noteId);
            }
            renderNotes(false);
          });
        });

        // 點擊標題區域也可以展開/收合
        elApp.querySelectorAll('.note-list-header').forEach(header => {
          header.addEventListener('click', (e) => {
            // 如果點擊的是按鈕或輸入框，不觸發展開/收合
            if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.note-list-title')) {
              return;
            }
            const noteId = header.getAttribute('data-note-id');
            if (expandedNotes.has(noteId)) {
              expandedNotes.delete(noteId);
            } else {
              expandedNotes.add(noteId);
            }
            renderNotes(false);
          });
        });

        // 標題編輯
        elApp.querySelectorAll('.note-list-title').forEach(el => {
          const noteId = el.getAttribute('data-note-id');
          let saveTimer;
          el.addEventListener('blur', () => {
            const note = NOTES.find(n => n.id === noteId);
            if (note) {
              note.title = el.textContent.trim();
              saveNotes();
            }
          });
          el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              el.blur();
            }
          });
        });

        // 處理便利貼內容區域
        elApp.querySelectorAll('[data-field="content"][data-note-id]').forEach(el => {
          const noteId = el.getAttribute('data-note-id');
          const note = NOTES.find(n => n.id === noteId);
          if (!note) return;

          let saveTimer;

          el.addEventListener('input', () => {
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
              if (note) {
                note.content = el.innerHTML || '';
                saveNotes();
              }
            }, 500);
          });

          el.addEventListener('blur', () => {
            clearTimeout(saveTimer);
            if (note) {
              note.content = el.innerHTML || '';
              saveNotes();
            }
          });

          el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.shiftKey === false) {
              // 允許 Enter 鍵正常換行
            }
          });
        });

        // 刪除便利貼
        elApp.querySelectorAll('.note-delete').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const noteId = btn.getAttribute('data-note-id');
            if (confirm('確定要刪除這個便利貼嗎？')) {
              const idx = NOTES.findIndex(n => n.id === noteId);
              if (idx > -1) {
                NOTES.splice(idx, 1);
                saveNotes();
                renderNotes(false); // 不重新載入，直接使用當前數據渲染
              }
            }
          });
        });

        // PDF 放大模式（便利貼）
        elApp.querySelectorAll('.note-pdf-expand').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const pdfUrl = btn.getAttribute('data-pdf-url');
            showPdfModal(pdfUrl);
          });
        });

        // 刪除檔案
        elApp.querySelectorAll('.note-file-delete').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const noteId = btn.getAttribute('data-note-id');
            const fileUrl = btn.getAttribute('data-file-url');
            const note = NOTES.find(n => n.id === noteId);
            if (note) {
              if (note.images) note.images = note.images.filter(img => img.url !== fileUrl);
              if (note.files) note.files = note.files.filter(file => file.url !== fileUrl);
              saveNotes();
              renderNotes(false); // 不重新載入，直接使用當前數據渲染
            }
          });
        });

        // 顏色選擇（禁止白色）
        elApp.querySelectorAll('.note-color-picker-small').forEach(picker => {
          picker.addEventListener('change', (e) => {
            const noteId = picker.getAttribute('data-note-id');
            const note = NOTES.find(n => n.id === noteId);
            if (note) {
              const selectedColor = e.target.value;
              // 檢查是否為白色或接近白色（RGB 值都大於 240）
              const rgb = hexToRgb(selectedColor);
              if (rgb && rgb.r > 240 && rgb.g > 240 && rgb.b > 240) {
                notify('不能使用白色或接近白色的顏色');
                // 恢復原來的顏色
                e.target.value = note.color || colors[0];
                return;
              }
              note.color = selectedColor;
              saveNotes();
              renderNotes(false); // 不重新載入，直接使用當前數據渲染
            }
          });
        });
      });
    }

    // 將十六進制顏色轉換為 RGB
    function hexToRgb(hex) {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      } : null;
    }

    // 顯示 PDF 放大視窗
    function showPdfModal(pdfUrl) {
      // 如果已經有打開的視窗，先關閉
      const existingModal = document.querySelector('.pdf-modal');
      if (existingModal) {
        document.body.removeChild(existingModal);
      }

      const modal = document.createElement('div');
      modal.className = 'pdf-modal';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;z-index:1000;padding:20px';
      modal.innerHTML = `
        <div style="position:relative;width:100%;height:100%;max-width:95vw;max-height:95vh;display:flex;flex-direction:column">
          <div style="display:flex;justify-content:flex-end;margin-bottom:12px;gap:8px">
            <button class="pdf-modal-close" style="background:rgba(255,255,255,0.2);border:none;color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:24px;line-height:1;display:flex;align-items:center;justify-content:center;transition:background 0.2s" title="關閉">×</button>
          </div>
          <iframe src="${pdfUrl}" style="flex:1;width:100%;height:100%;border:none;border-radius:8px;background:#fff"></iframe>
        </div>
      `;

      document.body.appendChild(modal);

      // 關閉按鈕
      modal.querySelector('.pdf-modal-close').addEventListener('click', () => {
        if (document.body.contains(modal)) {
          document.body.removeChild(modal);
        }
      });

      // ESC 鍵關閉
      const escHandler = (e) => {
        if (e.key === 'Escape' && document.body.contains(modal)) {
          document.body.removeChild(modal);
          document.removeEventListener('keydown', escHandler);
        }
      };
      document.addEventListener('keydown', escHandler);

      // 點擊背景關閉
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          if (document.body.contains(modal)) {
            document.body.removeChild(modal);
          }
        }
      });
    }

    // 顯示便利貼放大視窗
    function showNoteModal(note) {
      const colors = ['#ffd700', '#ff6b6b', '#4ecdc4', '#95e1d3', '#f38181', '#aa96da', '#fcbad3', '#a8e6cf'];
      const color = note.color || colors[0];

      // 如果已經有打開的視窗，先關閉
      const existingModal = document.querySelector('.note-modal');
      if (existingModal) {
        document.body.removeChild(existingModal);
      }

      const modal = document.createElement('div');
      modal.className = 'note-modal';
      modal.innerHTML = `
        <div class="note-modal-content" style="background:${color}">
          <div class="note-modal-header">
            <button class="note-modal-close" title="關閉">×</button>
          </div>
          <div class="note-modal-body">
            <div class="note-modal-content-editor" contenteditable="true" data-note-id="${note.id}" style="min-height:300px;padding:16px;background:rgba(255,255,255,0.2);border-radius:8px;outline:none;color:#333;font-size:16px;line-height:1.8;word-wrap:break-word">${fixImageUrlsInHtml(note.content || '')}</div>
            <div class="note-modal-files">
              ${(note.images || []).map(img => `
                <div class="note-modal-file-item">
                  <img src="${img.url}" alt="${img.filename}" class="note-modal-image" onclick="window.open('${img.url}', '_blank')" />
                  <button class="note-modal-file-delete" data-note-id="${note.id}" data-file-url="${img.url}">×</button>
                </div>
              `).join('')}
              ${(note.files || []).map(file => `
                <div class="note-modal-file-item">
                  <a href="${file.url}" target="_blank" class="note-modal-file-link">📎 ${file.filename}</a>
                  <button class="note-modal-file-delete" data-note-id="${note.id}" data-file-url="${file.url}">×</button>
                </div>
              `).join('')}
            </div>
            <div class="note-modal-footer">
              <input type="file" class="note-modal-upload-file-input" data-note-id="${note.id}" multiple style="display:none" />
              <button class="note-modal-upload-btn" data-note-id="${note.id}" data-type="file" title="上傳檔案">📎 上傳檔案</button>
              <input type="color" class="note-modal-color-picker" data-note-id="${note.id}" value="${color}" title="選擇顏色" />
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      // 關閉按鈕
      modal.querySelector('.note-modal-close').addEventListener('click', () => {
        if (document.body.contains(modal)) {
          document.body.removeChild(modal);
        }
      });

      // 點擊背景關閉
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          if (document.body.contains(modal)) {
            document.body.removeChild(modal);
          }
        }
      });

      // ESC 鍵關閉
      const escHandler = (e) => {
        if (e.key === 'Escape' && document.body.contains(modal)) {
          document.body.removeChild(modal);
          document.removeEventListener('keydown', escHandler);
        }
      };
      document.addEventListener('keydown', escHandler);

      // 內容編輯 - 保存 HTML 內容（包含圖片）
      const contentEditor = modal.querySelector('.note-modal-content-editor');
      let saveTimer;

      // 處理粘貼圖片（截圖等）
      contentEditor.addEventListener('paste', async (e) => {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('image') !== -1) {
            e.preventDefault();
            const blob = items[i].getAsFile();
            const file = new File([blob], `paste-${Date.now()}.png`, { type: 'image/png' });

            try {
              notify('正在上傳粘貼的圖片...');
              const result = await uploadFile(file);
              if (result.success) {
                // 確保 URL 是完整的路徑
                let imageUrl = result.url;
                if (!imageUrl.startsWith('http') && !imageUrl.startsWith('/')) {
                  imageUrl = '/' + imageUrl;
                }

                // 插入圖片到當前光標位置
                const selection = window.getSelection();
                const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

                const imageHtml = `<div style="margin:16px 0;position:relative;display:block;width:100%;max-width:100%"><img src="${imageUrl}" alt="${result.filename}" style="width:100%;max-width:100%;height:auto;border-radius:8px;display:block;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.2);object-fit:contain;background:var(--panel-2)" onclick="window.open('${imageUrl}', '_blank')" onerror="console.error('圖片載入失敗:', '${imageUrl}'); this.style.display='none'; this.nextElementSibling.style.display='block';" onload="this.style.width='100%'; this.style.maxWidth='100%'; this.style.height='auto';" /><div style="display:none;padding:12px;background:var(--panel-2);border-radius:8px;color:var(--muted);text-align:center;margin:8px 0">圖片載入失敗: ${result.filename}</div><button class="note-remove-inline" data-note-id="${note.id}" data-file-url="${result.url}" style="position:absolute;top:4px;right:4px;background:rgba(239,68,68,0.9);border:none;color:#fff;width:24px;height:24px;border-radius:50%;cursor:pointer;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;z-index:10;box-shadow:0 2px 4px rgba(0,0,0,0.2)">×</button></div>`;

                if (range && contentEditor.contains(range.commonAncestorContainer)) {
                  range.deleteContents();
                  const tempDiv = document.createElement('div');
                  tempDiv.innerHTML = imageHtml;
                  const fragment = document.createDocumentFragment();
                  while (tempDiv.firstChild) {
                    fragment.appendChild(tempDiv.firstChild);
                  }
                  range.insertNode(fragment);
                  range.collapse(false);
                  selection.removeAllRanges();
                  selection.addRange(range);
                } else {
                  const tempDiv = document.createElement('div');
                  tempDiv.innerHTML = imageHtml;
                  while (tempDiv.firstChild) {
                    contentEditor.appendChild(tempDiv.firstChild);
                  }
                }

                // 綁定刪除按鈕
                contentEditor.querySelectorAll('.note-remove-inline').forEach(btn => {
                  btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    btn.parentElement.remove();
                    note.content = contentEditor.innerHTML;
                    await saveNotes();
                    notify('圖片已刪除');
                  });
                });

                // 觸發 input 事件以保存
                contentEditor.dispatchEvent(new Event('input', { bubbles: true }));
                notify('圖片上傳成功');
              }
            } catch (error) {
              console.error('粘貼圖片上傳失敗:', error);
              notify('圖片上傳失敗');
            }
            break;
          }
        }
      });

      contentEditor.addEventListener('input', () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          // 保存 HTML 內容，這樣圖片會保留
          note.content = contentEditor.innerHTML;
          saveNotes();
          renderNotes();
        }, 500);
      });

      // 為已存在的圖片刪除按鈕綁定事件（modal 中也需要重新綁定）
      contentEditor.querySelectorAll('.note-remove-inline').forEach(btn => {
        // 移除舊的事件監聽器（如果有的話）
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);

        newBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          e.preventDefault();
          const btnNoteId = newBtn.getAttribute('data-note-id');
          const note = NOTES.find(n => n.id === btnNoteId);
          if (note) {
            newBtn.parentElement.remove();
            note.content = contentEditor.innerHTML;
            await saveNotes();
            showNoteModal(note); // 重新顯示以更新內容
            notify('圖片已刪除');
          }
        });
      });

      // 上傳檔案
      modal.querySelector('.note-modal-upload-btn[data-type="file"]').addEventListener('click', () => {
        modal.querySelector('.note-modal-upload-file-input').click();
      });

      modal.querySelector('.note-modal-upload-file-input').addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        for (const file of files) {
          try {
            notify('正在上傳檔案...');
            const result = await uploadFile(file);
            if (result.success) {
              if (!note.files) note.files = [];
              note.files.push({
                url: result.url,
                filename: result.filename,
                size: result.size,
                mimetype: result.mimetype
              });
              saveNotes();
              notify('檔案上傳成功');
            }
          } catch (error) {
            console.error('上傳失敗:', error);
            notify('檔案上傳失敗');
          }
        }
        showNoteModal(note); // 重新顯示以更新內容
      });

      // 刪除檔案
      modal.querySelectorAll('.note-modal-file-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const fileUrl = btn.getAttribute('data-file-url');
          if (note.images) note.images = note.images.filter(img => img.url !== fileUrl);
          if (note.files) note.files = note.files.filter(file => file.url !== fileUrl);
          saveNotes();
          showNoteModal(note); // 重新顯示以更新內容
        });
      });

      // 顏色選擇（禁止白色）
      modal.querySelector('.note-modal-color-picker').addEventListener('change', (e) => {
        const selectedColor = e.target.value;
        // 檢查是否為白色或接近白色（RGB 值都大於 240）
        const rgb = hexToRgb(selectedColor);
        if (rgb && rgb.r > 240 && rgb.g > 240 && rgb.b > 240) {
          notify('不能使用白色或接近白色的顏色');
          // 恢復原來的顏色
          e.target.value = note.color || colors[0];
          return;
        }
        note.color = selectedColor;
        saveNotes();
        showNoteModal(note); // 重新顯示以更新顏色
      });
    }

    // ===== 表單處理 =====
    // 氣泡選擇組件
    // 獲取用戶頭像（簡單實現，使用名字首字）
    function getUserAvatar(userName) {
      return userName.charAt(0);
    }

    function renderBubbleSelect(container, field, selectedValues, disabled = false) {
      if (!container) return;
      selectedValues = Array.isArray(selectedValues) ? selectedValues : (selectedValues ? [selectedValues] : []);

      // 保存選中值到容器（在渲染前保存，以便後續使用）
      container._selectedValues = [...selectedValues];

      // 創建 Notion 風格的結構
      container.innerHTML = `
        <div class="bubble-select-input ${disabled ? 'disabled' : ''}">
          ${selectedValues.map(name => {
        const user = USERS.find(u => u.name === name);
        if (!user) return '';
        return `
              <div class="bubble-chip" data-user="${user.name}">
                <div class="bubble-chip-avatar">${getUserAvatar(user.name)}</div>
                <span class="bubble-chip-name">${user.name}</span>
                ${disabled ? '' : '<button type="button" class="bubble-chip-remove" data-user="' + user.name + '">×</button>'}
              </div>
            `;
      }).join('')}
          ${disabled ? '' : '<input type="text" placeholder="搜尋或選擇..." autocomplete="off">'}
        </div>
        <div class="bubble-select-dropdown">
          <div class="bubble-select-hint">可選取多個選項</div>
          <div class="bubble-select-list">
            ${USERS.map(u => {
        const isSelected = selectedValues.includes(u.name);
        if (isSelected) return ''; // 已選中的不顯示在下拉列表中
        return `
                <button type="button" class="bubble-option" data-user="${u.name}">
                  <div class="bubble-option-avatar">${getUserAvatar(u.name)}</div>
                  <span class="bubble-option-name">${u.name}</span>
                </button>
              `;
      }).filter(html => html).join('')}
          </div>
        </div>
      `;

      const input = container.querySelector('.bubble-select-input input');
      const dropdown = container.querySelector('.bubble-select-dropdown');

      // 如果是禁用狀態，不添加事件監聽器
      if (disabled) {
        return;
      }

      // 輸入框聚焦時顯示下拉列表
      if (input) {
        input.addEventListener('focus', () => {
          if (dropdown) dropdown.classList.add('show');
        });
      }

      // 點擊輸入框時顯示下拉列表
      const inputWrapper = container.querySelector('.bubble-select-input');
      if (inputWrapper) {
        // 移除舊的事件監聽器（如果有的話）
        if (inputWrapper._clickHandler) {
          inputWrapper.removeEventListener('click', inputWrapper._clickHandler);
        }
        inputWrapper._clickHandler = (e) => {
          // 如果點擊的是輸入框本身或氣泡芯片，顯示下拉列表
          if (e.target === input || e.target.closest('.bubble-chip') || e.target === inputWrapper) {
            e.stopPropagation();
            if (dropdown) dropdown.classList.add('show');
            if (input) input.focus();
          }
        };
        inputWrapper.addEventListener('click', inputWrapper._clickHandler);
      }

      // 使用事件委派處理點擊外部關閉下拉列表（避免重複添加監聽器）
      if (!container._outsideClickHandler) {
        container._outsideClickHandler = (e) => {
          if (!container.contains(e.target)) {
            if (dropdown) dropdown.classList.remove('show');
          }
        };
        // 使用 setTimeout 確保事件在當前事件循環之後綁定
        setTimeout(() => {
          document.addEventListener('click', container._outsideClickHandler);
        }, 0);
      }

      // 搜尋功能
      if (input) {
        input.addEventListener('input', (e) => {
          const query = e.target.value.toLowerCase();
          const options = dropdown ? dropdown.querySelectorAll('.bubble-option') : [];
          options.forEach(option => {
            const name = option.getAttribute('data-user');
            if (name && name.toLowerCase().includes(query)) {
              option.style.display = 'flex';
            } else {
              option.style.display = 'none';
            }
          });
        });
      }

      // 使用事件委派處理點擊選項（避免重複添加監聽器）
      if (dropdown) {
        // 移除舊的事件監聽器（如果有的話）
        if (dropdown._optionClickHandler) {
          dropdown.removeEventListener('click', dropdown._optionClickHandler);
        }
        dropdown._optionClickHandler = (e) => {
          const option = e.target.closest('.bubble-option');
          if (option) {
            e.stopPropagation();
            e.preventDefault();
            const userName = option.getAttribute('data-user');
            if (userName && !container._selectedValues.includes(userName)) {
              container._selectedValues.push(userName);
              const isDisabled = container.getAttribute('data-disabled') === 'true';
              renderBubbleSelect(container, field, container._selectedValues, isDisabled);
              // 觸發變更事件
              container.dispatchEvent(new CustomEvent('change', { detail: { values: [...container._selectedValues] } }));
            }
          }
        };
        dropdown.addEventListener('click', dropdown._optionClickHandler);
      }

      // 使用事件委派處理移除選中的項目
      if (inputWrapper) {
        // 移除舊的事件監聽器（如果有的話）
        if (inputWrapper._removeClickHandler) {
          inputWrapper.removeEventListener('click', inputWrapper._removeClickHandler);
        }
        inputWrapper._removeClickHandler = (e) => {
          const removeBtn = e.target.closest('.bubble-chip-remove');
          if (removeBtn) {
            e.stopPropagation();
            e.preventDefault();
            const userName = removeBtn.getAttribute('data-user');
            if (userName) {
              const index = container._selectedValues.indexOf(userName);
              if (index > -1) {
                container._selectedValues.splice(index, 1);
                const isDisabled = container.getAttribute('data-disabled') === 'true';
                renderBubbleSelect(container, field, container._selectedValues, isDisabled);
                // 觸發變更事件
                container.dispatchEvent(new CustomEvent('change', { detail: { values: [...container._selectedValues] } }));
              }
            }
          }
        };
        inputWrapper.addEventListener('click', inputWrapper._removeClickHandler);
      }
    }

    // 創建自定義下拉選單（用於負責人和執行人）
    function renderCustomDropdown(container, field, selectedValues) {
      if (!container) return;
      selectedValues = Array.isArray(selectedValues) ? selectedValues : (selectedValues ? [selectedValues] : []);

      // 保存選中值到容器
      container._selectedValues = [...selectedValues];

      // 創建下拉選單結構
      const selectedText = selectedValues.length > 0
        ? selectedValues.join(', ')
        : '請選擇...';

      container.innerHTML = `
        <div class="custom-dropdown-trigger">
          <span class="custom-dropdown-text">${selectedText}</span>
          <span class="custom-dropdown-arrow">▼</span>
        </div>
        <div class="custom-dropdown-menu">
          ${USERS.map(u => {
        const isSelected = selectedValues.includes(u.name);
        return `
              <div class="custom-dropdown-option ${isSelected ? 'selected' : ''}" data-user="${u.name}">
                <span class="custom-dropdown-checkbox">${isSelected ? '✓' : ''}</span>
                <span class="custom-dropdown-option-text">${u.name}</span>
              </div>
            `;
      }).join('')}
        </div>
      `;

      const trigger = container.querySelector('.custom-dropdown-trigger');
      const menu = container.querySelector('.custom-dropdown-menu');

      // 點擊觸發器顯示/隱藏選單
      if (trigger) {
        // 移除舊的事件監聽器（如果有的話）
        if (trigger._clickHandler) {
          trigger.removeEventListener('click', trigger._clickHandler);
        }
        trigger._clickHandler = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const currentMenu = container.querySelector('.custom-dropdown-menu');
          if (currentMenu) {
            const isShowing = currentMenu.classList.contains('show');
            if (isShowing) {
              currentMenu.classList.remove('show');
            } else {
              // 關閉其他所有打開的選單
              document.querySelectorAll('.custom-dropdown-menu.show').forEach(m => {
                if (m !== currentMenu) m.classList.remove('show');
              });
              currentMenu.classList.add('show');
            }
          }
        };
        trigger.addEventListener('click', trigger._clickHandler);
        // 也添加 mousedown 事件作為備用
        trigger.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          trigger._clickHandler(e);
        });
      }

      // 點擊選項切換選中狀態 - 直接在每個選項上綁定事件
      if (menu) {
        const options = menu.querySelectorAll('.custom-dropdown-option');
        options.forEach(option => {
          // 移除舊的事件監聽器（如果有的話）
          if (option._clickHandler) {
            option.removeEventListener('click', option._clickHandler);
            option.removeEventListener('mousedown', option._mousedownHandler);
            option.removeEventListener('pointerdown', option._pointerdownHandler);
          }

          // 點擊事件處理
          option._clickHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('選項被點擊', option);
            const userName = option.getAttribute('data-user');
            console.log('用戶名:', userName);
            if (userName) {
              const index = container._selectedValues.indexOf(userName);
              if (index > -1) {
                // 取消選中
                container._selectedValues.splice(index, 1);
              } else {
                // 選中
                container._selectedValues.push(userName);
              }
              // 重新渲染
              renderCustomDropdown(container, field, container._selectedValues);
              // 觸發變更事件
              container.dispatchEvent(new CustomEvent('change', { detail: { values: [...container._selectedValues] } }));
            }
          };

          // mousedown 事件處理（作為備用）
          option._mousedownHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();
            option._clickHandler(e);
          };

          // pointerdown 事件處理（作為備用）
          option._pointerdownHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();
            option._clickHandler(e);
          };

          option.addEventListener('click', option._clickHandler, { capture: true });
          option.addEventListener('mousedown', option._mousedownHandler, { capture: true });
          option.addEventListener('pointerdown', option._pointerdownHandler, { capture: true });
        });
      }

      // 點擊外部關閉選單
      // 移除舊的外部點擊處理器（如果有的話）
      if (container._outsideClickHandler) {
        document.removeEventListener('click', container._outsideClickHandler);
      }
      container._outsideClickHandler = (e) => {
        if (!container.contains(e.target)) {
          const currentMenu = container.querySelector('.custom-dropdown-menu');
          if (currentMenu) currentMenu.classList.remove('show');
        }
      };
      setTimeout(() => {
        document.addEventListener('click', container._outsideClickHandler);
      }, 0);
    }

    function getBubbleSelectValues(container) {
      if (!container) return [];
      return container._selectedValues || [];
    }

    function openForm(task) {
      if (task) {
        form.elements['id'].value = task.id;
        form.elements['title'].value = task.title || '';
        form.elements['status'].value = task.status || '待辦';
        form.elements['priority'].value = task.priority || '中';
        form.elements['dueDate'].value = task.dueDate || '';
        form.elements['completeDate'].value = task.completeDate || '';
        form.elements['progress'].value = task.progress || 0;
        form.elements['notes'].value = task.notes || '';

        // 設置氣泡選擇
        const ownerContainer = form.querySelector('[data-field="owner"]');
        const owners = Array.isArray(task.owner) ? task.owner : (task.owner ? [task.owner] : []);
        renderBubbleSelect(ownerContainer, 'owner', owners);

        const execContainer = form.querySelector('[data-field="executors"]');
        renderBubbleSelect(execContainer, 'executors', task.executors || []);

        document.getElementById('taskModalTitle').textContent = '編輯工作';
        btnDelete.style.display = '';
      } else {
        form.reset();
        form.elements['id'].value = '';
        form.elements['progress'].value = 0;

        // 重置氣泡選擇
        const ownerContainer = form.querySelector('[data-field="owner"]');
        renderBubbleSelect(ownerContainer, 'owner', []);

        const execContainer = form.querySelector('[data-field="executors"]');
        renderBubbleSelect(execContainer, 'executors', []);

        document.getElementById('taskModalTitle').textContent = '新增工作';
        btnDelete.style.display = 'none';
      }
      // 初始化日期輸入框處理器（轉換為日期選擇器）
      initDateInputHandlers();
      modal.classList.add('open');
    }
    function closeForm() { modal.classList.remove('open'); }
    btnClose.addEventListener('click', closeForm);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeForm(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeForm(); });

    // 日期選擇器組件
    function createDatePicker(input) {
      const value = input.value || '';
      const picker = document.createElement('div');
      picker.className = 'date-picker';

      const inputWrapper = document.createElement('div');
      inputWrapper.className = 'date-picker-input';

      const inputField = document.createElement('input');
      inputField.type = 'text';
      inputField.placeholder = '選擇日期';
      inputField.readOnly = true;
      inputField.value = value ? formatDateDisplay(value) : '';

      const icon = document.createElement('span');
      icon.className = 'date-picker-icon';
      icon.textContent = '📅';

      inputWrapper.appendChild(inputField);
      inputWrapper.appendChild(icon);

      const dropdown = document.createElement('div');
      dropdown.className = 'date-picker-dropdown';

      let currentDate = value ? new Date(value + 'T00:00:00') : new Date();
      let selectedDate = value ? new Date(value + 'T00:00:00') : null;

      function formatDateDisplay(dateStr) {
        if (!dateStr) return '';
        try {
          const d = new Date(dateStr + 'T00:00:00');
          if (isNaN(d.getTime())) return '';
          const year = d.getFullYear();
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          return `${year}/${month}/${day}`;
        } catch (e) {
          return '';
        }
      }

      function formatDateValue(date) {
        if (!date) return '';
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }

      function renderCalendar() {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startDate = new Date(firstDay);
        startDate.setDate(startDate.getDate() - startDate.getDay());

        const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
        const weekdays = ['日', '一', '二', '三', '四', '五', '六'];

        dropdown.innerHTML = `
          <div class="date-picker-header">
            <button type="button" class="date-picker-nav" data-action="prev">‹</button>
            <div class="date-picker-month">${year}年${monthNames[month]}</div>
            <button type="button" class="date-picker-nav" data-action="next">›</button>
          </div>
          <div class="date-picker-weekdays">
            ${weekdays.map(w => `<div class="date-picker-weekday">${w}</div>`).join('')}
          </div>
          <div class="date-picker-days">
            ${Array.from({ length: 42 }, (_, i) => {
          const date = new Date(startDate);
          date.setDate(startDate.getDate() + i);
          const isOtherMonth = date.getMonth() !== month;
          const isToday = date.getTime() === today.getTime();
          const isSelected = selectedDate && date.getTime() === selectedDate.getTime();
          const dateStr = formatDateValue(date);

          return `<button type="button" class="date-picker-day ${isOtherMonth ? 'other-month' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}" data-date="${dateStr}">${date.getDate()}</button>`;
        }).join('')}
          </div>
          <div class="date-picker-actions">
            <button type="button" class="date-picker-clear">清除</button>
          </div>
        `;

        // 事件處理
        dropdown.querySelectorAll('.date-picker-nav').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.getAttribute('data-action');
            if (action === 'prev') {
              currentDate.setMonth(currentDate.getMonth() - 1);
            } else {
              currentDate.setMonth(currentDate.getMonth() + 1);
            }
            renderCalendar();
          });
        });

        dropdown.querySelectorAll('.date-picker-day').forEach(dayBtn => {
          dayBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const dateStr = dayBtn.getAttribute('data-date');
            selectedDate = new Date(dateStr + 'T00:00:00');
            inputField.value = formatDateDisplay(dateStr);
            input.value = dateStr;
            dropdown.classList.remove('show');
            input.dispatchEvent(new Event('change', { bubbles: true }));
          });
        });

        dropdown.querySelector('.date-picker-clear').addEventListener('click', (e) => {
          e.stopPropagation();
          selectedDate = null;
          inputField.value = '';
          input.value = '';
          dropdown.classList.remove('show');
          input.dispatchEvent(new Event('change', { bubbles: true }));
        });
      }

      inputWrapper.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('show');
        if (dropdown.classList.contains('show')) {
          renderCalendar();
        }
      });

      document.addEventListener('click', (e) => {
        if (!picker.contains(e.target)) {
          dropdown.classList.remove('show');
        }
      });

      // 將 renderCalendar 函數暴露到 picker 對象上，以便外部調用
      picker._renderCalendar = renderCalendar;
      picker._openCalendar = () => {
        dropdown.classList.add('show');
        renderCalendar();
      };

      picker.appendChild(inputWrapper);
      picker.appendChild(dropdown);

      return picker;
    }

    // 為表單中的日期輸入框添加年份限制和自動切換功能
    function initDateInputHandlers() {
      // 處理表單中的日期輸入框 - 轉換為日期選擇器
      form.querySelectorAll('input[type="date"]').forEach(dateInput => {
        // 如果已經轉換過，跳過
        if (dateInput.parentElement && dateInput.parentElement.classList.contains('date-picker')) {
          return;
        }

        // 創建日期選擇器
        const picker = createDatePicker(dateInput);
        dateInput.style.display = 'none';
        dateInput.style.position = 'absolute';
        dateInput.style.opacity = '0';
        dateInput.style.width = '0';
        dateInput.style.height = '0';
        dateInput.parentElement.insertBefore(picker, dateInput);

        // 當隱藏的 input 值改變時，更新日期選擇器顯示
        const observer = new MutationObserver(() => {
          const pickerInput = picker.querySelector('.date-picker-input input');
          if (pickerInput) {
            const value = dateInput.value || '';
            pickerInput.value = value ? formatDateDisplay(value) : '';
          }
        });
        observer.observe(dateInput, { attributes: true, attributeFilter: ['value'] });
      });

      // 保留原有的鍵盤輸入處理（用於任務詳情頁面）
      document.querySelectorAll('input[type="date"][data-field]').forEach(dateInput => {
        // 移除舊的事件監聽器（如果有的話）
        if (dateInput._dateHandler) {
          dateInput.removeEventListener('keydown', dateInput._dateHandler);
          dateInput.removeEventListener('paste', dateInput._pasteHandler);
        }

        // 鍵盤輸入處理
        dateInput._dateHandler = (e) => {
          // 只處理數字鍵和退格鍵
          if (!/[0-9]/.test(e.key) && e.key !== 'Backspace' && e.key !== 'Delete' && e.key !== 'Tab' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Enter') {
            e.preventDefault();
            return;
          }

          // 如果是數字鍵，處理輸入
          if (/[0-9]/.test(e.key)) {
            e.preventDefault();

            // 獲取當前值
            let value = dateInput.value || '';

            // 移除所有非數字字符，只保留數字
            let digits = value.replace(/\D/g, '');

            // 直接根據當前數字長度決定是否允許輸入
            if (digits.length >= 8) {
              // 已經輸入完成（8位數字：YYYYMMDD），不允許繼續輸入
              return;
            }

            // 添加新輸入的數字
            digits = digits + e.key;

            // 嚴格限制各部分長度
            let year = digits.slice(0, 4); // 年份最多4位
            let month = digits.slice(4, 6); // 月份最多2位
            let day = digits.slice(6, 8); // 日期最多2位

            // 格式化為 YYYY-MM-DD
            let formatted = '';
            if (year.length > 0) formatted += year;
            if (month.length > 0) formatted += '-' + month;
            if (day.length > 0) formatted += '-' + day;

            dateInput.value = formatted;

            // 根據輸入的位數設置游標位置
            if (digits.length <= 4) {
              // 還在輸入年份
              dateInput.setSelectionRange(digits.length, digits.length);
            } else if (digits.length <= 6) {
              // 輸入完年份，切換到月份
              dateInput.setSelectionRange(5 + (digits.length - 4), 5 + (digits.length - 4));
            } else if (digits.length <= 8) {
              // 輸入完月份，切換到日期
              dateInput.setSelectionRange(8 + (digits.length - 6), 8 + (digits.length - 6));
            } else {
              // 輸入完成
              dateInput.setSelectionRange(10, 10);
            }
          }
        };

        // 粘貼處理
        dateInput._pasteHandler = (e) => {
          e.preventDefault();
          const pastedText = (e.clipboardData || window.clipboardData).getData('text');
          const digits = pastedText.replace(/\D/g, '').slice(0, 8);

          let formatted = '';
          if (digits.length >= 1) formatted += digits.slice(0, 4);
          if (digits.length >= 5) formatted += '-' + digits.slice(4, 6);
          if (digits.length >= 7) formatted += '-' + digits.slice(6, 8);

          dateInput.value = formatted;
        };

        dateInput.addEventListener('keydown', dateInput._dateHandler);
        dateInput.addEventListener('paste', dateInput._pasteHandler);
      });
    }

    btnSave.addEventListener('click', async () => {
      const data = Object.fromEntries(new FormData(form).entries());
      // 處理氣泡選擇
      const ownerContainer = form.querySelector('[data-field="owner"]');
      const owners = getBubbleSelectValues(ownerContainer);
      const execContainer = form.querySelector('[data-field="executors"]');
      const execs = getBubbleSelectValues(execContainer);

      const isEdit = !!data.id;
      if (!data.title) return alert('請輸入任務名稱');
      if (!['待辦', '進行中', '完成'].includes(data.status)) data.status = '待辦';
      if (!['高', '中', '低'].includes(data.priority)) data.priority = '中';
      // 新任務使用臨時 ID，讓後端生成正式 ID
      const tempId = isEdit ? data.id : ('t_new_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9));
      const entity = ensureTaskMeta({
        id: tempId,
        title: data.title,
        status: data.status,
        priority: data.priority,
        owner: owners, // 陣列
        executors: execs, // 陣列
        completeDate: data.completeDate || null,
        dueDate: data.dueDate || null,
        progress: Number(data.progress || 0),
        notes: data.notes || '',
        content: data.content || '',
        files: data.files || []
      });
      if (isEdit) {
        const idx = TASKS.findIndex(x => x.id === data.id);
        if (idx > -1) {
          // 保留現有的 content 和 files（如果表單沒有提供）
          const existing = TASKS[idx];
          if (!data.content && existing.content) entity.content = existing.content;
          if (!data.files && existing.files) entity.files = existing.files;
          TASKS[idx] = entity;
        }
      } else {
        TASKS.unshift(entity);
      }
      try {
        await persistTask(entity);
        closeForm();
        notify(isEdit ? '已儲存變更' : '已新增工作');
        render();
      } catch (err) {
        notify(err?.data?.error || '儲存失敗，請重新整理後再試');
      }
    });

    btnDelete.addEventListener('click', () => {
      const id = form.elements['id'].value;
      if (id && confirm('確定要刪除這筆工作嗎？')) {
        const idx = TASKS.findIndex(x => x.id === id);
        if (idx > -1) {
          removeTask(id).then(() => {
            closeForm();
            notify('已刪除'); render();
          }).catch(err => notify(err?.data?.error || '刪除失敗，請重新整理'));
        }
      }
    });

    // ===== 任務詳細頁面（Notion風格） =====
    function renderTaskDetail(id) {
      const task = TASKS.find(t => t.id === id);
      if (!task) {
        elApp.innerHTML = '<div style="padding:40px;text-align:center"><p>找不到此任務</p><a href="#all" style="color:var(--primary)">返回列表</a></div>';
        return;
      }

      elApp.innerHTML = `
      <div style="max-width:900px;margin:0 auto">
        <div style="margin-bottom:24px">
          <a href="#all" style="color:var(--muted);text-decoration:none;font-size:14px">← 返回列表</a>
        </div>
        <div class="task-detail">
          <h1 class="task-title" contenteditable="true" data-field="title" data-placeholder="新增標題">${task.title || ''}</h1>
          <div class="task-props">
            <div class="prop-row">
              <span class="prop-label">狀態</span>
              <select class="prop-value prop-select" data-field="status">
                <option value="待辦" ${task.status === '待辦' ? 'selected' : ''}>待辦</option>
                <option value="進行中" ${task.status === '進行中' ? 'selected' : ''}>進行中</option>
                <option value="完成" ${task.status === '完成' ? 'selected' : ''}>完成</option>
              </select>
            </div>
            <div class="prop-row">
              <span class="prop-label">優先級</span>
              <select class="prop-value prop-select" data-field="priority">
                <option value="高" ${task.priority === '高' ? 'selected' : ''}>高</option>
                <option value="中" ${task.priority === '中' ? 'selected' : ''}>中</option>
                <option value="低" ${task.priority === '低' ? 'selected' : ''}>低</option>
              </select>
            </div>
            <div class="prop-row">
              <span class="prop-label">負責人</span>
              <div class="bubble-select" data-field="owner" style="margin-top:8px"></div>
            </div>
            <div class="prop-row">
              <span class="prop-label">執行人</span>
              <div class="bubble-select" data-field="executors" style="margin-top:8px"></div>
            </div>
            <div class="prop-row">
              <span class="prop-label" style="cursor:pointer">截止日期</span>
              <input type="date" class="prop-value prop-input" data-field="dueDate" value="${task.dueDate || ''}" id="taskDetailDueDate">
            </div>
            <div class="prop-row">
              <span class="prop-label" style="cursor:pointer">完成日期</span>
              <input type="date" class="prop-value prop-input" data-field="completeDate" value="${task.completeDate || ''}" id="taskDetailCompleteDate">
            </div>
            <div class="prop-row">
              <span class="prop-label">完成度</span>
              <span class="prop-value" contenteditable="true" data-field="progress">${task.progress || 0}</span>
            </div>
            <div class="prop-row" style="grid-column:1/-1">
              <span class="prop-label">備註</span>
              <div class="prop-value" contenteditable="true" data-field="notes" style="min-height:100px;padding:12px;background:var(--panel-2);border-radius:8px;white-space:pre-wrap">${task.notes || ''}</div>
            </div>
            <div class="prop-row" style="grid-column:1/-1;margin-top:16px">
              <span class="prop-label">內容</span>
              <div class="prop-value" contenteditable="true" data-field="content" style="min-height:200px;padding:12px;background:var(--panel-2);border-radius:8px;white-space:pre-wrap;outline:none">${task.content || ''}</div>
                </div>
            <div class="prop-row" style="grid-column:1/-1;margin-top:16px">
              <span class="prop-label">PDF文件</span>
              <div class="prop-value" style="margin-top:8px">
                <div class="task-pdfs-section">
                  ${(() => {
          // 顯示所有PDF文件
          const pdfFiles = (task.files || []).filter(file => {
            const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || file.filename || '');
            return isPdf;
          });

          if (pdfFiles.length > 0) {
            return `
                        <div class="task-pdfs-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;margin-bottom:16px">
                          ${pdfFiles.map(file => {
              let fileUrl = file.url || (file.data && file.data.startsWith('data:') ? file.data : null);
              const fileName = file.name || file.filename || '未命名檔案';

              if (!fileUrl) return '';

              // 確保URL是完整路徑
              if (!fileUrl.startsWith('http') && !fileUrl.startsWith('/')) {
                fileUrl = '/' + fileUrl;
              }

              return `
                              <div class="task-pdf-item" style="position:relative;background:var(--panel-2);border-radius:8px;padding:12px;box-shadow:0 2px 8px rgba(0,0,0,0.2)">
                                <div style="position:relative;margin-bottom:8px">
                                  <iframe src="${fileUrl}" class="task-pdf-display" style="width:100%;height:500px;border-radius:8px;border:none" frameborder="0"></iframe>
                                  <button class="btn-pdf-expand" data-pdf-url="${fileUrl}" style="position:absolute;bottom:12px;right:12px;background:rgba(0,0,0,0.7);border:none;color:#fff;padding:8px 12px;border-radius:6px;cursor:pointer;font-size:14px;z-index:10;display:flex;align-items:center;gap:6px;opacity:0;transition:opacity 0.2s" title="放大查看">🔍 放大</button>
              </div>
                                <div style="display:flex;justify-content:space-between;align-items:center">
                                  <span style="color:var(--text);font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;margin-right:8px">${fileName}</span>
                                  <button class="btn-remove-pdf" data-file="${file.id || file.url}" style="background:rgba(239,68,68,0.9);border:none;color:#fff;width:24px;height:24px;border-radius:50%;cursor:pointer;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 4px rgba(0,0,0,0.2)" title="刪除PDF">×</button>
            </div>
          </div>
                            `;
            }).join('')}
                        </div>
                      `;
          }
          return '';
        })()}
                </div>
                <div class="pdf-upload-area" style="display:flex;gap:8px;align-items:center;margin-top:12px">
                  <input type="file" id="pdfUpload" accept=".pdf,application/pdf" style="display:none">
                  <button type="button" class="btn ghost" id="btnUploadPdf">📄 上傳PDF</button>
                </div>
              </div>
            </div>
          </div>
          <div style="margin-top:24px;padding-top:24px;border-top:var(--border);display:flex;gap:12px;align-items:center">
            <button class="btn danger" id="btnDeleteTask">刪除任務</button>
            <button class="btn primary" id="btnSaveTask">儲存任務</button>
          </div>
        </div>
      </div>
      `;

      // 初始化檔案列表
      if (!task.files) task.files = [];

      // 確保內容區域正確顯示 HTML（包括圖片）
      setTimeout(() => {
        const contentEl = elApp.querySelector('[data-field="content"]');
        if (contentEl && task.content) {
          // 如果 task.content 是 HTML 字符串，直接設置 innerHTML
          if (typeof task.content === 'string' && (task.content.includes('<img') || task.content.includes('<div'))) {
            contentEl.innerHTML = task.content;
          }
        }
      }, 100);

      // 初始化氣泡選擇
      const ownerContainer = elApp.querySelector('[data-field="owner"]');
      const owners = Array.isArray(task.owner) ? task.owner : (task.owner ? [task.owner] : []);
      renderBubbleSelect(ownerContainer, 'owner', owners);

      const execContainer = elApp.querySelector('[data-field="executors"]');
      renderBubbleSelect(execContainer, 'executors', task.executors || []);

      // 內聯編輯：自動儲存
      let saveTimer;
      const saveField = (field, value) => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          if (field === 'executors') {
            task.executors = value.split(',').map(s => s.trim()).filter(Boolean);
          } else if (field === 'owner') {
            task.owner = value.split(',').map(s => s.trim()).filter(Boolean);
          } else if (field === 'progress') {
            task.progress = parseInt(value) || 0;
          } else if (field === 'content') {
            task.content = value || '';
          } else if (field === 'dueDate' || field === 'completeDate') {
            const dateVal = value || null;
            task[field] = dateVal;
            // 完成日期邏輯：填寫完成日期時自動切換狀態和完成度
            if (field === 'completeDate' && dateVal) {
              task.status = '完成';
              task.progress = 100;
              // 更新UI
              const statusSel = elApp.querySelector('[data-field="status"]');
              const progressEl = elApp.querySelector('[data-field="progress"]');
              if (statusSel) statusSel.value = '完成';
              if (progressEl) progressEl.textContent = '100';
            } else if (field === 'completeDate' && !dateVal && task.status === '完成') {
              // 清除完成日期時，如果狀態是完成，改為進行中
              task.status = '進行中';
              const statusSel = elApp.querySelector('[data-field="status"]');
              if (statusSel) statusSel.value = '進行中';
            }
          } else {
            task[field] = value;
          }
          saveTasks(TASKS);
          notify('已自動儲存');
        }, 800);
      };

      // 處理下拉選單和輸入框
      elApp.querySelectorAll('select[data-field], input[data-field]').forEach(el => {
        const field = el.getAttribute('data-field');
        el.addEventListener('change', () => {
          saveField(field, el.value);
        });
      });

      // 初始化任務詳情頁面的日期選擇器
      elApp.querySelectorAll('input[type="date"][data-field]').forEach(dateInput => {
        // 如果已經轉換過，跳過
        if (dateInput.parentElement && dateInput.parentElement.classList.contains('date-picker')) {
          return;
        }

        // 轉換為日期選擇器
        const picker = createDatePicker(dateInput);
        dateInput.style.display = 'none';
        dateInput.style.position = 'absolute';
        dateInput.style.opacity = '0';
        dateInput.style.pointerEvents = 'none';
        dateInput.parentElement.insertBefore(picker, dateInput);

        // 同步日期選擇器的值到原始輸入框
        const pickerInput = picker.querySelector('.date-picker-input input');
        if (pickerInput) {
          const value = dateInput.value || '';
          // formatDateDisplay 是在 createDatePicker 內部定義的，這裡需要重新獲取
          // 或者直接使用日期選擇器內部已經設置好的值
          // 日期選擇器已經在 createDatePicker 中初始化了值

          // 監聽原始輸入框的 change 事件，確保值同步
          dateInput.addEventListener('change', () => {
            const newValue = dateInput.value || '';
            if (pickerInput && picker._renderCalendar) {
              // 更新日期選擇器的顯示值
              const formatDateDisplay = (dateStr) => {
                if (!dateStr) return '';
                try {
                  const d = new Date(dateStr + 'T00:00:00');
                  if (isNaN(d.getTime())) return '';
                  const year = d.getFullYear();
                  const month = String(d.getMonth() + 1).padStart(2, '0');
                  const day = String(d.getDate()).padStart(2, '0');
                  return `${year}/${month}/${day}`;
                } catch (e) {
                  return '';
                }
              };
              pickerInput.value = newValue ? formatDateDisplay(newValue) : '';
            }
          });
        }

        // 為對應的標籤添加點擊事件，點擊標籤時打開日曆
        const field = dateInput.getAttribute('data-field');
        // 找到對應的標籤（標籤在輸入框之前）
        const propRow = dateInput.closest('.prop-row');
        const label = propRow ? propRow.querySelector('.prop-label') : null;
        if (label && picker && picker._openCalendar) {
          label.style.cursor = 'pointer';
          label.addEventListener('click', (e) => {
            e.stopPropagation();
            picker._openCalendar();
          });
        }
      });


      // 處理氣泡選擇（新版本使用 change 事件）
      elApp.querySelectorAll('.bubble-select[data-field]').forEach(container => {
        container.addEventListener('change', (e) => {
          const field = container.getAttribute('data-field');
          const values = e.detail.values;
          if (field === 'owner') {
            task.owner = values;
          } else if (field === 'executors') {
            task.executors = values;
          }
          saveTasks(TASKS);
          notify('已自動儲存');
        });
      });

      // 處理可編輯內容
      elApp.querySelectorAll('[contenteditable="true"]').forEach(el => {
        const field = el.getAttribute('data-field');
        if (field === 'owner' || field === 'executors') return; // 跳過，因為已經用氣泡選擇處理

        let saveTimer;

        // 處理任務內頁內容區域的圖片貼上（自動縮小）
        if (field === 'content') {
          el.addEventListener('paste', async (e) => {
            const items = e.clipboardData.items;
            for (let i = 0; i < items.length; i++) {
              if (items[i].type.indexOf('image') !== -1) {
                e.preventDefault();
                const blob = items[i].getAsFile();
                const file = new File([blob], `paste-${Date.now()}.png`, { type: 'image/png' });

                try {
                  notify('正在處理圖片...');

                  // 先縮小圖片
                  resizeImage(file, 300, async (resizedBlob) => {
                    try {
                      // 上傳縮小後的圖片
                      notify('正在上傳圖片...');
                      const result = await uploadFile(resizedBlob);

                      if (result && result.success) {
                        // 確保 URL 是完整的路徑
                        let imageUrl = result.url;
                        if (!imageUrl.startsWith('http') && !imageUrl.startsWith('/')) {
                          imageUrl = '/' + imageUrl;
                        }

                        // 插入圖片到內容區域
                        insertImage(el, imageUrl);

                        // 立即保存內容（包含圖片HTML）
                        task.content = el.innerHTML || '';
                        await saveTasks(TASKS);

                        // 觸發 input 事件
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        notify('圖片上傳成功');
                      }
                    } catch (error) {
                      console.error('圖片上傳失敗:', error);
                      notify('圖片上傳失敗');
                    }
                  });
                } catch (error) {
                  console.error('圖片處理失敗:', error);
                  notify('圖片處理失敗');
                }
                break;
              }
            }
          });
        }

        el.addEventListener('input', () => {
          clearTimeout(saveTimer);
          saveTimer = setTimeout(() => {
            const val = field === 'content' ? el.innerHTML : el.textContent.trim();
            saveField(field, val);
          }, 500);
        });

        el.addEventListener('blur', () => {
          clearTimeout(saveTimer);
          const val = field === 'content' ? el.innerHTML : el.textContent.trim();
          saveField(field, val);
        });

        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && field !== 'notes' && field !== 'title' && field !== 'content') {
            e.preventDefault();
            el.blur();
          }
        });
      });

      // 縮小圖片函數
      function resizeImage(file, maxWidth, callback) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;

            // 如果圖片寬度大於最大寬度，則縮小
            if (width > maxWidth) {
              const scale = maxWidth / width;
              width = maxWidth;
              height = img.height * scale;
            }

            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // 將 canvas 轉換為 blob
            canvas.toBlob((blob) => {
              if (blob) {
                callback(blob);
              } else {
                // 如果 toBlob 失敗，使用原始文件
                callback(file);
              }
            }, 'image/png', 0.9);
          };
          img.onerror = () => {
            // 如果圖片載入失敗，使用原始文件
            callback(file);
          };
          img.src = e.target.result;
        };
        reader.onerror = () => {
          // 如果讀取失敗，使用原始文件
          callback(file);
        };
        reader.readAsDataURL(file);
      }

      // 插入圖片到內容區域
      function insertImage(contentEl, imageUrl) {
        const selection = window.getSelection();
        const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

        const img = document.createElement('img');
        img.src = imageUrl;
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        img.style.display = 'block';
        img.style.margin = '16px 0';
        img.style.borderRadius = '8px';
        img.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
        img.alt = '貼上的圖片';
        img.className = 'content-image-clickable'; // 添加類名以便識別可點擊的圖片

        if (range && contentEl.contains(range.commonAncestorContainer)) {
          range.deleteContents();
          range.insertNode(img);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        } else {
          contentEl.appendChild(img);
        }
      }

      // PDF上傳功能
      const btnUploadPdf = document.getElementById('btnUploadPdf');
      const pdfUploadInput = document.getElementById('pdfUpload');

      if (btnUploadPdf && pdfUploadInput) {
        btnUploadPdf.addEventListener('click', () => {
          pdfUploadInput.click();
        });

        pdfUploadInput.addEventListener('change', async (e) => {
          const files = Array.from(e.target.files);
          for (const file of files) {
            // 檢查是否為PDF
            if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
              notify('請選擇PDF文件');
              continue;
            }

            try {
              notify('正在上傳PDF...');
              const result = await uploadFile(file);
              if (result && result.success) {
                if (!task.files) task.files = [];
                // 確保URL是完整路徑
                let fileUrl = result.url;
                if (!fileUrl.startsWith('http') && !fileUrl.startsWith('/')) {
                  fileUrl = '/' + fileUrl;
                }
                task.files.push({
                  id: 'f_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                  name: result.filename,
                  filename: result.filename,
                  url: fileUrl,
                  size: result.size,
                  type: result.mimetype || file.type || 'application/pdf'
                });
                await persistTask(task);
                notify('PDF上傳成功');
                renderTaskDetail(id); // 重新渲染以顯示新PDF
              }
            } catch (error) {
              console.error('PDF上傳失敗:', error);
              notify('PDF上傳失敗');
            }
          }
          e.target.value = ''; // 清空選擇
        });
      }

      // PDF放大模式
      elApp.querySelectorAll('.btn-pdf-expand').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const pdfUrl = btn.getAttribute('data-pdf-url');
          showPdfModal(pdfUrl);
        });
      });

      // PDF懸停顯示放大按鈕
      elApp.querySelectorAll('.task-pdf-item').forEach(item => {
        item.addEventListener('mouseenter', () => {
          const expandBtn = item.querySelector('.btn-pdf-expand');
          if (expandBtn) expandBtn.style.opacity = '1';
        });
        item.addEventListener('mouseleave', () => {
          const expandBtn = item.querySelector('.btn-pdf-expand');
          if (expandBtn) expandBtn.style.opacity = '0';
        });
      });

      // 刪除PDF
      elApp.querySelectorAll('.btn-remove-pdf').forEach(btn => {
        btn.addEventListener('click', async () => {
          const fileId = btn.getAttribute('data-file');
          task.files = task.files.filter(f => {
            if (f.id && f.id === fileId) return false;
            if (f.url && f.url === fileId) return false;
            return true;
          });
          await persistTask(task);
          renderTaskDetail(id);
          notify('PDF已刪除');
        });
      });

      // 刪除按鈕
      const btnDeleteTask = document.getElementById('btnDeleteTask');
      if (btnDeleteTask) {
        btnDeleteTask.addEventListener('click', () => {
          if (confirm('確定要刪除這個任務嗎？')) {
            const idx = TASKS.findIndex(t => t.id === id);
            if (idx > -1) {
              removeTask(id).then(() => {
                notify('已刪除');
                location.hash = '#all';
              }).catch(err => notify(err?.data?.error || '刪除失敗，請重新整理'));
            }
          }
        });
      }

      // 儲存按鈕
      const btnSaveTask = document.getElementById('btnSaveTask');
      if (btnSaveTask) {
        btnSaveTask.addEventListener('click', async () => {
          // 收集所有表單數據
          const titleEl = elApp.querySelector('[data-field="title"]');
          const statusEl = elApp.querySelector('[data-field="status"]');
          const priorityEl = elApp.querySelector('[data-field="priority"]');
          const progressEl = elApp.querySelector('[data-field="progress"]');
          const notesEl = elApp.querySelector('[data-field="notes"]');
          const contentEl = elApp.querySelector('[data-field="content"]');
          const dueDateEl = elApp.querySelector('[data-field="dueDate"]');
          const completeDateEl = elApp.querySelector('[data-field="completeDate"]');
          const ownerContainer = elApp.querySelector('[data-field="owner"]');
          const execContainer = elApp.querySelector('[data-field="executors"]');

          // 更新任務對象
          if (titleEl) task.title = titleEl.textContent.trim() || task.title;
          if (statusEl) task.status = statusEl.value || task.status;
          if (priorityEl) task.priority = priorityEl.value || task.priority;
          if (progressEl) task.progress = parseInt(progressEl.textContent.trim()) || 0;
          if (notesEl) task.notes = notesEl.textContent.trim() || '';
          if (contentEl) task.content = contentEl.innerHTML || '';
          if (dueDateEl) task.dueDate = dueDateEl.value || null;
          if (completeDateEl) task.completeDate = completeDateEl.value || null;

          // 獲取負責人和執行人
          if (ownerContainer) {
            const owners = getBubbleSelectValues(ownerContainer);
            task.owner = owners;
          }
          if (execContainer) {
            const executors = getBubbleSelectValues(execContainer);
            task.executors = executors;
          }

          // 保存到服務器
          await persistTask(task);
          notify('已儲存任務');

          // 返回列表
          location.hash = '#all';
        });
      }
    }

    // 工具
    function notify(msg) {
      if (!toast) return; toast.textContent = msg; toast.classList.add('show');
      clearTimeout(notify._t); notify._t = setTimeout(() => toast.classList.remove('show'), 1800);
    }

    // 主題切換
    function applyTheme(theme) {
      document.body.classList.toggle('light-mode', theme === 'light');
      if (themeToggle) {
        themeToggle.textContent = theme === 'light' ? '🌙' : '☀️';
      }
      localStorage.setItem(LS_THEME_KEY, theme);
    }

    // 初始化主題
    (function initTheme() {
      const savedTheme = localStorage.getItem(LS_THEME_KEY) || 'dark';
      applyTheme(savedTheme);
    })();

    // 主題切換事件
    if (themeToggle) {
      themeToggle.addEventListener('click', () => {
        const currentTheme = document.body.classList.contains('light-mode') ? 'light' : 'dark';
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        applyTheme(newTheme);
      });
    }

    // 登入驗證
    const AUTH_CREDENTIALS = {
      username: 'admin',
      password: 'admin'
    };

    function checkAuth() {
      return localStorage.getItem(LS_AUTH_KEY) === 'authenticated';
    }

    async function showApp() {
      if (checkAuth()) {
        if (loginModal) loginModal.classList.remove('open');
        if (appHeader) appHeader.style.display = 'flex';
        if (elApp) elApp.style.display = 'block';
        if (!location.hash) location.hash = '#all';
        // 確保數據已載入後再渲染
        await loadTasks();
        await loadUsers();
        await loadNotes();
        render();
      } else {
        if (loginModal) loginModal.classList.add('open');
        if (appHeader) appHeader.style.display = 'none';
        if (elApp) elApp.style.display = 'none';
      }
    }

    // 登入處理函數
    function handleLogin() {
      if (!loginForm) {
        console.error('登入表單不存在');
        return;
      }
      const formData = new FormData(loginForm);
      const username = formData.get('username');
      const password = formData.get('password');

      console.log('嘗試登入:', username);

      if (username === AUTH_CREDENTIALS.username && password === AUTH_CREDENTIALS.password) {
        localStorage.setItem(LS_AUTH_KEY, 'authenticated');
        if (loginError) loginError.style.display = 'none';
        showApp();
      } else {
        if (loginError) loginError.style.display = 'block';
        const pwdInput = loginForm.querySelector('[name="password"]');
        if (pwdInput) pwdInput.value = '';
        console.log('登入失敗');
      }
    }

    // 登入按鈕事件
    if (btnLogin) {
      btnLogin.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('登入按鈕被點擊');
        handleLogin();
      });
      // 確保按鈕可點擊
      btnLogin.style.pointerEvents = 'auto';
      btnLogin.style.cursor = 'pointer';
    } else {
      console.error('找不到登入按鈕');
    }

    // 登入表單 Enter 鍵
    if (loginForm) {
      loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('表單提交');
        handleLogin();
      });
    } else {
      console.error('找不到登入表單');
    }

    // 登出處理
    if (btnLogout) {
      btnLogout.addEventListener('click', () => {
        localStorage.removeItem(LS_AUTH_KEY);
        showApp();
        if (loginForm) loginForm.reset();
      });
    }

    // 初始化：檢查登入狀態
    showApp();

    // 初始化拖動排序
    initDragSort();

    // 使用事件委派處理導航鏈接點擊（這樣即使鏈接是動態添加的也能工作）
    document.addEventListener('click', (e) => {
      // 處理帶有 data-route 屬性的導航鏈接
      const routeLink = e.target.closest('[data-route]');
      if (routeLink && routeLink.hasAttribute('href')) {
        e.preventDefault();
        const href = routeLink.getAttribute('href');
        if (href && href.startsWith('#')) {
          location.hash = href;
          // hashchange 事件會自動觸發 render，所以這裡不需要手動調用
          return;
        }
      }

      // 處理任務詳情頁面中的返回鏈接（href="#all"）
      const backLink = e.target.closest('a[href="#all"]');
      if (backLink && backLink.getAttribute('href') === '#all') {
        e.preventDefault();
        location.hash = '#all';
        // hashchange 事件會自動觸發 render
        return;
      }
    });

    window.addEventListener('hashchange', () => {
      if (checkAuth()) render();
    });

    // 初始渲染
    if (checkAuth()) {
      render();
    }
  }

  // 等待 DOM 載入完成後初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();


