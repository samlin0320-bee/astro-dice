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

    // ── Telegram 傳 MD 檔(action:'telegram_doc') — 用 sendDocument,避免長文洗版 ──
    // ── 登入使用者的雲端歷史(KV):token 由 Google 驗證出 email,以 email 為 key ──
    if (rec && (rec.action === 'hist_put' || rec.action === 'hist_list')) {
      if (!env.HISTORY) return json({ error: 'history store not configured' }, 500);
      const email = await verifyGoogleEmail(rec.token, rec.tokenType);
      if (!email) return json({ error: 'auth', detail: 'Google token 無效或已過期' }, 401);
      const key = 'u:' + email;
      let list = [];
      try { list = JSON.parse((await env.HISTORY.get(key)) || '[]'); } catch (e) { list = []; }
      if (rec.action === 'hist_put') {
        const incoming = (Array.isArray(rec.records) ? rec.records : []).slice(0, 200);
        const byId = new Map(list.map(r => [r.id, r]));
        for (const r of incoming) {
          if (!r || !r.id) continue;
          r.user = email;   // 以驗證過的 email 為準,不信任前端
          byId.set(r.id, r);
        }
        list = Array.from(byId.values()).sort((a, b) => String(b.ts).localeCompare(String(a.ts))).slice(0, 200);
        await env.HISTORY.put(key, JSON.stringify(list));
        return json({ ok: true, count: list.length });
      }
      return json({ ok: true, records: list });
    }

    // ── Gemini 備援通道(action:'gemini_proxy') — 瀏覽器直連 Google 失敗(Failed to fetch)時改由 Worker 轉送 ──
    if (rec && rec.action === 'gemini_proxy') {
      const model = String(rec.model || '');
      if (!/^[a-z0-9.\-]{3,60}$/.test(model) || !rec.key || !rec.body) return json({ error: 'bad proxy request' }, 400);
      const gr = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(rec.key)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rec.body),
      });
      return new Response(await gr.text(), { status: gr.status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
    }

    // ── 前端錯誤回報(action:'client_error') — AI 判讀失敗時通知 Telegram,錯誤不再靜默 ──
    if (rec && rec.action === 'client_error') {
      if (env.TG_BOT_TOKEN && env.TG_CHAT_ID) {
        const n = rec.net || {};
        const text = `⚠️ dices 前端錯誤\n📍 ${truncate(rec.where, 40)}\n❌ ${truncate(rec.msg, 300)}\n❓ ${truncate(rec.q, 80) || '(未提問)'}\n🌐 online=${rec.online} 直連=${n.direct || 0} 重試=${n.retry || 0} 備援=${n.proxy || 0}\n🖥 ${truncate(rec.ua, 120)}`;
        await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: env.TG_CHAT_ID, text, disable_web_page_preview: true }),
        }).catch(() => {});
      }
      return json({ ok: true });
    }

    if (rec && rec.action === 'telegram_doc') {
      const tgToken = env.TG_BOT_TOKEN;
      const tgChat = env.TG_CHAT_ID;
      if (!tgToken || !tgChat) {
        return json({ error: 'telegram not configured' }, 500);
      }
      const filename = String(rec.filename || 'astro-dice.md').slice(0, 120);
      const content = String(rec.content || '');
      if (!content.trim()) return json({ error: 'empty content' }, 400);
      const caption = String(rec.caption || '').slice(0, 1000);
      // 手動組 multipart:Workers 的 FormData 會把非 ASCII 檔名/內容降級成亂碼。
      // 這裡全程 TextEncoder 產生純 UTF-8 bytes,檔名再用 RFC 5987 filename* 帶中文。
      const enc = new TextEncoder();
      const boundary = '----AstroDice' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      const asciiName = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
      const CRLF = '\r\n';
      const parts = [];
      const pushField = (name, value) => {
        parts.push(enc.encode(
          '--' + boundary + CRLF +
          'Content-Disposition: form-data; name="' + name + '"' + CRLF +
          'Content-Type: text/plain; charset=utf-8' + CRLF + CRLF
        ));
        parts.push(enc.encode(value));
        parts.push(enc.encode(CRLF));
      };
      pushField('chat_id', String(tgChat));
      if (caption) pushField('caption', caption);
      parts.push(enc.encode(
        '--' + boundary + CRLF +
        'Content-Disposition: form-data; name="document"; filename="' + asciiName +
        '"; filename*=UTF-8\'\'' + encodeURIComponent(filename) + CRLF +
        'Content-Type: text/markdown; charset=utf-8' + CRLF + CRLF
      ));
      parts.push(enc.encode('\uFEFF' + content));   // BOM:確保任何編輯器都用 UTF-8 開
      parts.push(enc.encode(CRLF + '--' + boundary + '--' + CRLF));
      let totalLen = 0;
      for (const p of parts) totalLen += p.length;
      const body = new Uint8Array(totalLen);
      let off = 0;
      for (const p of parts) { body.set(p, off); off += p.length; }
      const tgResp = await fetch(`https://api.telegram.org/bot${tgToken}/sendDocument`, {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary },
        body,
      });
      const tgData = await tgResp.json().catch(() => ({}));
      if (!tgResp.ok || !tgData.ok) {
        return json({ error: 'telegram api', status: tgResp.status, detail: (tgData.description || '').slice(0, 300) }, 502);
      }
      return json({ ok: true, message_id: tgData.result && tgData.result.message_id });
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

    // ── 附圖到既有紀錄(action:'notion_images') — 結果截圖 + 宮位圖,用 Notion File Upload API ──
    if (rec && rec.action === 'notion_images' && rec.pageId && Array.isArray(rec.images)) {
      const children = [];
      for (const im of rec.images.slice(0, 5)) {
        let bytes;
        try { bytes = Uint8Array.from(atob(String(im.b64 || '')), c => c.charCodeAt(0)); }
        catch (e) { return json({ error: 'bad base64', name: im.name }, 400); }
        if (!bytes.length || bytes.length > 5 * 1024 * 1024) return json({ error: 'file size', name: im.name, size: bytes.length }, 413);
        const isFile = im.kind === 'file';
        const type = isFile ? 'text/markdown' : (im.type === 'image/jpeg' ? 'image/jpeg' : 'image/png');
        const r = await notionUpload(token, bytes, type, String(im.name || (isFile ? 'dices.md' : 'dices.png')).slice(0, 120));
        if (r.error) return json(r, 502);
        children.push(fileBlock(r.id, isFile ? 'file' : 'image', im.caption));
      }
      if (!children.length) return json({ error: 'no images' }, 400);
      const ar = await notionAppend(token, rec.pageId, children);
      if (ar.error) return json(ar, 502);
      return json({ ok: true, count: children.length });
    }

    // ── 補舊紀錄 MD 檔(action:'backfill_md') — 由 Notion 屬性組 MD 附到沒有 MD 的頁;需 BACKFILL_KEY ──
    if (rec && rec.action === 'backfill_md') {
      if (!env.BACKFILL_KEY || rec.key !== env.BACKFILL_KEY) return json({ error: 'forbidden' }, 403);
      const H = { 'Authorization': `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' };
      const qr = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ page_size: Math.min(8, rec.pageSize || 8), start_cursor: rec.cursor || undefined,
          sorts: [{ timestamp: 'created_time', direction: 'ascending' }] }),
      });
      const qj = await qr.json().catch(() => ({}));
      if (!qr.ok) return json({ error: 'notion query', status: qr.status, detail: JSON.stringify(qj).slice(0, 300) }, 502);
      const done = [];
      for (const pg of qj.results || []) {
        const kr = await fetch(`https://api.notion.com/v1/blocks/${pg.id}/children?page_size=100`, { headers: H });
        const kj = await kr.json().catch(() => ({}));
        const hasMd = (kj.results || []).some(b => b.type === 'file' && (/\.md$/i.test((b.file && b.file.name) || '') ||
          ((b.file && b.file.caption) || []).some(c => /MD/.test(c.plain_text || ''))));
        if (hasMd) { done.push({ id: pg.id, skip: 'has md' }); continue; }
        if (rec.dryRun) { done.push({ id: pg.id, wouldAdd: true }); continue; }
        const { md, name } = mdFromPage(pg);
        const up = await notionUpload(token, new TextEncoder().encode('\uFEFF' + md), 'text/markdown', name);
        if (up.error) { done.push({ id: pg.id, error: up }); continue; }
        const ar = await notionAppend(token, pg.id, [fileBlock(up.id, 'file', '📄 判讀 MD 檔(由 Notion 紀錄補建)')]);
        done.push(ar.error ? { id: pg.id, error: ar } : { id: pg.id, added: name });
      }
      return json({ ok: true, next: qj.has_more ? qj.next_cursor : null, done });
    }

    // ── 更新既有紀錄(action:'update') — AI 深解完成後補上 AI 三段到同一筆 ──
    if (rec && rec.action === 'update' && rec.pageId) {
      const up = {};
      if (rec.aiWest) up['AI 西洋建議'] = { rich_text: richText(rec.aiWest) };
      if (rec.aiVedic) up['AI 印度建議'] = { rich_text: richText(rec.aiVedic) };
      if (rec.aiConsensus) up['AI 兩派共識建議'] = { rich_text: richText(rec.aiConsensus) };
      if (rec.ascSign) up['推算上升'] = { select: { name: rec.ascSign } };
      if (rec.lord) up['命主星'] = { select: { name: rec.lord } };
      // 議題:AI 完成時再同步一次(使用者可能在產生判讀後才勾選/填寫)
      if (Array.isArray(rec.topics)) {
        const names = rec.topics.map(t => String(t).split(' / ')[0]).filter(Boolean);
        up['議題'] = { multi_select: names.map(n => ({ name: n })) };
      }
      if (typeof rec.customTopic === 'string') {
        up['其他議題'] = { rich_text: rec.customTopic ? [{ text: { content: truncate(rec.customTopic, 500) } }] : [] };
      }
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


// ── Notion File Upload 共用:建立 → 手動 multipart 傳送(保留中文檔名,FormData 會亂碼) ──
async function notionUpload(token, bytes, type, name) {
  const H = { 'Authorization': `Bearer ${token}`, 'Notion-Version': NOTION_VERSION };
  const cr = await fetch('https://api.notion.com/v1/file_uploads', {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: name, content_type: type }),
  });
  const cj = await cr.json().catch(() => ({}));
  if (!cr.ok || !cj.id) return { error: 'notion file_upload create', status: cr.status, detail: JSON.stringify(cj).slice(0, 300) };
  const enc = new TextEncoder();
  const boundary = '----AstroDice' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const asciiName = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  const head = enc.encode('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + asciiName +
    '"; filename*=UTF-8\'\'' + encodeURIComponent(name).replace(/['()*!]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()) +
    '\r\nContent-Type: ' + type + '\r\n\r\n');
  const tail = enc.encode('\r\n--' + boundary + '--\r\n');
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0); body.set(bytes, head.length); body.set(tail, head.length + bytes.length);
  const sr = await fetch(`https://api.notion.com/v1/file_uploads/${cj.id}/send`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'multipart/form-data; boundary=' + boundary }, body,
  });
  if (!sr.ok) {
    // 備援:標準 FormData + ASCII 檔名(Notion 顯示名以 create 時的 filename 為準)
    const fd = new FormData();
    fd.append('file', new Blob([bytes], { type }), (asciiName || 'dices').slice(-80));
    const sr2 = await fetch(`https://api.notion.com/v1/file_uploads/${cj.id}/send`, { method: 'POST', headers: H, body: fd });
    if (!sr2.ok) return { error: 'notion file_upload send', status: sr2.status, detail: (await sr2.text()).slice(0, 300) };
  }
  return { id: cj.id };
}
function fileBlock(id, kind, caption) {
  const cap = caption ? [{ type: 'text', text: { content: String(caption).slice(0, 200) } }] : [];
  return { object: 'block', type: kind, [kind]: { type: 'file_upload', file_upload: { id }, caption: cap } };
}
async function notionAppend(token, pageId, children) {
  const ar = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    method: 'PATCH', headers: { 'Authorization': `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
    body: JSON.stringify({ children }),
  });
  if (!ar.ok) return { error: 'notion append', status: ar.status, detail: (await ar.text()).slice(0, 300) };
  return { ok: true };
}
// 舊紀錄:用 Notion 屬性重組一份 MD(前端匯出的格式精簡版)
function mdFromPage(pg) {
  const P = pg.properties || {};
  const txt = k => { const v = P[k]; if (!v) return '';
    if (v.type === 'title') return v.title.map(x => x.plain_text).join('');
    if (v.type === 'rich_text') return v.rich_text.map(x => x.plain_text).join('');
    if (v.type === 'select') return v.select ? v.select.name : '';
    if (v.type === 'multi_select') return v.multi_select.map(x => x.name).join('、');
    if (v.type === 'number') return v.number == null ? '' : String(v.number);
    if (v.type === 'date') return v.date ? v.date.start : '';
    if (v.type === 'url') return v.url || '';
    if (v.type === 'unique_id') return v.unique_id ? (v.unique_id.prefix ? v.unique_id.prefix + '-' : '') + v.unique_id.number : '';
    return ''; };
  const tw = s => { if (!s) return ''; const d = new Date(s); if (isNaN(d)) return s;
    return new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' '); };
  const q = txt('問題') || '(未提問)';
  let uid = '';
  for (const k in P) if (P[k].type === 'unique_id') uid = txt(k);
  const dice = [txt('主骰行星'), txt('主骰星座'), txt('主骰宮位') ? txt('主骰宮位') + '宮' : ''].filter(Boolean).join(' · ');
  const sub = [txt('副骰行星'), txt('副骰星座')].filter(Boolean).join(' · ');
  const L = ['# 🎲 占星骰子判讀', '', '## ❓ 問題', '', q, '', '## 📋 基本資料', ''];
  const row = (k, v) => { if (v) L.push('- **' + k + '**:' + v); };
  row('紀錄編號', uid); row('擲骰時間', tw(txt('時間'))); row('發問時刻', tw(txt('發問時刻')));
  row('議題', txt('議題')); row('其他議題', txt('其他議題'));
  row('主骰', dice); row('副骰', sub); row('推算上升', txt('推算上升')); row('命主星', txt('命主星'));
  row('行運日期', (txt('行運日期') || '').slice(0, 10));
  L.push('');
  const sec = (h, k) => { const v = txt(k); if (v) { L.push('## ' + h, '', v, ''); } };
  sec('🌍 AI 西洋建議', 'AI 西洋建議'); sec('🕉 AI 印度建議', 'AI 印度建議'); sec('🤝 AI 兩派共識建議', 'AI 兩派共識建議');
  L.push('---', '', '> 本檔由 Notion 紀錄屬性補建(舊紀錄當時未存 MD 檔)。來源:https://dices.3minstest.com/');
  const safe = s => String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[\s\-]+/g, '_').slice(0, 30);
  const d = tw(txt('時間') || pg.created_time).slice(2, 10).replace(/-/g, '');
  const name = [d, safe(q) || '未提問', safe([txt('主骰行星'), txt('主骰星座'), txt('主骰宮位') ? txt('主骰宮位') + '宮' : ''].filter(Boolean).join('-')) || '未擲骰'].join('-') + '.md';
  return { md: L.join('\n'), name };
}

// 用 Google 官方端點驗證 token → email(id_token 走 tokeninfo,access_token 走 userinfo)
async function verifyGoogleEmail(token, type) {
  if (!token) return null;
  try {
    if (type === 'access') {
      const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + token } });
      if (!r.ok) return null;
      const u = await r.json();
      return u.email && u.email_verified !== false ? String(u.email).toLowerCase() : null;
    }
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token));
    if (!r.ok) return null;
    const u = await r.json();
    return u.email && String(u.email_verified) !== 'false' ? String(u.email).toLowerCase() : null;
  } catch (e) { return null; }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// Notion rich_text 單一 text 上限 2000 字 → 長內容切成多塊,保留完整版(總上限約 10 塊)
function richText(s, maxTotal = 18000) {
  const str = String(s || '').slice(0, maxTotal);
  if (!str) return [];
  const chunks = [];
  for (let i = 0; i < str.length; i += 1900) chunks.push({ text: { content: str.slice(i, i + 1900) } });
  return chunks;
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
  if (r.aiWest) p['AI 西洋建議'] = { rich_text: richText(r.aiWest) };
  if (r.aiVedic) p['AI 印度建議'] = { rich_text: richText(r.aiVedic) };
  if (r.aiConsensus) p['AI 兩派共識建議'] = { rich_text: richText(r.aiConsensus) };
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
