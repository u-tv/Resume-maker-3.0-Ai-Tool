// _worker.js — Resume Master 3.0 AI Tool
// 7 APIs: Rewind AI, Groq, OpenRouter, Gemini, DuckDuckGo, OpenAI-Free, HuggingFace
// Root (/) Fix — White Page ठीक करने के लिए

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

    try {
      // ============================================================
      // ROOT (/) — index.html लोड करने के लिए (White Page Fix)
      // ============================================================
      if (path === '/' || path === '') {
        // Cloudflare Pages अपने आप index.html serve करता है
        // हम बस 200 OK रिटर्न करते हैं ताकि वह अपना काम कर सके
        return new Response(null, { status: 200, headers: CORS_HEADERS });
      }

      // ============================================================
      // 1. Resume Save (KV)
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
      // 2. Resume Load (KV)
      // ============================================================
      if (path === '/api/resume/load' && request.method === 'GET') {
        const id = url.searchParams.get('id');
        if (!id) return new Response(JSON.stringify({ error: 'ID required' }), { status: 400 });

        const data = await kv.get(`resumes:${id}`);
        if (!data) return new Response(JSON.stringify({ error: 'Resume not found' }), { status: 404 });

        const resume = JSON.parse(data);
        resume.views = (resume.views || 0) + 1;
        await kv.put(`resumes:${id}`, JSON.stringify(resume));

        return new Response(JSON.stringify({ success: true, data: resume }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      // ============================================================
      // 3. Resume List (KV)
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
      // 4. Resume Delete (KV)
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
      // 5. Share Link (KV)
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
      // 6. Share Load (KV)
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
        delete resume.data;

        return new Response(JSON.stringify({ success: true, resume, share }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      // ============================================================
      // 7. AI Generate — 7 APIs (Rewind + 6 others)
      // ============================================================
      if (path === '/api/ai/generate' && request.method === 'POST') {
        const { prompt } = await request.json();
        if (!prompt) return new Response(JSON.stringify({ error: 'Prompt required' }), { status: 400 });

        // KV Cache Check
        const cacheKey = `ai:${prompt.substring(0, 50)}`;
        const cached = await kv.get(cacheKey);
        if (cached) {
          return new Response(JSON.stringify({ response: cached, cached: true }), {
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
          });
        }

        let content = null;
        let usedApi = 'Simulated';

        // --- 1. Try Rewind AI (Keyed) ---
        try {
          const rewindKey = env.REWIND_AI_API_KEY;
          if (rewindKey) {
            const rewindRes = await fetch('https://api.rewind.ai/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${rewindKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                model: 'rewind-gpt-4',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 1000,
                temperature: 0.7
              })
            });
            if (rewindRes.ok) {
              const data = await rewindRes.json();
              content = data.choices[0].message.content;
              usedApi = 'Rewind AI';
            }
          }
        } catch (e) { /* Rewind failed */ }

        // --- 2. Try Groq (Keyed) ---
        if (!content) {
          try {
            const groqKey = env.GROQ_API_KEY;
            if (groqKey) {
              const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${groqKey}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  model: 'llama3-70b-8192',
                  messages: [{ role: 'user', content: prompt }],
                  max_tokens: 1000,
                  temperature: 0.7
                })
              });
              if (groqRes.ok) {
                const data = await groqRes.json();
                content = data.choices[0].message.content;
                usedApi = 'Groq';
              }
            }
          } catch (e) { /* Groq failed */ }
        }

        // --- 3. Try OpenRouter (Keyed) ---
        if (!content) {
          try {
            const orKey = env.OPENROUTER_API_KEY;
            if (orKey) {
              const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${orKey}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  model: 'openai/gpt-3.5-turbo',
                  messages: [{ role: 'user', content: prompt }],
                  max_tokens: 1000,
                  temperature: 0.7
                })
              });
              if (orRes.ok) {
                const data = await orRes.json();
                content = data.choices[0].message.content;
                usedApi = 'OpenRouter';
              }
            }
          } catch (e) { /* OpenRouter failed */ }
        }

        // --- 4. Try Gemini (Keyed) ---
        if (!content) {
          try {
            const geminiKey = env.GOOGLE_GEMINI_API_KEY;
            if (geminiKey) {
              const geminiRes = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${geminiKey}`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                }
              );
              if (geminiRes.ok) {
                const data = await geminiRes.json();
                content = data.candidates[0].content.parts[0].text;
                usedApi = 'Gemini';
              }
            }
          } catch (e) { /* Gemini failed */ }
        }

        // --- 5. Try DuckDuckGo (Open Source — No Key) ---
        if (!content) {
          try {
            const ddgRes = await fetch('https://duckduckgo.com/duckchat/v1/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: 'llama-3-70b',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 1000
              })
            });
            if (ddgRes.ok) {
              const data = await ddgRes.json();
              content = data.message;
              usedApi = 'DuckDuckGo';
            }
          } catch (e) { /* DDG failed */ }
        }

        // --- 6. Try OpenAI-Free (Open Source — No Key) ---
        if (!content) {
          try {
            const freeRes = await fetch('https://api.openai-free.com/v1/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 1000
              })
            });
            if (freeRes.ok) {
              const data = await freeRes.json();
              content = data.choices[0].message.content;
              usedApi = 'OpenAI-Free';
            }
          } catch (e) { /* Free API failed */ }
        }

        // --- 7. Try Hugging Face (Open Source — No Key) ---
        if (!content) {
          try {
            const hfRes = await fetch('https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.3', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ inputs: prompt })
            });
            if (hfRes.ok) {
              const data = await hfRes.json();
              content = Array.isArray(data) ? data[0].generated_text : data;
              usedApi = 'HuggingFace';
            }
          } catch (e) { /* HF failed */ }
        }

        // --- Final Fallback (Simulated) ---
        if (!content) {
          content = `✅ AI Response (Simulated): ${prompt.substring(0, 50)}...`;
          usedApi = 'Simulated';
        }

        // Cache and Return
        await kv.put(cacheKey, content, { expirationTtl: 86400 });
        return new Response(JSON.stringify({ response: content, cached: false, usedApi }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      // ============================================================
      // 8. Health Check
      // ============================================================
      if (path === '/api/health' && request.method === 'GET') {
        return new Response(JSON.stringify({
          status: 'ok',
          rewind: !!env.REWIND_AI_API_KEY,
          groq: !!env.GROQ_API_KEY,
          openrouter: !!env.OPENROUTER_API_KEY,
          gemini: !!env.GOOGLE_GEMINI_API_KEY,
          opensource: 'duckduckgo, openai-free, huggingface'
        }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      // ============================================================
      // 9. 404 — Not Found
      // ============================================================
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: CORS_HEADERS });

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS_HEADERS });
    }
  }
};

// ============================================================
// Helper Function
// ============================================================

function calculateATSScore(data) {
  let score = 0;
  if (data.fullName) score += 10;
  if (data.email) score += 10;
  if (data.summary && data.summary.length > 50) score += 20;
  if (data.experience && data.experience.length > 0) score += 30;
  if (data.skills && data.skills.split(',').length > 3) score += 30;
  return Math.min(score, 100);
}
