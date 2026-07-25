# dices-log Cloudflare Worker 部署教學

## 目的

前端 dices.3minstest.com 每次擲骰 → POST 到這個 Worker → Worker 用 Notion Integration Token 把紀錄寫入 Sam 專屬 Notion Database（繞開 browser 的 Notion API CORS 限制）。

## 前置作業

### A. 取得 Notion Integration Token

1. 到 <https://www.notion.so/profile/integrations>
2. 右上「+ New integration」
3. 命名：`dices-log`
4. Associated workspace：選你有 dices DB 的那個
5. Type：**Internal**
6. 建立後複製「Internal Integration Secret」（`ntn_...` 或 `secret_...` 開頭）
7. **回到 Notion DB 頁**：`https://app.notion.com/p/bdcaf8bcb45045bbb90724444ddfa6d6`
8. DB 右上「⋯」→「Add connections」→ 選 `dices-log` → 確認

### B. 部署 Worker（兩擇一）

#### B1. Wrangler CLI（推薦，30 秒）

```bash
cd worker
npx wrangler login    # 開瀏覽器授權 CF 帳號(一次)
npx wrangler secret put NOTION_TOKEN
# 貼 A 步驟拿的 secret_... 按 Enter
npx wrangler secret put NOTION_DATABASE_ID
# 貼:f4cdd651-f24d-49aa-a4bf-aed017551077 按 Enter
npx wrangler deploy
```

部署完畢會顯示 Worker URL，例如 `https://dices-log.samlin0320-bee.workers.dev`。

#### B2. CF Dashboard（GUI）

1. 到 <https://dash.cloudflare.com/> → Workers & Pages → Create → Create Worker → 命名 `dices-log`
2. 點「Edit code」→ 貼 `dices-log-worker.js` 內容 → Deploy
3. Settings → Variables → Environment Variables → Encrypt →
   - `NOTION_TOKEN` = 你的 Integration Secret
   - `NOTION_DATABASE_ID` = `f4cdd651-f24d-49aa-a4bf-aed017551077`
4. Save & Deploy
5. 頂端顯示 Worker URL

### C. 把 Worker URL 告訴 dices 前端

分享網址時附 `?worker=<WORKER_URL>` 一次，前端會存 localStorage：

```
https://dices.3minstest.com/?worker=https://dices-log.samlin0320-bee.workers.dev
```

之後所有擲骰都會 auto-POST 到 Worker → Notion DB。

## 除錯

- Worker CF Dashboard → 你的 Worker → Logs 即時看
- 或 CLI：`npx wrangler tail`

## 安全

- Worker 的 CORS 只放行 `https://dices.3minstest.com`（別的網域 POST 會被擋）
- Notion Token 只存在 CF Secret（前端看不到）
- 若濫用/被爬，到 CF Dashboard 一鍵停用 Worker
