// _worker.js - Resume Master 3.0 AI Tool Backend
// KV: MY_KV (ID: de9fa6e9800a45e9a5d5ad8c24cbe3fd)
// कोई D1 नहीं, सब कुछ KV में

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
    const kv = env.MY_KV; // आपका KV बाइंडिंग

    try {
      // ============================================================
      // 1. Resume Save (KV) – POST /api/resume/save
      // ============================================================
      if (path === '/api/resume/save' && request.method === 'POST') {
        const data = await request.json();
        const { userId, resumeData, title } = data;
        const resumeId = `resume_${Date.now()}_${Math.random().toString(36).substring(2,8)}`;
        const timestamp = new Date().toISOString();

        await kv.put(`resumes:${resumeId}`, JSON.stringify({
          id: resumeId,
          title: title || 'Untitled Resume',
          data: resumeData,
          userId: userId || 'guest',
          createdAt: timestamp,
          updatedAt: timestamp,
          views: 0,
          downloads: 0,
          atsScore: calculateATSScore(resumeData)
        }));

        // User list update
        const userKey = `user:${userId || 'guest'}:resumes`;
        let userList = await kv.get(userKey);
        let resumes = userList ? JSON.parse(userList) : [];
        resumes.push(resumeId);
        if (resumes.length > 50) resumes = resumes.slice(-50);
        await kv.put(userKey, JSON.stringify(resumes));

        return new Response(JSON.stringify({ success: true, id: resumeId }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      // ============================================================
      // 2. Resume Load (KV) – GET /api/resume/load?id=xxx
      // ============================================================
      if (path === '/api/resume/load' && request.method === 'GET') {
        const id = url.searchParams.get('id');
        if (!id) return new Response(JSON.stringify({ error: 'ID required' }), { status: 400 });
        const data = await kv.get(`resumes:${id}`);
        if (!data) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
        const resume = JSON.parse(data);
        resume.views = (resume.views || 0) + 1;
        await kv.put(`resumes:${id}`, JSON.stringify(resume));
        return new Response(JSON.stringify({ success: true, data: resume }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      // ============================================================
      // 3. Resume List (KV) – GET /api/resume/list
      // ============================================================
      if (path === '/api/resume/list' && request.method === 'GET') {
        const userId = url.searchParams.get('userId') || 'guest';
        const userKey = `user:${userId || 'guest'}:resumes`;
        const userList = await kv.get(userKey);
        const resumeIds = userList ? JSON.parse(userList) : [];
        const resumes = [];
        for (const id of resumeIds) {
          const data = await kv.get(`resumes:${id}`);
          if (data) {
            const res = JSON.parse(data);
            resumes.push({
              id: res.id,
              title: res.title,
              atsScore: res.atsScore,
              createdAt: res.createdAt,
              views: res.views
            });
          }
        }
        return new Response(JSON.stringify({ success: true, resumes }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      // ============================================================
      // 4. Resume Delete (KV) – DELETE /api/resume/delete?id=xxx
      // ============================================================
      if (path === '/api/resume/delete' && request.method === 'DELETE') {
        const id = url.searchParams.get('id');
        const userId = url.searchParams.get('userId') || 'guest';
        if (!id) return new Response(JSON.stringify({ error: 'ID required' }), { status: 400 });
        await kv.delete(`resumes:${id}`);
        const userKey = `user:${userId}:resumes`;
        const userList = await kv.get(userKey);
        if (userList) {
          let resumes = JSON.parse(userList);
          resumes = resumes.filter(resId => resId !== id);
          await kv.put(userKey, JSON.stringify(resumes));
        }
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      // ============================================================
      // 5. ATS Score (KV) – GET /api/resume/ats?id=xxx
      // ============================================================
      if (path === '/api/resume/ats' && request.method === 'GET') {
        const id = url.searchParams.get('id');
        if (!id) return new Response(JSON.stringify({ error: 'ID required' }), { status: 400 });
        const data = await kv.get(`resumes:${id}`);
        if (!data) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
        const resume = JSON.parse(data);
        return new Response(JSON.stringify({
          success: true,
          atsScore: resume.atsScore || 0,
          sections: Object.keys(resume.data || {}).length
        }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
      }

      // ============================================================
      // 6. Share Link (KV) – POST /api/share
      // ============================================================
      if (path === '/api/share' && request.method === 'POST') {
        const { resumeId } = await request.json();
        if (!resumeId) return new Response(JSON.stringify({ error: 'Resume ID required' }), { status: 400 });
        const shareId = `share_${Date.now()}_${Math.random().toString(36).substring(2,10)}`;
        await kv.put(`shares:${shareId}`, JSON.stringify({
          resumeId,
          createdAt: new Date().toISOString(),
          views: 0
        }));
        const shareLink = `/${shareId}`;
        return new Response(JSON.stringify({ success: true, shareId, shareLink }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      // ============================================================
      // 7. Share Load (KV) – GET /api/share?id=xxx
      // ============================================================
      if (path === '/api/share' && request.method === 'GET') {
        const shareId = url.searchParams.get('id');
        if (!shareId) return new Response(JSON.stringify({ error: 'Share ID required' }), { status: 400 });
        const shareData = await kv.get(`shares:${shareId}`);
        if (!shareData) return new Response(JSON.stringify({ error: 'Share not found' }), { status: 404 });
        const share = JSON.parse(shareData);
        share.views = (share.views || 0) + 1;
        await kv.put(`shares:${shareId}`, JSON.stringify(share));
        const resumeData = await kv.get(`resumes:${share.resumeId}`);
        if (!resumeData) return new Response(JSON.stringify({ error: 'Resume not found' }), { status: 404 });
        const resume = JSON.parse(resumeData);
        delete resume.data; // Security
        return new Response(JSON.stringify({ success: true, resume, share }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      // ============================================================
      // 8. AI Generate (OpenAI) – POST /api/ai/generate
      // ============================================================
      if (path === '/api/ai/generate' && request.method === 'POST') {
        const { prompt } = await request.json();
        if (!prompt) return new Response(JSON.stringify({ error: 'Prompt required' }), { status: 400 });
        const key = env.OPENAI_API_KEY;
        if (!key) {
          // Fallback: सिम्युलेटेड AI (बिना API key के भी काम करेगा)
          return new Response(JSON.stringify({ 
            response: `[Simulated AI] ${prompt.substring(0,50)}... (OpenAI key missing)`,
            cached: false
          }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
        }
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 500,
            temperature: 0.7
          })
        });
        if (!resp.ok) throw new Error('OpenAI API error');
        const json = await resp.json();
        return new Response(JSON.stringify({ 
          response: json.choices[0].message.content,
          cached: false
        }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
      }

      // ============================================================
      // 9. PDF Export (KV) – POST /api/pdf
      // ============================================================
      if (path === '/api/pdf' && request.method === 'POST') {
        const { html, filename, resumeId } = await request.json();
        if (!html) return new Response(JSON.stringify({ error: 'HTML required' }), { status: 400 });
        const pdfBase64 = btoa(html); // सिम्पल PDF (रियल में jsPDF से)
        if (resumeId) {
          await kv.put(`pdf:${resumeId}`, JSON.stringify({ resumeId, pdfData: pdfBase64, filename: filename || 'resume.pdf', createdAt: new Date().toISOString() }));
        }
        return new Response(JSON.stringify({ success: true, pdfData: pdfBase64 }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      // ============================================================
      // 10. Health Check – GET /api/health
      // ============================================================
      if (path === '/api/health' && request.method === 'GET') {
        return new Response(JSON.stringify({
          status: 'ok',
          kv: 'connected',
          ai: env.OPENAI_API_KEY ? 'configured' : 'not configured'
        }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
      }

      // 404
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: CORS_HEADERS });

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS_HEADERS });
    }
  }
};

// ============================================================
// Helper Functions
// ============================================================

function calculateATSScore(data) {
  // सिम्पल ATS स्कोर (कस्टमाइज़ कर सकते हैं)
  let score = 0;
  if (data.fullName) score += 10;
  if (data.email) score += 10;
  if (data.summary && data.summary.length > 50) score += 20;
  if (data.experience && data.experience.length > 0) score += 30;
  if (data.skills && data.skills.split(',').length > 3) score += 30;
  return Math.min(score, 100);
}
