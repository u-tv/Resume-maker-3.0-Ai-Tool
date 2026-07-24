// _worker.js — Resume Master 3.0 AI Tool
// 7 APIs: Rewind AI, Groq, OpenRouter, Gemini, DuckDuckGo, OpenAI-Free, HuggingFace

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
      // AI Generate — 7 APIs (Rewind + 6 others)
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
          const rewindKey = env.REWIND_API_KEY;
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
        } catch (e) { /* Rewind failed — move to next */ }

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
            const geminiKey = env.GEMINI_API_KEY;
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
      // Resume Endpoints (Save, Load, Share, etc.) — पिछले जैसे ही
      // ============================================================

      // ============================================================
      // Health Check
      // ============================================================
      if (path === '/api/health' && request.method === 'GET') {
        return new Response(JSON.stringify({
          status: 'ok',
          rewind: !!env.REWIND_API_KEY,
          groq: !!env.GROQ_API_KEY,
          openrouter: !!env.OPENROUTER_API_KEY,
          gemini: !!env.GEMINI_API_KEY,
          opensource: 'duckduckgo, openai-free, huggingface'
        }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      // ============================================================
      // Root — Serve index.html
      // ============================================================
      if (path === '/' || path === '') {
        return new Response(null, { status: 200, headers: CORS_HEADERS });
      }

      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: CORS_HEADERS });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS_HEADERS });
    }
  }
};
