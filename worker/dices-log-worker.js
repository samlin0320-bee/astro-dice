// dices-log-worker: Cloudflare Worker,收 dices 前端 POST → 轉寫到 Notion DB
// 部署後,前端把 record POST 過來,Worker 加 Notion 認證後轉 create page

const NOTION_VERSION = '2022-06-28';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://dices.3minstest.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env) {
    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'POST') {
      return json({ error: 'POST only' }, 405);
    }

    let rec;
    try {
      rec = await request.json();
    } catch (e) {
      return json({ error: 'invalid json' }, 400);
    }

    // ── Telegram 發送路徑(action:'telegram') ──
    // token/chat 藏在 Worker secret,前端不碰,任何瀏覽器都能用
    if (rec && rec.action === 'telegram') {
      const tgToken = env.TG_BOT_TOKEN;
      const tgChat = env.TG_CHAT_ID;
      if (!tgToken || !tgChat) {
        return json({ error: 'telegram not configured (TG_BOT_TOKEN / TG_CHAT_ID missing)' }, 500);
      }
      const text = truncate(rec.text || '(空白報告)', 4000);
      const tgResp = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: tgChat, text, disable_web_page_preview: true }),
      });
      const tgData = await tgResp.json().catch(() => ({}));
      if (!tgResp.ok || !tgData.ok) {
        return json({ error: 'telegram api', status: tgResp.status, detail: (tgData.description || '').slice(0, 300) }, 502);
      }
      return json({ ok: true, message_id: tgData.result && tgData.result.message_id });
    }

    const dbId = env.NOTION_DATABASE_ID;
    const token = env.NOTION_TOKEN;
    if (!dbId || !token) {
      return json({ error: 'server not configured (NOTION_TOKEN / NOTION_DATABASE_ID missing)' }, 500);
    }

    // ── 更新既有紀錄(action:'update') — AI 深解完成後補上 AI 三段到同一筆 ──
    if (rec && rec.action === 'update' && rec.pageId) {
      const up = {};
      if (rec.aiWest) up['AI 西洋建議'] = { rich_text: [{ text: { content: truncate(rec.aiWest, 2000) } }] };
      if (rec.aiVedic) up['AI 印度建議'] = { rich_text: [{ text: { content: truncate(rec.aiVedic, 2000) } }] };
      if (rec.aiConsensus) up['AI 兩派共識建議'] = { rich_text: [{ text: { content: truncate(rec.aiConsensus, 2000) } }] };
      if (rec.ascSign) up['推算上升'] = { select: { name: rec.ascSign } };
      if (rec.lord) up['命主星'] = { select: { name: rec.lord } };
      const upResp = await fetch(`https://api.notion.com/v1/pages/${rec.pageId}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: up }),
      });
      if (!upResp.ok) {
        const et = await upResp.text();
        return json({ error: 'notion update', status: upResp.status, detail: et.slice(0, 300) }, 502);
      }
      return json({ ok: true, updated: rec.pageId });
    }

    // Build Notion page properties from record
    const props = buildProperties(rec);

    const resp = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parent: { database_id: dbId },
        properties: props,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return json({ error: 'notion api', status: resp.status, detail: errText.slice(0, 500) }, 502);
    }

    const data = await resp.json();
    return json({ ok: true, id: data.id, url: data.url });
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function truncate(s, n) {
  return String(s || '').slice(0, n);
}

function buildProperties(r) {
  // 對齊 Notion DB schema
  const p = {};
  // Title (問題)
  p['問題'] = { title: [{ text: { content: truncate(r.q || '(未提問)', 2000) } }] };
  // 時間 (擲骰時間)
  if (r.ts) p['時間'] = { date: { start: r.ts } };
  // 發問時刻
  if (r.askTime) p['發問時刻'] = { date: { start: normalizeDate(r.askTime) } };
  // 使用者
  if (r.user) p['使用者'] = { rich_text: [{ text: { content: truncate(r.user, 200) } }] };
  // 議題 multi-select
  if (Array.isArray(r.topics) && r.topics.length) {
    // 議題 chip value 例:「愛情 / 感情 / 婚姻」→ 取第一段作為 select name
    const topicNames = r.topics.map(t => String(t).split(' / ')[0]).filter(Boolean);
    p['議題'] = { multi_select: topicNames.map(n => ({ name: n })) };
  }
  if (r.customTopic) p['其他議題'] = { rich_text: [{ text: { content: truncate(r.customTopic, 500) } }] };
  // 主副骰
  if (r.pA) p['主骰行星'] = { select: { name: planetZh(r.pA) } };
  if (r.sA != null && r.sA !== '') p['主骰星座'] = { select: { name: signZh(r.sA) } };
  if (r.houseA) p['主骰宮位'] = { number: parseInt(r.houseA) };
  if (r.useSubdie && r.pB) p['副骰行星'] = { select: { name: planetZh(r.pB) } };
  if (r.useSubdie && r.sB != null && r.sB !== '') p['副骰星座'] = { select: { name: signZh(r.sB) } };
  // 推算上升 / 命主星
  if (r.ascSign) p['推算上升'] = { select: { name: r.ascSign } };
  if (r.lord) p['命主星'] = { select: { name: r.lord } };
  // 行運日期
  if (r.transitDate) p['行運日期'] = { date: { start: normalizeDate(r.transitDate) } };
  // AI 建議
  if (r.aiWest) p['AI 西洋建議'] = { rich_text: [{ text: { content: truncate(r.aiWest, 2000) } }] };
  if (r.aiVedic) p['AI 印度建議'] = { rich_text: [{ text: { content: truncate(r.aiVedic, 2000) } }] };
  if (r.aiConsensus) p['AI 兩派共識建議'] = { rich_text: [{ text: { content: truncate(r.aiConsensus, 2000) } }] };
  // 來源
  p['來源'] = { url: 'https://dices.3minstest.com/' };
  return p;
}

// 把 "2026/7/24 15:34" 之類轉為 ISO
function normalizeDate(s) {
  s = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s; // 已 ISO
  // datetime-local 格式 "2026-07-24T15:34" 或本地格式
  const d = new Date(s);
  if (isNaN(d)) return null;
  return d.toISOString();
}

const PLANET_ZH = {
  sun: '太陽', moon: '月亮', mercury: '水星', venus: '金星', mars: '火星',
  jupiter: '木星', saturn: '土星', uranus: '天王星', neptune: '海王星',
  pluto: '冥王星', rahu: '羅睺', ketu: '計都',
};
const SIGN_ZH = ['牡羊', '金牛', '雙子', '巨蟹', '獅子', '處女', '天秤', '天蠍', '射手', '摩羯', '水瓶', '雙魚'];
function planetZh(id) { return PLANET_ZH[id] || id; }
function signZh(i) { return SIGN_ZH[parseInt(i)] || ''; }
