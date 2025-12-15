// 假資料：依照提供截圖中的人名/欄位，示意可運作
const USERS = [
  { id: 'user1', name: 'User 1' }
];

// 狀態：待辦、進行中、完成；優先級：高/中/低
// 完整度以 0-100 表示
const TASKS = [

];

// 便利貼數據
const NOTES = [];

// 小工具
const byName = name => USERS.find(u => u.name === name);
const fmtDate = s => s ? new Date(s).toISOString().slice(0, 10) : '';


