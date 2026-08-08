# Bag Region Compositor — 完整程式碼解說與操作流程

> 本文件詳細說明 `try_mask_AB_image` 專案的程式碼結構、運作原理，以及「上傳包包 → 繪製區域 → 上傳參考圖 → 生成 Apple → 生成 Bear → 下載」的完整端到端流程。

---

## 目錄

1. [專案總覽（Summary）](#1-專案總覽summary)
2. [檔案結構](#2-檔案結構)
3. [三層架構與資料流](#3-三層架構與資料流)
4. [逐檔案程式碼解說](#4-逐檔案程式碼解說)
5. [核心資料結構：`state`](#5-核心資料結構state)
6. [Wizard 階段狀態機](#6-wizard-階段狀態機)
7. [完整操作流程（Step-by-Step）](#7-完整操作流程step-by-step)
   - 7A. 上傳包包圖 + 繪製 Path / Region
   - 7B. 上傳 Apple 參考圖 + 生成 Apple
   - 7C. 上傳 Bear、繪製 B 區 + 生成 Bear（第二次生成）
8. [關鍵函式逐一拆解](#8-關鍵函式逐一拆解)
9. [API 請求的細節（FormData 組成）](#9-api-請求的細節formdata-組成)
10. [Mask 的兩種意義與轉換](#10-mask-的兩種意義與轉換)
11. [CORS / 跨域與 Proxy 的角色](#11-cors--跨域與-proxy-的角色)
12. [錯誤處理與除錯](#12-錯誤處理與除錯)
13. [如何在本地跑起來](#13-如何在本地跑起來)

---

## 1. 專案總覽（Summary）

**Bag Region Compositor** 是一個「個人一次性單機工具」，目的是在包包（bag）照片上，**序列化（sequential）執行兩次 GPT Image 2 編輯呼叫**：

```
第 1 次（Apple 步驟）：bag + apple 參考圖 → 把 apple 合成進「紅色 A 區」
第 2 次（Bear 步驟）：(bag+apple 結果) + bear 參考圖 → 把 bear 合成進「藍色 B 區」
```

最終下載一張「包包上同時有 apple 與 bear」的合成圖。

### 核心技術選擇（很重要）

此專案採用 **「Option B：貼上後再 blend 接縫」** 流程，而**不是**直接叫模型「把 apple 放到 A 區」。原因是：gpt-image-2 的 mask 只是「提示式引導（prompt-based guidance）」，**並不能精準決定物件位置**——若直接請模型放置，它會把 apple 丟到任意位置。

因此實際做法是：
1. 程式自己算出紅色筆觸的 bounding box。
2. **程式先把 apple 貼到 bbox 中央**（`drawImage`），產出 base 圖。
3. 產出一個 **seam mask（接縫遮罩）**：只有貼上蘋果的「邊緣環帶」是透明（可編輯），蘋果內部與其他區域都不透明（不可動）。
4. 送 API：base 圖同時當 `image` 與 ref，prompt 只要求「blend the seam, do not relocate」。
5. 模型只負責把接縫羽化，讓 apple 看起來像印/繡在包包上——位置完全不變。

---

## 2. 檔案結構

```
try_mask_AB_image/
├── bag-compositor.html   ← 唯一前端交付物（HTML + CSS + JS 全包在內）
├── proxy.js              ← 本地 dev server + 反向代理（Express + http-proxy-middleware）
├── worker.js             ← Cloudflare Worker 版的代理（替代方案，免本機起 server）
├── package.json          ← 只有 proxy 用到的 3 個 deps：express / cors / http-proxy-middleware
├── local.key             ← gitignored；放 OpenAI 相容 API key，頁面開啟時自動讀取
├── design-brief.md       ← 設計簡報（v1.0，2026-08-05）
├── prd.md                ← 產品需求文件（功能清單、UI 規格、驗收測試）
├── .gitignore            ← 忽略 local.key、node_modules、debug 暫存檔
└── CODE_GUIDE.md         ← 本文件
```

| 檔案 | 角色 | 是否含敏感資訊 |
|------|------|----------------|
| [bag-compositor.html](bag-compositor.html) | 前端 UI + 全部邏輯 | 否 |
| [proxy.js](proxy.js) | 本地代理（推薦用這個） | 否 |
| [worker.js](worker.js) | Cloudflare Worker 代理（替代） | 否 |
| [local.key](.) | 你的 API key | ✅ 已 gitignore，不上 GitHub |

---

## 3. 三層架構與資料流

```
┌──────────────────────────────┐        ┌─────────────┐        ┌──────────────────────┐
│  bag-compositor.html         │        │  proxy.js   │        │  https://www.        │
│  (瀏覽器，跑 JS)             │  ───→  │  localhost  │  ───→  │  xiangsuai.cn/v1/    │
│                              │  /api/ │  :3001      │        │  images/edits        │
│  - Canvas 繪圖               │        │  (Express + │        │  (GPT Image 2 端點)  │
│  - Mask 產生                 │  /files│   proxy MW) │  ───→  │  *.closeai.fans      │
│  - callEditsApi()            │        │             │        │  (回傳的圖檔 host)    │
└──────────────────────────────┘        └─────────────┘        └──────────────────────┘
        ↑                                                        │
        │  data URL（b64 或 proxy 過的圖）←───────────────────────┘
        └────────────────────────────┘
```

### 為什麼需要 proxy？

1. **CORS**：瀏覽器直接 fetch `https://www.xiangsuai.cn/...` 會被跨域擋掉。proxy.js 在 server-to-server 層級轉發，加上 `Access-Control-Allow-Origin` header，瀏覽器就視為同源。
2. **圖片 taint 防護**：API 回傳的圖片 host 常是 `files.closeai.fans`。若瀏覽器直接 `<img src=跨域>`，再 `drawImage` 到 canvas 後 `.toBlob()` 會丟「Tainted canvases may not be exported」。所以回傳的 URL 也走 proxy → 轉成 data URL → 永遠同源、永遠可 export。

---

## 4. 逐檔案程式碼解說

### 4.1 [bag-compositor.html](bag-compositor.html)（前端核心，1465 行）

這是一個「單檔 HTML」，結構：

| 行數區間 | 內容 |
|----------|------|
| L7–233 | `<style>`：深色主題 CSS（#0f1115 背景、三欄 grid、按鈕/畫布/預覽框樣式） |
| L235–362 | `<body>` DOM：左 sidebar（API key、proxy 切換、上傳、區域按鈕、筆刷、prompts、generate 按鈕）+ 中央 canvas（main + mask 雙層）+ 右 rightbar（預覽、版本縮圖、最終結果） |
| L364–1465 | `<script type="module">`：所有 JS 邏輯 |

#### UI 三欄佈局（[L44–52](bag-compositor.html#L44-L52)）

```css
.main {
  display: grid;
  grid-template-columns: 280px 1fr 300px; /* 左工具列 / 中畫布 / 右預覽 */
}
```

#### 雙層 Canvas（[L328–332](bag-compositor.html#L328-L332)）

```html
<canvas id="mainCanvas"></canvas>   <!-- 顯示 bag / 合成結果 -->
<canvas id="maskCanvas"></canvas>   <!-- 透明疊加層，畫紅/藍筆觸，pointer-events:none -->
```

`#maskCanvas` 用 `position:absolute` 蓋在 `#mainCanvas` 上，`opacity:0.45`，且 `pointer-events:none`——**所有滑鼠事件綁在 mainCanvas，但畫在 maskCanvas**。

### 4.2 [proxy.js](proxy.js)（本地代理，83 行）

Express server，監聽 `:3001`，負責兩條代理路由：

```js
// L38–52：/api/* → https://www.xiangsuai.cn/*   （API 呼叫）
app.use('/api', createProxyMiddleware({
  target: 'https://www.xiangsuai.cn',
  changeOrigin: true,
  pathRewrite: { '^/api': '' },          // /api/v1/images/edits → /v1/images/edits
  onProxyReq: (proxyReq, req) => {
    const auth = req.headers.authorization;
    if (auth) proxyReq.setHeader('Authorization', auth); // 透傳 Bearer key
  },
}));

// L60–77：/files/* → https://files.closeai.fans/*  （下載回傳的圖）
app.use('/files', createProxyMiddleware({
  target: 'https://files.closeai.fans',
  changeOrigin: true,
  onProxyReq: (proxyReq, req) => {
    const cleanPath = req.url.replace(/^\/files/, ''); // 去掉 /files 前綴
    proxyReq.path = cleanPath;
    proxyReq.setHeader('Referer', 'https://www.xiangsuai.cn/'); // 假裝來源
    proxyReq.setHeader('User-Agent', 'Mozilla/5.0 ...');
  },
}));
```

啟動：`node proxy.js` → 開 `http://localhost:3001/bag-compositor.html`。

### 4.3 [worker.js](worker.js)（Cloudflare Worker 代理，72 行）

功能等同 proxy.js 但跑在 Cloudflare 邊緣，免本機開 server。只代理 `/api/v1/images/edits`：

```js
// L20–38：把 /api 拿掉，組成 https://www.xiangsuai.cn/v1/images/edits
const targetPath = url.pathname.replace('/api', '') + url.search;
const targetUrl = `https://www.xiangsuai.cn${targetPath}`;
const response = await fetch(targetUrl, { method, headers, body, cf: { cacheTtl: 0 } });
```

> ⚠️ worker.js **沒有代理 `/files/*`**——所以「Worker 模式」下若 API 回傳的是 `files.closeai.fans` 的 URL（而不是 `b64_json`），`urlToDataUrl()` 仍會嘗試 fetch 同源 `/files/...`，但 Worker 沒那條路由會 404。**建議用 Local 模式**。

### 4.4 [package.json](package.json)

```json
{
  "type": "module",
  "main": "proxy.js",
  "scripts": { "proxy": "node proxy.js" },
  "dependencies": { "cors": "^2.8.6", "express": "^5.2.1", "http-proxy-middleware": "^4.2.0" }
}
```

只有 3 個 dep，全都是 proxy.js 在用。前端 HTML 不需要任何 npm 套件。

---

## 5. 核心資料結構：`state`

整個 app 用單一 `state` 物件管理（[L384–412](bag-compositor.html#L384-L412)）：

```js
const state = {
  bagImg, appleImg, bearImg,        // HTMLImageElement
  mainCanvas, maskCanvas,           // 兩個 canvas
  mainCtx, maskCtx,                 // 對應的 2D context
  region: 'a',                      // 'a' | 'b' | 'erase' —— 當前筆刷模式
  brushSize: 24,
  isDrawing, lastX, lastY,          // 繪圖中的暫存
  history: [], historyIndex: -1,    // Undo/Redo 用 ImageData[]
  maxHistory: 40,
  versions: { apple: [], bear: [] },// 每步最多保留 3 個歷史結果
  maxVersions: 3,
  appleResultUrl, bearResultUrl,    // 各步產出的 data URL
  phase: 0,                         // 0=init → 4=done（見 §6）
};
```

---

## 6. Wizard 階段狀態機

`state.phase` 驅動整個 wizard（[PRD §3.4](prd.md)）：

| phase | 意義 | 觸發 | UI 變化 |
|-------|------|------|---------|
| 0 | 初始 | 載入 | B 區按鈕 disabled、bear 上傳 disabled、Generate Bear/Download 隱藏 |
| 1 | Apple 就緒 | `bagImg+bearImg+maskHasRegion('a')` | Generate Apple 亮起 |
| 2 | Apple 完成 | 第 1 次 API 成功 | **解鎖 B 區繪製**、bear 上傳 enabled、顯示 Generate Bear、自動切到 B 筆刷 |
| 3 | Bear 就緒 | `bearImg+maskHasRegion('b')` | Generate Bear 亮起 |
| 4 | Done | 第 2 次 API 成功 | 顯示 Download Final |

按鈕啟停邏輯集中在 [updateButtons()](bag-compositor.html#L462-L478)：

```js
els.generateAppleBtn.disabled = !(hasBag && hasApple && hasAMask);
els.generateBearBtn.disabled   = !(appleDone && hasBear && hasBMask);
els.downloadBtn.disabled       = !(state.phase >= 4);
```

---

## 7. 完整操作流程（Step-by-Step）

> ⚠️ 中文錯別字說明：原作者文件中常把「path（路徑）」寫成「patn」、「patch」等，本質上都指「在 maskCanvas 上畫出來的區域/筆觸」，亦即 **region**。

### 7A. 上傳包包圖 + 繪製 Path / Region

**目標**：載入 bag 照片，在畫布上用紅色畫出「apple 要放的位置」。

#### Step 1：上傳 Bag

1. 點左側 [Upload Bag Image](bag-compositor.html#L265) → 觸發 [`els.bagInput.change`](bag-compositor.html#L656-L665)
2. [`loadImageToElement(file, cb)`](bag-compositor.html#L533-L544)：用 `FileReader.readAsDataURL` 把檔案轉成 **data URL**（關鍵：data URL 永遠同源，之後 canvas 不會被 taint）。
3. [`setupCanvases(img)`](bag-compositor.html#L687-L709)：
   - 若圖 > 900px，等比縮到 maxDim=900。
   - **mainCanvas 與 maskCanvas 設成同尺寸**（`els.mainCanvas.width = els.maskCanvas.width = w`）。
   - mainCtx 畫上 bag，maskCtx 清空。
   - `pushHistory()` 存第 0 筆快照。
4. [`resetStateForNewBag()`](bag-compositor.html#L711-L738)：重置 region='a'、phase=0、清版本列表、隱藏 bear 相關 UI。

```js
els.bagInput.addEventListener('change', e => {
  const file = e.target.files[0];
  loadImageToElement(file, img => {
    state.bagImg = img;
    setupCanvases(img);          // 建 canvas
    resetStateForNewBag();
    updateButtons();
  });
});
```

#### Step 2：選 Region A、調筆刷、畫筆觸

1. 預設就是 A（紅），對應 [btnA](bag-compositor.html#L272)。
2. 拉 [Brush Thickness](bag-compositor.html#L281-L283) slider → 更新 `state.brushSize`（4–80px）。
3. 滑鼠按下 → [`mousedown`](bag-compositor.html#L814-L821)：`getCanvasPos(e)` 把 client 座標轉成 canvas 像素座標（考慮 CSS 顯示縮放），`drawDot()`。
4. 滑鼠移動 → [`mousemove`](bag-compositor.html#L823-L829)：`drawStroke()` 連線。
5. 滑鼠放開 → [`endDrawing`](bag-compositor.html#L831-L837)：`pushHistory()` 存快照。

#### `drawStroke` 的關鍵（[L777–797](bag-compositor.html#L777-L797)）

```js
if (state.region === 'erase') {
  state.maskCtx.globalCompositeOperation = 'destination-out'; // 擦
  state.maskCtx.strokeStyle = 'rgba(0,0,0,1)';
} else {
  state.maskCtx.globalCompositeOperation = 'source-over';      // 畫
  // 「全不透明」的區域色：A=紅 rgb(239,68,68)、B=藍 rgb(59,130,246)
  state.maskCtx.strokeStyle = state.region === 'a' ? 'rgb(239,68,68)' : 'rgb(59,130,246)';
}
state.maskCtx.lineWidth = state.brushSize;
```

> 為什麼顏色要 `rgb()` 全不透明？因為後面 `createEditMask`/`maskHasRegion`/`regionBBox` 都是靠 **RGB 顏色比對** 來分辨「這個像素屬於 A 還是 B 區」。半透明會讓 alpha < 20 被誤判成沒畫。

#### 如何知道某 region 有沒有畫？[`maskHasRegion(region)`](bag-compositor.html#L480-L496)

掃整張 maskCanvas 的 ImageData，找 RGB 接近該區顏色且 alpha>20 的像素。這也是 Generate 按鈕亮起的條件。

---

### 7B. 上傳 Apple 參考圖 + 生成 Apple

**目標**：把 apple 參考圖貼到紅色 A 區、blend 接縫、回寫主畫布。

#### Step 3：上傳 Apple

[`els.appleInput.change`](bag-compositor.html#L667-L675) → `loadImageToElement` → `state.appleImg = img` → 右側 [applePreview](bag-compositor.html#L343) 顯示縮圖。

此時若 `maskHasRegion('a')` 為真 → `updateButtons()` 把 [Generate Apple A](bag-compositor.html#L319) 亮起（phase 進到 1）。

#### Step 4：點 Generate Apple A → 觸發魔術

[`generateAppleBtn.click`](bag-compositor.html#L1296-L1347) 流程：

1. **前哨檢查**：key、bag、apple、A 區有筆觸，缺一就 toast 報錯。
2. [`buildPastedBaseAndSeamMask('a', state.appleImg)`](bag-compositor.html#L597-L654) —— **Option B 的核心**：
   - 算 A 區 bbox（[`regionBBox('a')`](bag-compositor.html#L556-L591)）。
   - 把 apple 等比縮放後貼到 bbox 中央（`fitScale * 0.92`，留點邊距）→ **base canvas = mainCanvas + apple**。
   - 建 **seam mask**：先全白不透明（不可編輯）， carve 出 bbox 透明，再把「縮小後 apple 足跡」蓋回白色 → 淨 editable = bbox 邊緣環帶。
3. [`callEditsApi(baseBlob, baseBlob, maskBlob, promptApple)`](bag-compositor.html#L985-L1210)（注意：ref 传 baseBlob 自己，因為 apple 已經貼上去了）。
4. 拿到 resultUrl（data URL）→ `state.appleResultUrl`、`state.phase = 2`、[`addVersion('apple', url)`](bag-compositor.html#L927-L932)。
5. [`paintResultToMainCanvas(url)`](bag-compositor.html#L1409-L1416)：把合成結果**畫回 mainCanvas**，這樣 Bear 步驟才看得到「apple 已在 bag 上」。
6. **解鎖 B**：`els.btnB.disabled = false`、bear 上傳 enabled、Generate Bear 顯示、`btnB.click()` 自動切到 B 筆刷。

#### Step 4 內部：`callEditsApi` 做了什麼（[L985–1210](bag-compositor.html#L985-L1210)）

```
1. 讀 key，沒有就 throw NO_API_KEY
2. 解碼 maskBlob → 檢查「有沒有透明像素」；全不透明就 alert 警告（API 會 no-op）
3. 比對 base 與 mask 尺寸；不符就把 base resize 成 mask 尺寸
4. ★ Pinning：把 base / ref / mask 一律 resize 成 1024×1024（mask 用 nearest-neighbor）
   原因：上游 gpt-image-2 route 若不鎖 size，會內部 resize 成 ~716×716，
        導致 mask 與 base 錯位、編輯落在錯地方。
5. 組 FormData：model=gpt-image-2, prompt, n=1, response_format=b64_json,
                output_format=png, quality=high, size=1024x1024,
                image(base.png), image(ref.png), mask(mask.png)
6. fetch(getApiEndpoint(), { method, headers:{Authorization:Bearer key}, body: form })
   - endpoint 可為 http://localhost:3001/api/v1/images/edits（Local）
     或 https://your-worker.../api/v1/images/edits（Worker）
7. !res.ok → 解析 error message → throw `HTTP ${status} ...`
8. res.json() → extractImageUrl() 容錯找 b64_json / url / image_url / result_url ...
9. 若拿到的是 URL（非 data:）→ urlToDataUrl() 走 proxy 轉成 data URL（防 taint）
10. 回傳 imgUrl
```

---

### 7C. 上傳 Bear、畫 B 區 + 生成 Bear（第二次生成）

**目標**：在「已含 apple 的 bag」上，用藍色畫出 bear 要放的地方，貼上、blend、下載。

#### Step 5：上傳 Bear

這時 bear 上傳按鈕已解鎖（Apple 完成後）。[`els.bearInput.change`](bag-compositor.html#L677-L685) → `state.bearImg = img` → 右側 bearPreview 顯示。

#### Step 6：切到 B（藍）、畫 B 區

Apple 完成後 `btnB.click()` 已自動切蓝。在 mainCanvas 上畫藍色筆觸標出 bear 位置。`maskHasRegion('b')` 為真後 Generate Bear 亮起（phase 進到 3）。

#### Step 7：點 Generate Bear B → 第二次 API

[`generateBearBtn.click`](bag-compositor.html#L1352-L1404) — **幾乎與 Apple 同流程**，差別：

| 步驟 | Apple 步驟 | Bear 步驟 |
|------|-----------|-----------|
| base canvas | bag（原圖） | **mainCanvas（已含 apple）** |
| ref 圖 | appleImg | bearImg |
| region | 'a' | 'b' |
| prompt | promptApple | promptBear（含 "Preserve the apple... Do not modify"） |
| 結果 | appleResultUrl，phase=2 | bearResultUrl，phase=4，亮 Download |

1. `buildPastedBaseAndSeamMask('b', state.bearImg)`：在「bag+apple」上貼 bear → base，建 B 區 seam mask。
2. `callEditsApi(base, base, mask, promptBear)`。
3. resultUrl → `state.bearResultUrl`、`addVersion('bear', url)`、`paintResultToMainCanvas`。
4. 右側 [resultPreview](bag-compositor.html#L359) 顯示最終圖、[downloadBtn](bag-compositor.html#L321) 亮起、`setStatus('Done — final result ready')`。

#### Step 8：下載

[`downloadBtn.click`](bag-compositor.html#L1419-L1426)：

```js
const a = document.createElement('a');
a.href = state.bearResultUrl;       // data URL
a.download = 'bag-composite.png';
a.click();
```

完成 ✅ —— 你會得到 `bag-composite.png`，上面同時有 apple（在 A 區）與 bear（在 B 區）。

---

## 8. 關鍵函式逐一拆解

### `regionBBox(region)` — [L556–591](bag-compositor.html#L556-L591)
掃 maskCanvas，找符合該區顏色（容差 80）的所有像素，算 min/max x/y → bbox，再 pad 4% 讓模型有接縫空間。回傳 `{x,y,w,h,hitCount}`。

### `buildPastedBaseAndSeamMask(region, refImg)` — [L597–654](bag-compositor.html#L597-L654)
```
1. refBlob → ImageBitmap
2. bbox = regionBBox(region)
3. fitScale = min(bbox.w/ref.w, bbox.h/ref.h) * 0.92
4. baseC = copy(mainCanvas); baseC.drawImage(refBmp, drawX, drawY, drawW, drawH)
5. seamC: 全白 → destination-out 挖 bbox → source-over 蓋回 inner（縮小的 ref 足跡）
   → 淨效果：bbox 邊緣環帶 = 透明（可編輯），其他全白
6. 回傳 { baseBlob, maskBlob, bbox, pasteRect }
```

### `createEditMask(region)` — [L877–911](bag-compositor.html#L877-L911)
> 此函式目前**沒被呼叫**（Option B 改用 seam mask），但保留作参考。
原 mask → API mask 轉換：全白不透明 → 只把「該 region 顏色」像素設成 alpha=0（透明=可編輯）。

### `maskHasRegion(region)` — [L480–496](bag-compositor.html#L480-L496)
boolean：maskCanvas 上有沒有該區顏色像素。Generate 按鈕的門檻。

### `extractImageUrl(obj)` — [L1251–1282](bag-compositor.html#L1251-L1282)
容錯解析回應：找 `b64_json` / `url` / `result_url` / `output_url` / `image_url`（字串或 `{url}`）→ 遞迴進 `data/result/output/images/image/content`。

### `urlToDataUrl(absUrl)` — [L1217–1246](bag-compositor.html#L1217-L1246)
把跨域圖 URL 映射到同源 proxy：
- `files.closeai.fans/x` → `localhost:3001/files/x`
- 其他 → `localhost:3001/api/x`
fetch 成 blob → data URL（防 taint）。

### `paintResultToMainCanvas(dataUrl)` — [L1409–1416](bag-compositor.html#L1409-L1416)
載入 result 圖，清空 mainCtx，drawImage 鋪滿。**這是 Bear 步驟能看到 apple 的關鍵**。

### `loadImageToElement` / `imgSrcToBlob` — [L533–552](bag-compositor.html#L533-L552)
全程 data URL → canvas 永不 taint。`_blobStore` 保留原始 File blob 供 FormData 用。

---

## 9. API 請求的細節（FormData 組成）

最終送出的 FormData（[L1036–1094](bag-compositor.html#L1036-L1094)）：

```
model           = gpt-image-2
prompt          = <promptApple 或 promptBear>
n               = 1
response_format = b64_json
output_format   = png
quality         = high
size            = 1024x1024              ← pinning！
image           = base.png  (1024×1024)  ← base + 已貼上的物件
image           = ref.png   (1024×1024)  ← 與 base 同一張（Option B）
mask            = mask.png  (1024×1024, nearest-neighbor resize) ← seam mask
```

Headers:
```
Authorization: Bearer <key>
Content-Type:  multipart/form-data （FormData 自動帶）
```

Endpoint（二選一）：
- Local：`http://localhost:3001/api/v1/images/edits`
- Worker：`https://<your-worker>.workers.dev/api/v1/images/edits`

---

## 10. Mask 的兩種意義與轉換

這專案有 **三種 mask 概念**，容易混淆：

| 名稱 | 在哪 | 用途 | 顏色規則 |
|------|------|------|----------|
| **maskCanvas（筆觸層）** | 瀏覽器 canvas | 使用者繪製、顯示紅/藍半透明 | A=紅 rgb(239,68,68)、B=藍 rgb(59,130,246) |
| **createEditMask 產物** | （未使用） | OpenAI 標準 mask：全白=不動、透明=編輯 | 純 alpha 邏輯 |
| **seam mask** ★實際用 | 送 API 的 maskBlob | Option B：只有貼上物件邊緣環帶透明，其餘全白 | prevents model 移動物件，只羽化接縫 |

OpenAI `/v1/images/edits` 的 mask 慣例（[L871–876](bag-compositor.html#L871-L876)）：
- **opaque（alpha=255）= 保持不變**
- **transparent（alpha=0）= 可編輯，模型填入**

---

## 11. CORS / 跨域與 Proxy 的角色

### 兩個 Proxy Mode（[L953–978](bag-compositor.html#L953-L978)）

```js
proxyMode = 'local'  → LOCAL_PROXY = 'http://localhost:3001/api/v1/images/edits'
proxyMode = 'worker' → WORKER_PROXY = '<你填的 URL>/api/v1/images/edits'
```

切換按鈕在左側 [Proxy Mode](bag-compositor.html#L254-L261)。

### 為什麼回傳的圖也要過 proxy？

API 可能回 `https://files.closeai.fans/filesystem/xxxx.png`。瀏覽器直接：
```js
img.src = 'https://files.closeai.fans/...';  // 跨域載入
canvas.drawImage(img, ...);
canvas.toBlob();  // ❌ Tainted canvases may not be exported
```
所以 `urlToDataUrl` 走 `localhost:3001/files/...` → server 端 fetch（帶偽造 Referer/UA）→ 回 blob → 轉 data URL → `drawImage(dataURL)` 永遠同源、可 export。

---

## 12. 錯誤處理與除錯

### 5 種邊界（[PRD §4](prd.md)）

| # | 情況 | 訊息 |
|---|------|------|
| E1 | 沒 key | `請先貼上 OpenAI API Key` |
| E2 | 缺圖 | `缺少 Bag 或 Apple 圖片` / `缺少 Bear 圖片` |
| E3 | mask 空 | `請先在 A/B 區畫出至少一個筆觸` |
| E4 | HTTP 4xx | `API 錯誤：HTTP ${status} ...: ${error.message}` |
| E5 | 5xx/網路 | `連線錯誤：${err.message}`（含 endpoint、proxyMode） |

### Mask 全不透明的特殊警告（[L1007–1010](bag-compositor.html#L1007-L1010)）
若 seam mask 沒有透明像素（表示你沒在當前 region 畫筆觸），會 alert：
> ⚠️ Mask 全不透明! ... 檢查: 1) 你有在當前 region 畫嗎? 2) 筆觸顏色對嗎? 3) B 區要等解鎖後藍鈕亮起才能畫。

### Debug 工具
- [Debug: Test Proxy](bag-compositor.html#L322) 按鈕（[L1432–1464](bag-compositor.html#L1432-L1464)）：送一個 1×1 PNG 測試連線。
- `window.__lastMaskB64.base` / `.mask`：最後一次送的 base 與 mask data URL，可在 DevTools 開新分貼上檢查。
- 大量 `console.log('[callEditsApi] ...')`：可在 console 看每一步。

---

## 13. 如何在本地跑起來

### 一次性設定

```bash
# 1. 安裝 proxy 依賴
cd d:/project/try_mask_AB_image
npm install

# 2. 建立 local.key（放你的 API key，gitignored）
echo "sk-your-real-key-here" > local.key
```

### 啟動

```bash
# 終端機 A：起 proxy
npm run proxy          # = node proxy.js
# 看到：🚀 Server + proxy running at http://localhost:3001

# 終端機 B（或直接用瀏覽器開）：
# 開 http://localhost:3001/bag-compositor.html
```

> ❌ 不要用 `file://` 開 HTML——`fetch('./local.key')` 與 CORS fetch 都會壞。

### 操作順序（對應 §7）

1. **API Key 欄**：自動從 `local.key` 讀入（prefix 顯示在 console）。沒有就手動貼。
2. **Proxy Mode**：選 **Local**（預設）。
3. **Upload Bag Image** → 畫布出現包包。
4. 確認選 **A（紅）**、調筆刷→ 在包包上畫出 apple 要放的位置。
5. **Upload Apple** → 右側出現蘋果縮圖。
6. **Generate Apple A** 變藍可按 → 點它 → 等 10–60 秒。
7. 自動切到 **B（藍）** → 在包包上畫出 bear 要放的位置。
8. **Upload Bear** → 右側出現熊縮圖。
9. **Generate Bear B** 變藍可按 → 點它 → 等幾十秒。
10. **Download Final** 亮起 → 點 → 下載 `bag-composite.png`。

---

## 附錄：版本歷史保留

[`addVersion(step, url)`](bag-compositor.html#L927-L932) 把每次成功結果 `unshift` 進 `state.versions[step]`，超過 3 筆 `pop()`。右側 [Apple Versions](bag-compositor.html#L350) / [Bear Versions](bag-compositor.html#L354) 以 80×80 縮圖顯示，最新在最左、舊版疊半透明遮罩。可重跑任一步驟（例如不滿意再按一次 Generate Apple），新版本會插到最左。

---

*文件生成日期：2026-08-08*
*對應程式碼：`d9b2c3a Load API key from local.key on page boot`*
