# Design Brief — Bag Region Compositor

> **版本**：v1.0  
> **定位**：個人一次性工具（單機、單檔 HTML）  
> **核心功能**：在包包照片上繪製 A（紅）、B（藍）兩個命名區域，透過 GPT Image 2 api 序列化兩次呼叫，將 apple 合成進 A 區、bear 合成進 B 區。  
> **最終交付**：一份可直接開啟執行的 HTML 檔案，配上同目錄下的 PRD。

---

## 1. 專案定位

- **範圍**：個人一次性工具。不對外、不共用、不藏 API key（前端傳送）。
- **部署方式**：單檔 `.html`，Chrome/Edge/Firefox 直接開啓即用。
- **關鍵限制**：無後端、無後端 proxy、無伺服器元件。

---

## 2. 成功判準（驗收核心指標）

以「**一次端到端跑通**」為唯一驗收場景：

1. 使用者上傳包包照片。
2. 於畫布上用紅色筆刷畫出 **A 區域**，用藍色筆刷畫出 **B 區域**。
3. 使用者上傳 apple 與 bear 參考圖片。
4. 系統執行序列化遍歷：
   - **步驟 Apple**：送出 mask（僅 A 區域透明）+ bag + apple → 產出「包包+apple」暫存結果。
   - **步驟 Bear**：用前一步結果當新 base 圖，送出 mask（僅 B 區域透明）+ bear → 產出最終合成圖。
5. 使用者可下載最終結果。

> 只要第 1–5 步順利執行一次即算成功。不要求批次、不要求重複穩定性（OpenAI 模型不保證 seed 一致性）、不要求多輪 prompt 的 A/B 比對。

---

## 3. 受眾與使用情境

- **使用者**：開發者本人（你）。
- **環境**：桌機瀏覽器（Chrome / Edge / Firefox），僅使用滑鼠操作。
- **語言**：介面文案以技術化的繁體中文為主（可出現 alpha、mask、canvas 等術語）。
- **無障礙 / 行動裝置**：不支援觸控、不支援螢幕閱讀器、不支援手機/平板。

---

## 4. 視覺方向

- **基調**：深色面板（類似 Figma/VS Code 色調），#0f1115 背景、#1a1d24 面板、#2a2f3a 邊框。
- **佈局**：三欄結構 — 左側工具列、中央畫布、右側預覽。
- **風格來源**：沿用已有的設計；本次不進行 UI 重設計或視覺升級。

---

## 5. 內容範圍（功能區塊）

以下功能區塊**全數保留**於最終產品中，不增不減：

| 區塊 | 內容 | 備註 |
|------|------|------|
| API Key | 密碼輸入框，貼 OpenAI key | 不做後端 proxy |
| 上傳 Bag | 檔案選擇器 → 畫布呈現 | PNG/JPEG/WEBP |
| 區域切換 | A（紅）／B（藍）／Eraser | 三按鈕 toggle、當前高亮 |
| 筆刷粗細 | range slider（4–80px） | 即時顯示數值 |
| Undo / Redo | 按鈕（ImageData 堆疊） | 保存最後 40 筆 |
| Clear | 一鍵清除所有 mask | 同步 reset 歷史堆疊 |
| 上傳 Apple / Bear | 兩組檔案選擇器 | 各附預覽方框 |
| Prompt 編輯區 | textarea，可覆寫 | 預設值由系統帶入 |
| Generate（兩段式） | 「Generate Apple A」「Generate Bear B」wizard | 啟用條件見第 6 節 |
| 結果預覽 | 方框 → 顯示下載 | 結果圖嵌入顯示 |
| 下載按鈕 | 觸發瀏覽器下載 | PNG 格式 |
| 狀態列 | 顯示進度／錯誤訊息 | 處理 5 種邊界（見 §7） |

---

## 6. Hero 技術路線

### 核心決策：序列化兩次呼叫

```
[原始 bag + apple + mask(A 區)] → GPT Image 2 → bag+apple（暫存結果）
[暫存結果當 base + bear + mask(B 區)] → GPT Image 2 → 最終合成圖
```

### 流程細節

| 步驟 | 輸入 | 輸出 | 行為說明 |
|------|------|------|----------|
| **Apple 步驟** | 原始 bag（base）+ apple（參考）+ mask（僅 A 區透明）| 暫存結果圖片 | 模型在透明區域編集 apple，其餘不變 |
| **Bear 步驟** | 暫存結果當新 base + bear（參考）+ mask（僅 B 區透明）| 最終合成圖 | 模型在透明區域編集 bear，prompt 明令保留 A 區的 apple |

### 啟用邏輯（wizard 風格）

1. 畫面載入 → 只有「上傳 Bag」「畫 A 區」「上傳 Apple」區塊可操作。
2. 已上傳 bag + apple + A 區 mask 非空 → **「Generate Apple A」按鈕亮起**。
3. 點選「Generate Apple A」→ 成功後，才**解鎖 B 區繪製**（原本灰色鎖定）與**顯示「Generate Bear B」按鈕**。
4. 已上傳 bear + B 區 mask 非空 → **「Generate Bear B」按鈕亮起**。
5. 點選「Generate Bear B」→ 成功後才出現下載按鈕。
6. 任一階段可按「重新生成 Apple A」或「重新生成 Bear B」獨立重跑，不影響另一側的結果。

### API 呼叫格式

- **端點**：`POST https://api.openai.com/v1/images/edits`
- **模型**：`gpt-image-2`
- **參數**：`model`、`image[]`（至少 1 張）、`mask`（可選，透明區 = 可編集）、`prompt`、`quality = high`、`size = auto`
- **認證**：`Authorization: Bearer ${key}`（key 留前端）

### Mask 產生規則

- Alpha 值 > 20 的像素 → 視為使用者繪製區域 → mask 中設為完全透明（alpha = 0，可編集區）。
- 其餘像素 → 設為純白不透明（alpha = 255，不可編集區）。

---

## 7. 邊界情況（guarded 的 5 種）

| # | 情況 | 處理方式 |
|---|------|----------|
| 1 | 未貼 API key | 按「Generate」時跳出狀態文字：`請先貼上 OpenAI API Key`，不發送請求 |
| 2 | 缺少任一圖片（bag / apple / bear） | Generate 按鈕保持 disabled，狀態列提示缺少哪張 |
| 3 | mask 為空白（完全沒畫任何區域） | 拒絕發送，狀態文字：`請先畫出至少一個區域` |
| 4 | API 回傳 4xx（key 無效、模型無權限、圖片尺寸超限等） | 顯示 `API Error: ${error.message}` 於狀態列 |
| 5 | API 回傳 5xx 或網路異常 | 顯示 `連線錯誤：${error.message}` 於狀態列（fetch 拋錯時） |

其他未列舉的錯誤（檔案格式、canvas 大小等）依瀏覽器預設行為處理，不主動捕獲。

---

## 8. 資料與隱私

- **全前端執行**：所有圖片只存在記憶體變數與 canvas 物件中。
- **零持久化**：不寫入 localStorage、IndexedDB、sessionStorage 或任何硬碟檔案。
- **關閉頁面即清除**：重新整理後所有狀態重置，無恢復機制。
- **輸出檔案**：唯一落地方式為瀏覽器下載（透過 `a.click()` 觸發）。

---

## 9. 已知開放問題（在 PRD 中拍板）

這些問題已排除在 Brief 範圍之外，不在本次 PRD 中處理：

1. **後端 proxy 隱藏 API key** — 不符合「個人一次性單機工具」定位。
2. **支援超過 2 個區域（C / D / …）** — MVP 限定 A、B 兩區。
3. **批次處理多組圖片** — 不納入此次。
4. **多語言切換** — 只使用繁體中文。
5. **zoom / pan 畫布** — 不納入 MVP。
6. **序列化產生的中間結果保留** — 僅保留當次 session 的變數；不留永久存檔。

---

*撰寫日期：2026-08-05*
*下一篇文件：[prd.md](prd.md)*