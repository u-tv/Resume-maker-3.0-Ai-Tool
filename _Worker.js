// _worker.js — Resume Master (Production Grade)
// Auto-creates D1 table + KV fallback + 7 AI APIs + SPA Share Routing

export default {
  async fetch(request, env, ctx) {
    const CORS_HEADERS = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const kv = env.MY_KV;
    const db = env.MY_D1;

    // ---------- D1 Table Auto-Init (पहली कॉल पर) ----------
    if (db) {
      ctx.waitUntil((async () => {
        try {
          await db.prepare(
            `CREATE TABLE IF NOT EXISTS resumes (
              id TEXT PRIMARY KEY,
              title TEXT,
              user_id TEXT,
              views INTEGER DEFAULT 0,
              downloads INTEGER DEFAULT 0,
              shares INTEGER DEFAULT 0,
              ats_score INTEGER,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`
          ).run();
          await db.prepare(
            `CREATE INDEX IF NOT EXISTS idx_user_id ON resumes(user_id)`
          ).run();
          await db.prepare(
            `CREATE INDEX IF NOT EXISTS idx_created_at ON resumes(created_at)`
          ).run();
        } catch (_) { /* ignore if already exists */ }
      })());
    }

    // ---------- Static Assets + SPA Fallback ----------
    if (!path.startsWith('/api')) {
      try {
        if (path.startsWith('/share/')) {
          return env.ASSETS.fetch(new Request(new URL('/', request.url), request));
        }
        return await env.ASSETS.fetch(request);
      } catch (_) {
        return new Response('Static asset not found', { status: 404, headers: CORS_HEADERS });
      }
    }

    // ---------- API Routes ----------
    try {
      // ----- Resume Save -----
      if (path === '/api/resume/save' && request.method === 'POST') {
        const data = await request.json().catch(() => null);
        if (!data?.resumeData) return errorResponse('resumeData required', 400);

        const { userId = 'guest', resumeData, title = 'Untitled' } = data;
        const resumeId = `res_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
        const ts = new Date().toISOString();
        const ats = calculateATSScore(resumeData);

        // KV में save
        await kv.put(`resumes:${resumeId}`, JSON.stringify({
          id: resumeId, title, data: resumeData, userId,
          createdAt: ts, updatedAt: ts, views: 0, downloads: 0, shares: 0, atsScore: ats
        }));

        // D1 में भी डालें
        if (db) {
          await db.prepare(
            `INSERT INTO resumes (id, title, user_id, ats_score, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(resumeId, title, userId, ats, ts, ts).run();
        }

        // User list update
        const userKey = `user:${userId}:resumes`;
        let list = await kv.get(userKey);
        let resumes = list ? JSON.parse(list) : [];
        resumes.push(resumeId);
        if (resumes.length > 50) resumes = resumes.slice(-50);
        await kv.put(userKey, JSON.stringify(resumes));

        return jsonResponse({ success: true, id: resumeId });
      }

      // ----- Resume Load -----
      if (path === '/api/resume/load' && request.method === 'GET') {
        const id = url.searchParams.get('id');
        if (!id) return errorResponse('ID required', 400);

        // KV से load करें
        const data = await kv.get(`resumes:${id}`);
        if (!data) return errorResponse('Not found', 404);
        const resume = JSON.parse(data);
        resume.views = (resume.views || 0) + 1;
        resume.updatedAt = new Date().toISOString();
        await kv.put(`resumes:${id}`, JSON.stringify(resume));

        // D1 में view increment
        if (db) {
          await db.prepare(`UPDATE resumes SET views = views + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(id).run();
        }
        return jsonResponse({ success: true, data: resume });
      }

      // ----- Resume List -----
      if (path === '/api/resume/list' && request.method === 'GET') {
        const userId = url.searchParams.get('userId') || 'guest';
        const list = await kv.get(`user:${userId}:resumes`);
        const ids = list ? JSON.parse(list) : [];
        const resumes = [];
        for (const id of ids) {
          const raw = await kv.get(`resumes:${id}`);
          if (raw) {
            const r = JSON.parse(raw);
            resumes.push({ id: r.id, title: r.title, atsScore: r.atsScore, createdAt: r.createdAt, views: r.views });
          }
        }
        return jsonResponse({ success: true, resumes });
      }

      // ----- Resume Delete -----
      if (path === '/api/resume/delete' && request.method === 'DELETE') {
        const id = url.searchParams.get('id');
        const userId = url.searchParams.get('userId') || 'guest';
        if (!id) return errorResponse('ID required', 400);
        await kv.delete(`resumes:${id}`);
        if (db) {
          await db.prepare(`DELETE FROM resumes WHERE id = ?`).bind(id).run();
        }
        const userKey = `user:${userId}:resumes`;
        const list = await kv.get(userKey);
        if (list) {
          const newList = JSON.parse(list).filter(x => x !== id);
          await kv.put(userKey, JSON.stringify(newList));
        }
        return jsonResponse({ success: true });
      }

      // ----- Share Create -----
      if (path === '/api/share' && request.method === 'POST') {
        const body = await request.json().catch(() => null);
        const resumeId = body?.resumeId;
        if (!resumeId) return errorResponse('Resume ID required', 400);
        const exists = await kv.get(`resumes:${resumeId}`);
        if (!exists) return errorResponse('Resume not found', 404);

        const shareId = `share_${Date.now()}_${crypto.randomUUID().slice(0, 10)}`;
        await kv.put(`shares:${shareId}`, JSON.stringify({
          resumeId, createdAt: new Date().toISOString(), views: 0
        }));

        if (db) {
          await db.prepare(`UPDATE resumes SET shares = shares + 1 WHERE id = ?`).bind(resumeId).run();
        }
        return jsonResponse({
          success: true,
          shareId,
          shareLink: `/share/${shareId}`
        });
      }

      // ----- Share Load -----
      if (path === '/api/share' && request.method === 'GET') {
        const shareId = url.searchParams.get('id');
        if (!shareId) return errorResponse('Share ID required', 400);
        const shareData = await kv.get(`shares:${shareId}`);
        if (!shareData) return errorResponse('Share not found', 404);
        const share = JSON.parse(shareData);
        share.views = (share.views || 0) + 1;
        await kv.put(`shares:${shareId}`, JSON.stringify(share));

        const resumeData = await kv.get(`resumes:${share.resumeId}`);
        if (!resumeData) return errorResponse('Resume not found', 404);
        const resume = JSON.parse(resumeData);
        delete resume.data;
        return jsonResponse({ success: true, resume, share });
      }

      // ----- AI Generate (7 APIs) -----
      if (path === '/api/ai/generate' && request.method === 'POST') {
        const body = await request.json().catch(() => null);
        const prompt = body?.prompt?.trim();
        if (!prompt) return errorResponse('Prompt required', 400);

        const cacheKey = `ai:${await sha256(prompt)}`;
        const cached = await kv.get(cacheKey);
        if (cached) return jsonResponse({ response: cached, cached: true });

        let content = null, usedApi = 'Simulated';

        // ---- 7 APIs Fallback ----
        if (!content && env.REWIND_AI_API_KEY) { try { const res = await fetch('https://api.rewind.ai/v1/chat/completions', { method: 'POST', headers: { 'Authorization': `Bearer ${env.REWIND_AI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'rewind-gpt-4', messages: [{ role: 'user', content: prompt }], max_tokens: 1000, temperature: 0.7 }) }); if (res.ok) { const d = await res.json(); content = d.choices?.[0]?.message?.content; usedApi = 'Rewind AI'; } } catch (_) {} }
        if (!content && env.GROQ_API_KEY) { try { const res = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'Authorization': `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'llama3-70b-8192', messages: [{ role: 'user', content: prompt }], max_tokens: 1000, temperature: 0.7 }) }); if (res.ok) { const d = await res.json(); content = d.choices?.[0]?.message?.content; usedApi = 'Groq'; } } catch (_) {} }
        if (!content && env.OPENROUTER_API_KEY) { try { const res = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { 'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'openai/gpt-3.5-turbo', messages: [{ role: 'user', content: prompt }], max_tokens: 1000, temperature: 0.7 }) }); if (res.ok) { const d = await res.json(); content = d.choices?.[0]?.message?.content; usedApi = 'OpenRouter'; } } catch (_) {} }
        if (!content && env.GOOGLE_GEMINI_API_KEY) { try { const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${env.GOOGLE_GEMINI_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) }); if (res.ok) { const d = await res.json(); content = d.candidates?.[0]?.content?.parts?.[0]?.text; usedApi = 'Gemini'; } } catch (_) {} }
        if (!content) { try { const res = await fetch('https://duckduckgo.com/duckchat/v1/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'llama-3-70b', messages: [{ role: 'user', content: prompt }], max_tokens: 1000 }) }); if (res.ok) { const d = await res.json(); content = d.message; usedApi = 'DuckDuckGo'; } } catch (_) {} }
        if (!content) { try { const res = await fetch('https://api.openai-free.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: prompt }], max_tokens: 1000 }) }); if (res.ok) { const d = await res.json(); content = d.choices?.[0]?.message?.content; usedApi = 'OpenAI-Free'; } } catch (_) {} }
        if (!content) { try { const res = await fetch('https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inputs: prompt }) }); if (res.ok) { const d = await res.json(); content = Array.isArray(d) ? d[0]?.generated_text : d; usedApi = 'HuggingFace'; } } catch (_) {} }

        if (!content) content = `✅ AI Response (Simulated): ${prompt.slice(0, 80)}...`;
        await kv.put(cacheKey, content, { expirationTtl: 86400 });
        return jsonResponse({ response: content, cached: false, usedApi });
      }

      // ----- Analytics GET (D1 first) -----
      if (path === '/api/analytics' && request.method === 'GET') {
        const id = url.searchParams.get('id');
        if (!id) return errorResponse('ID required', 400);
        if (db) {
          const result = await db.prepare('SELECT views, downloads, shares, created_at, updated_at FROM resumes WHERE id = ?').bind(id).first();
          if (result) return jsonResponse({ success: true, ...result });
        }
        const data = await kv.get(`resumes:${id}`);
        if (!data) return errorResponse('Not found', 404);
        const r = JSON.parse(data);
        return jsonResponse({ success: true, views: r.views, downloads: r.downloads, shares: r.shares, createdAt: r.createdAt, updatedAt: r.updatedAt });
      }

      // ----- Analytics POST (D1 atomic) -----
      if (path === '/api/analytics' && request.method === 'POST') {
        const body = await request.json().catch(() => null);
        const id = body?.id, type = body?.type;
        if (!id || !type) return errorResponse('ID and type required', 400);

        if (db) {
          await db.prepare(`UPDATE resumes SET ${type}s = ${type}s + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(id).run();
          const result = await db.prepare('SELECT views, downloads, shares FROM resumes WHERE id = ?').bind(id).first();
          return jsonResponse({ success: true, ...result });
        }

        const data = await kv.get(`resumes:${id}`);
        if (!data) return errorResponse('Not found', 404);
        const r = JSON.parse(data);
        if (type === 'view') r.views = (r.views || 0) + 1;
        else if (type === 'download') r.downloads = (r.downloads || 0) + 1;
        else if (type === 'share') r.shares = (r.shares || 0) + 1;
        r.updatedAt = new Date().toISOString();
        await kv.put(`resumes:${id}`, JSON.stringify(r));
        return jsonResponse({ success: true, views: r.views, downloads: r.downloads, shares: r.shares });
      }

      // ----- Health -----
      if (path === '/api/health' && request.method === 'GET') {
        return jsonResponse({ status: 'ok', kv: true, d1: !!db });
      }

      return errorResponse('API not found', 404);
    } catch (error) {
      return errorResponse(error.message, 500);
    }
  }
};

// ---------- HELPERS ----------
function errorResponse(msg, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

function calculateATSScore(data) {
  if (!data || typeof data !== 'object') return 0;
  let s = 0;
  if (data.fullName) s += 10;
  if (data.email) s += 10;
  if (typeof data.summary === 'string' && data.summary.length > 50) s += 20;
  if (Array.isArray(data.experience) ? data.experience.length > 0 : !!data.experience) s += 30;
  const sk = data.skills;
  if (Array.isArray(sk) && sk.length > 3) s += 30;
  else if (typeof sk === 'string' && sk.split(',').filter(Boolean).length > 3) s += 30;
  return Math.min(s, 100);
}

async function sha256(input) {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}
