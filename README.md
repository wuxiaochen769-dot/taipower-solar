# 台電太陽能發購電即時資訊（GitHub Pages）

上方：全台地圖＋台電自有發電站位置＋即時發電量
下方：今日發電量組成、資料一致性、台電自有與購電機組

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html`、`style.css`、`app.js` | 網頁本體 |
| `config.js` | **設定即時資料網址 `LIVE_URL`**（部署 Apps Script 後填入） |
| `sites.json` | 台電自有太陽光電發電站 45 站（經緯度為村里或鄉鎮中心點） |
| `sample-live.json` | 示範資料（2026-10-14），`LIVE_URL` 留空時使用 |
| `taiwan-counties.json` | 縣市界圖資（內政部，taiwan-atlas，MIT） |
| `d3.min.js`、`topojson-client.min.js` | 圖表與地圖程式庫（已內建，不依賴外部 CDN） |

## 一、上傳到 GitHub Pages

1. 登入 GitHub → 右上角「+」→ **New repository**
   - 名稱例如 `taipower-solar`，選 **Public**（免費帳號的 Pages 需要公開）
2. 進入新的 repository → **Add file → Upload files**
   - 把本資料夾裡的 **11 個檔案**全部選取後拖進去（沒有子資料夾）→ **Commit changes**
3. **Settings → Pages**
   - Source 選 **Deploy from a branch**，Branch 選 `main`、資料夾 `/ (root)` → Save
4. 約 1–2 分鐘後，網址會是 `https://你的帳號.github.io/taipower-solar/`

此時網站顯示的是示範資料，頁面上方會有提示。

## 二、讓網站顯示即時資料

1. 打開 Google Apps Script 專案（台電太陽能雲端收集）
2. 用電腦上 `C:\solar\網站\cloud\AppsScript_台電太陽能收集_網站版.gs` 的內容**整個取代**原本的程式碼 → 存檔（這個檔案不用上傳到 GitHub）
3. **部署 → 管理部署作業 → 編輯（鉛筆）→ 版本選「新版本」→ 部署**
   - 用「編輯原本的部署」，網址不會改變，電腦端的 `cloud_config.json` 不用改
4. 在瀏覽器打開 `你的網址/exec?view=live`，看到 JSON 資料就成功了
5. 回到 GitHub，編輯 `config.js`，把網址填進 `LIVE_URL`（只填到 `/exec`）→ Commit

之後網頁每 5 分鐘自動更新，資料來自雲端（24 小時運作），不受電腦開關機影響。

## 注意事項

- `?view=live` 只回傳台電已公開的發電資料，**不需要也不會回傳通行碼**。
- `config.js` 只放公開網址，**不要放通行碼**（GitHub 公開 repository 任何人都看得到）。
- 正式對外公開前，請確認院內對外發布網站的規定，並保留頁尾的資料來源與授權說明。
