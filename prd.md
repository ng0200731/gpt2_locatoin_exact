# PRD — Bag Region Compositor

> **版本**：v1.0  
> **基準文件**：[design-brief.md](design-brief.md)  
> **交付物**：單一可執行的 `.html` 檔案  
> **編碼風格**：原生 JS、ES6 module（inline `<script type="module">`）、無建置步驟、無第三方依賴

---

## 1. 產品概述

| 項目 | 說明 |
|------|------|
| 產品名稱 | Bag Region Compositor |
| 目標用戶 | 開發者本人（單機、單次使用） |
| 核心價值 | 以最短路徑完成「包包 A 區→apple、B 區→bear」的序列化 GPT Image 2 合成 |
| 成功指標 | 端到端跑通一次（上傳→畫區→上傳參考→兩段式產生→下載） |

---

## 2. 功能清單（MoSCoW）

| 優先級 | ID | 功能 | 驗收條件（AC） |
|--------|-----|------|----------------|
| **Must** | F1 | 上傳 Bag 圖片 | 選檔後畫布以 1:1 像素顯示（若長寬 > 900px 則等比縮放至 900px 上限），mask canvas 同步建立同尺寸 |
| **Must** | F2 | 區域切換 | 三顆按鈕：A（紅）、B（藍）、Eraser；點選即切換 `state.region`，視覺高亮（`active-a`/`active-b`/`active-erase`） |
| **Must** | F3 | 筆刷繪製 | 滑鼠按下→移動→釋放，在 mask canvas 上以 `lineCap=round`、`lineJoin=round`、`lineWidth=brushSize` 繪製；Eraser 用 `globalCompositeOperation='destination-out'` 清除 |
| **Must** | F4 | 筆刷粗細 | `input[type=range]` 4–80px，即時更新 `state.brushSize` 與顯示數值 |
| **Must** | F5 | Undo / Redo | `ImageData` 堆疊（最多 40 筆），Undo/Redo 按鈕依 `historyIndex` 即時灰亮；Undo 回上一筆、Redo 進下一筆 |
| **Must** | F6 | Clear All | 一鍵 `maskCtx.clearRect` 並 `pushHistory()` 重置堆疊 |
| **Must** | F7 | 上傳 Apple / Bear 參考圖 | 兩組獨立 `<input type=file accept="image/*">`，選檔後在右側 Preview 方框顯示縮圖 |
| **Must** | F8 | Prompt 編輯區（雙區獨立） | 兩個 `<textarea>`：`promptApple`、`promptBear`；各自帶入預設值（見 §5），使用者可獨立編輯 |
| **Must** | F9 | Wizard 生成流程 | 依序：(1) 畫 A + 上傳 Apple → 亮「Generate Apple A」；(2) Apple 成功 → 解鎖 B 區繪製 + 顯示「Generate Bear B」；(3) 畫 B + 上傳 Bear → 亮「Generate Bear B」；(4) Bear 成功 → 顯示「Download」按鈕 |
| **Must** | F10 | Apple 步驟 API 呼叫 | `POST /v1/images/edits`，`model=gpt-image-2`，`image[]=[bag, apple]`，`mask=A區透明`，`prompt=promptApple`，`quality=high`，`size=auto` |
| **Must** | F11 | Bear 步驟 API 呼叫 | 同 F10，但 `base image = Apple 步驟回傳的 b64_json 圖`，`image[]=[base, bear]`，`mask=B區透明`，`prompt=promptBear` |
| **Must** | F11b | Bear prompt 保留指示 | `promptBear` 預設值必含 `Preserve the apple already placed in region A exactly as it is. Do not modify region A.` |
| **Must** | F12 | 版本保留（最多 3 版） | 每次生成成功，將結果 `data URL` `unshift` 進 `state.versions.apple[]` / `state.versions.bear[]`；超過 3 筆 `pop()`；右側 Preview 區以縮圖列表呈現（最新在最左） |
| **Must** | F13 | 最終下載 | 只有 Bear 步驟成功後才出現「Download Final」按鈕；點選觸發 `<a download="bag-composite.png">`，檔名固定 |
| **Must** | F14 | 錯誤處理（5 種） | 見 §4 邊界表；所有錯誤只在狀態列顯示文字，不彈窗、不 console 以外輸出 |
| **Must** | F15 | 零持久化 | 關頁/重整即清空，不寫 localStorage/IndexedDB/cookie |

| **Should** | S1 | Toast 代替狀態列 | 視覺更明確（綠/紅條在畫布上方 3 秒自動消失） | 
| **Could** | C1 | 複製 b64 到剪貼簿 | 右側版本縮圖右鍵選單加「Copy base64」 |
| **Won't** | W1 | 後端 proxy / 隱藏 key | 不做 |
| **Won't** | W2 | 多區域 C/D/... | 不做 |
| **Won't** | W3 | Zoom / Pan 畫布 | 不做 |
| **Won't** | W4 | 批次 / 多組跑法 | 不做 |

---

## 3. UI / UX 規格

### 3.1 佈局結構（三欄固定）

| 欄位 | 寬度 | 內容 |
|------|------|------|
| Left Sidebar | 280px | 所有控制項（F1–F8、雙 prompt、兩顆 Generate、狀態列） |
| Center Canvas | 1fr (flex) | `mainCanvas` + `maskCanvas` 重疊；`max-width: 900px`、`max-height: calc(100vh - 140px)` |
| Right Preview | 300px | Apple / Bear 參考圖、版本縮圖列表（Apple 版本、Bear 版本）、最終結果、下載按鈕 |

### 3.2 色票（沿用 design-brief 既有 CSS 變數）

| 角色 | 變數 | 值 |
|------|------|-----|
| 背景 | `--bg` | `#0f1115` |
| 面板 | `--panel` | `#1a1d24` |
| 邊框 | `--border` | `#2a2f3a` |
| 主色 | `--accent` | `#3b82f6` |
| A 區紅 | `--region-a` | `#ef4444` |
| B 區藍 | `--region-b` | `#3b82f6` |
| 危險 | `--danger` | `#ef4444` |
| 成功 | `--success` | `#22c55e` |

### 3.3 元件規格（關鍵）

| 元件 | 規格 |
|------|------|
| `.region-btn` | `grid-template-columns: 1fr 1fr 1fr`；`active-a` 紅邊+淺紅底、`active-b` 藍邊+淺藍底、`active-erase` 灰邊 |
| `.slider-row` | `display:flex; align-items:center; gap:10px`；`input[type=range]` 寬度佔滿 |
| Prompt textarea | `height: 90px`、`resize: vertical`、字級 0.8rem |
| Preview 方框 | `aspect-ratio: 1`、邊框 `--border`、空態顯示灰字 |
| 版本縮圖列表 | `display:flex; gap:6px; flex-wrap:wrap`；每圖 `width: 80px; height: 80px; object-fit:cover; border-radius:4px`；最新在最左、舊版疊加半透明遮罩標示版次 |

### 3.4 Wizard 啟用狀態機（純灰亮，無步驟條）

| 階段 | 解鎖條件 | 亮起元件 |
|------|----------|----------|
| 0 初始 | — | 上傳 Bag、畫 A、上傳 Apple、`promptApple`、Generate Apple A（disabled） |
| 1 Apple 就緒 | `bagImg && appleImg && maskHasRegion('a')` | Generate Apple A（enabled） |
| 2 Apple 完成 | Apple API 成功回傳 | ① 解鎖 B 區繪製（原本 disabled）→ ② 顯示 Generate Bear B（disabled） |
| 3 Bear 就緒 | `bearImg && maskHasRegion('b')` | Generate Bear B（enabled） |
| 4 完成 | Bear API 成功回傳 | Download Final（enabled） |

> `maskHasRegion(region)`：掃描 `maskCtx.getImageData`，該區顏色（紅/藍）alpha > 20 的像素數 > 0。

---

## 4. 邊界情況與錯誤處理

| # | 情況 | 觸發點 | 顯示文字（狀態列 / Toast） |
|---|------|--------|----------------------------|
| E1 | 未貼 API Key | 點擊任一 Generate | `請先貼上 OpenAI API Key` |
| E2 | 缺圖 | 點擊 Generate Apple | `缺少 Bag 或 Apple 圖片` |
| | | 點擊 Generate Bear | `缺少 Bear 圖片` |
| E3 | Mask 空白 | 點擊 Generate Apple | `請先在 A 區畫出至少一個筆觸` |
| | | 點擊 Generate Bear | `請先在 B 區畫出至少一個筆觸` |
| E4 | API 4xx | 兩步驟 fetch `!res.ok` 且 `status < 500` | `API 錯誤：${json.error?.message || statusText}` |
| E5 | API 5xx / 網路 | fetch 拋錯或 `status >= 500` | `連線錯誤：${err.message}` |

> 所有錯誤**不阻斷 UI**，使用者可修正後重試。

---

## 5. Prompt 預設值（系統帶入，使用者可覆寫）

### `promptApple`（Apple 步驟專用）

```text
Edit the bag image.
In the transparent region (region A), seamlessly composite the provided apple onto the bag surface so it looks printed/embroidered on the fabric.
Match lighting, perspective, fabric wrinkles and material of the bag exactly.
Keep everything outside the transparent region completely unchanged.
High fidelity, photorealistic product photo.
```

### `promptBear`（Bear 步驟專用，**必含保留指示**）

```text
Edit the bag image.
In the transparent region (region B), seamlessly composite the provided bear onto the bag surface so it looks printed/embroidered on the fabric.
Match lighting, perspective, fabric wrinkles and material of the bag exactly.
Preserve the apple already placed in region A exactly as it is. Do not modify region A.
Keep everything outside the transparent region completely unchanged.
High fidelity, photorealistic product photo.
```

> 兩個 `<textarea>` 分別綁定 `state.promptApple`、`state.promptBear`，互不干擾。

---

## 6. 技術規格

| 類別 | 細節 |
|------|------|
| **單一檔案** | `bag-compositor.html`（含 HTML/CSS/JS） |
| **模組載入** | `<script type="module">`，所有邏輯在模組內，不汙染全域 |
| **狀態管理** | 單一 `const state = { ... }` 物件 |
| **歷史堆疊** | `state.history: ImageData[]`、`state.historyIndex: number`、`MAX_HISTORY = 40` |
| **版本堆疊** | `state.versions = { apple: [], bear: [] }`，各自 `unshift` 新結果、長度 > 3 時 `pop()` |
| **Mask → Edit Mask 轉換** | 掃描 `maskCtx.getImageData`，任何通道 alpha > 20 → `editMask` 該像素 alpha = 0（透明=可編輯），其餘 alpha = 255 |
| **API 請求** | `FormData.append('image[]', blob, 'name.png')` 依序 bag、apple/bear；`mask` 最後 append |
| **回傳處理** | `json.data[0].b64_json` → `data:image/png;base64,${b64}` 存入 `state.resultUrl` 並推入對應版本陣列 |
| **圖片尺寸** | 不做 resize；原圖像素 1:1 送 API（`size=auto` 交給模型決定輸出尺寸） |
| **檔案格式** | 全程 PNG（`canvas.toBlob(blob, 'image/png')`） |
| **CORS** | 直接呼叫 `https://api.openai.com/v1/images/edits`（瀏覽器允許），需確認 key 有 `gpt-image-2` 權限 |

---

## 7. 驗收測試腳本（手動，逐項打勾）

| # | 步驟 | 預期結果 |
|---|------|----------|
| T1 | 開啟 HTML、貼 key、上傳 bag | 畫布顯示 bag、mask canvas 同尺寸、Undo/Redo disabled |
| T2 | 選 A、brush=24、畫幾筆 | mask 上出現紅色筆觸、Undo enabled、historyIndex=1 |
| T3 | Undo → Redo | 筆觸消失 → 再出現 |
| T4 | 選 Eraser、擦一部分 | 該部份 mask 變透明、history 又加一筆 |
| T5 | 上傳 Apple、Bear | 右側兩個 Preview 方框出現縮圖 |
| T6 | 未畫 B、按 Generate Apple | 狀態列 `請先在 A 區畫出至少一個筆觸`（若 A 也沒畫） |
| T7 | 畫 A、按 Generate Apple | 狀態列 `Calling GPT Image 2…` → 幾十秒後右側 Apple 版本列表出現 1 張縮圖、B 區解鎖、Generate Bear B 顯示但 disabled |
| T8 | 畫 B、上傳 Bear、按 Generate Bear | 狀態列進度 → 完成後右側 Bear 版本列表出現、Download Final 亮起 |
| T9 | 點 Download Final | 瀏覽器下載 `bag-composite.png`，開啟可見 apple 在 A、bear 在 B |
| T10 | 再按一次 Generate Apple | Apple 版本列表變 2 張（最新在左），舊版右移 |
| T11 | 連按 4 次 Generate Apple | 版本列表只保留最新 3 張 |
| T12 | 重新整理頁面 | 所有狀態清空、回到初始畫面 |
| T13 | 故意不貼 key、按 Generate | 顯示 `請先貼上 OpenAI API Key` |
| T14 | 用錯誤 key、按 Generate | 顯示 `API 錯誤：Incorrect API key provided`（或同義 401 訊息） |

---

## 8. 非目標（Out of Scope）

1. 任何後端元件（proxy、serverless function、CF Worker 等）
2. 多於 2 個命名區域
3. 觸控、手機、平板、無障礙
4. Zoom / Pan / 旋轉畫布
5. 批次、排程、多組素材
6. 多語言、i18n
7. 任何形式的持久化（localStorage / IndexedDB / 檔案系統）
8. Prompt 版本管理、prompt template library
9. 種子、temperature、決定性輸出控制（OpenAI 不支援）

---

## 9. 交付清單

```
try_mask_AB_image/
├── bag-compositor.html     ← 唯一可執行交付物
├── design-brief.md         ← 設計簡報（已存在）
└── prd.md                  ← 本文件
```

---

## 10. 開發順序建議（給實作者）

1. **骨架**：HTML 結構 + CSS 變數 + 三欄 Flex/Grid
2. **Canvas 基礎**：載入 bag → 同步建立 main/mask canvas → 滑鼠事件 → 繪製 + history
3. **區域切換 + Eraser + brushSize + Undo/Redo + Clear**
4. **雙 Prompt textarea + 預設值注入**
5. **參考圖上傳 + 右側 Preview**
6. **Mask → Edit Mask 轉換函式**（獨立、可單元測試）
7. **Apple 步驟 API**（含錯誤處理、版本推入、UI 解鎖）
8. **Bear 步驟 API**（含保留指示、版本推入、下載按鈕）
9. **版本縮圖列表渲染**（Apple / Bear 共用元件）
10. **端到端手動測試（§7）**

---

*撰寫日期：2026-08-05*  
*依據：design-brief.md v1.0 + 第二輪訪談拍板*