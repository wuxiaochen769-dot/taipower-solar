// 網站設定：部署 Google Apps Script 後，把網頁應用程式網址貼在 LIVE_URL（結尾是 /exec）
// 留空時，網站會顯示 sample-live.json 的示範資料
window.SOLAR_CONFIG = {
  LIVE_URL: "https://script.google.com/macros/s/AKfycbwa7Z_PlOfS4uqqXm898XVrUzRDxgZkoRXqqwJ0ztqplA7EEIQSN5OjSvZybECaV_3r/exec",                 // 例如 "https://script.google.com/macros/s/xxxxxxxx/exec"
  REFRESH_MINUTES: 5,           // 幾分鐘重新抓一次即時資料
  STALE_MINUTES: 40             // 資料時間超過幾分鐘未更新就顯示提醒
};
