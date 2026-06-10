# 占星骰子 · 五骰判讀

> 西洋 × 印度雙派分流判讀 · 含當前行運整合

線上版：http://rightone.3minstest.com/astro-dice/

## 為什麼是五顆骰子

| 骰子 | 用途 |
|---|---|
| 骰 1 行星 A | 主骰行星 |
| 骰 2 星座 A | 主骰星座 |
| 骰 3 宮位 | 基準宮位（決定上升星座與整張盤的方位） |
| 骰 4 行星 B | 副骰行星，用於相位 / 命主飛宮分析 |
| 骰 5 星座 B | 副骰星座，由此推算副骰所在宮位（整宮制 Whole Sign） |

副骰宮位 = `(副骰星座 − 上升星座) mod 12 + 1`，跟著主盤一起算。

## 雙派分流

印度占星的宮位意義跟西洋占星**不可互通**。判讀引擎為兩派各維護獨立的：

- 宮位含義表（Western Houses vs Vedic Bhavas）
- 守護星表（含西洋現代守護 vs 印度只用古典七星 + 羅睺/計都）
- 弱陷判定（西洋有 Detriment + Fall，印度只看 Exalted + Fall + Own Sign）

每張結果頁明確標示「【西洋觀點】vs【印度觀點 Vedic】」並列輸出，不混寫。

## 三種輸入方式（規劃中）

| 輸入 | 狀態 |
|---|---|
| ✋ 手動選取 | ✅ 已上線 |
| 📷 圖片輸入 | ✅ Claude Vision API（用戶自帶 key） |
| 🎤 語音輸入 | ✅ 瀏覽器 Web Speech API + 正則解析 |

### 圖片輸入

支援三種圖片：實體骰子照片、占星 APP 截圖、表格截圖。三種來源共用同一個 Claude Vision prompt。  
使用者填入自己的 Anthropic API key（存 localStorage，永不上傳），辨識結果 JSON 自動填入手動欄位。

支援拖曳上傳、Ctrl+V 貼上、點擊選擇三種上傳方式。

### 語音輸入

說「冥王星天秤六宮，金星巨蟹」，前端用 Web Speech API 轉文字，再用正則解析出主副骰子的行星 / 星座 / 宮位。  
中文星座俗稱（白羊、寶瓶、魔羯…）和行星別稱（北交點、龍頭、龍尾…）都有對照表。  
Chrome / Edge 支援，Safari / Firefox 部分支援。

## 深度 AI 解讀（NotebookLM 整合）

判讀結果下方有兩顆按鈕：

1. **📋 複製西洋查詢 → Astrology-占星學** — 把為這次骰子量身打造的西洋路徑 prompt 複製到剪貼簿並開啟對應 NotebookLM。
2. **📋 複製印度查詢 → 印度占星精進班** — 同上，但是 Vedic 路徑。

到 NotebookLM 後直接 Ctrl+V 貼到對話框送出即可。Prompt 內已自動帶入：

- 骰子結果（含整宮制副骰宮位推算）
- 推算上升 + 命主星
- 當前行運（如果有填）
- 五點結構化問題（含廟旺弱陷、命主飛宮路徑、相位、行運啟動、可執行建議）
- Vedic 路徑加上三條凶險檢查的明確指令

> NotebookLM 的回答會引用 notebook 內的具體規則、案例與課堂筆記 — 對應您的學習脈絡，不是泛泛而談。

## 當前狀態

v0.1 已實作：

- 五骰子手動輸入 + 整宮制副骰宮位自動推算
- 廟旺 / 弱陷 / 守護 / 對沖 自動標記
- Dusthana / Kendra / Trikona / Upachaya 印度宮位屬性自動標記
- 命主星自動推算 + 命主飛宮偵測
- 六大運星行運疊加 + 凶宮警告

待辦：

- [x] ~~NotebookLM 知識庫對接（ASTROLOGY + 印度占星）做 AI 深度解讀~~
- [x] ~~Swiss Ephemeris 自動帶當下行運~~
- [x] ~~印度規則庫擴充（八宮凶星 / 空宮飛宮 / 弱陷三檢查）~~
- [ ] 圖片 / 語音輸入

## 行運星曆自動更新

`ephemeris.json` 涵蓋 -30 ~ +90 天、6 小時解析度、十二顆行星（含羅睺/計都）的雙系統位置（熱帶 + 恆星 Lahiri）。

每天 UTC 00:00（台灣 08:00）由 GitHub Action 自動重算並 commit。手動觸發：

```bash
python tools/update_ephemeris.py
```

依賴：`pyswisseph>=2.10.0`

## 本地開啟

直接雙擊 `index.html` 即可（純靜態，零依賴）。

## 部署

GitHub Pages 已啟用，main branch 推送後自動部署。
