/*
  وكيل آمن (Cloudflare Worker) — يحفظ المفاتيح على السيرفر، فلا تظهر في المتصفح أبداً.

  الإعداد:
  1) أنشئ Worker جديد في Cloudflare وألصق هذا الكود.
  2) من Settings > Variables and Secrets أضف:
     - KEYS            (Secret) نص JSON مثل:
        {"groq":["gsk_..."],"google":["AIza..."],"deepseek":["sk-..."],"openai":["sk-..."]}
     - ALLOWED_ORIGIN  (Text)  مثل: https://your-name.github.io
  3) انسخ رابط الـ Worker وضعه في config.js داخل proxy،
     وأضف رابطه أيضاً إلى connect-src في index.html.
*/

const MODELS = {
  groq: { url: "https://api.groq.com/openai/v1/chat/completions", model: "llama-3.3-70b-versatile" },
  deepseek: { url: "https://api.deepseek.com/chat/completions", model: "deepseek-chat" },
  openai: { url: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini" },
};

async function callOpenAICompat(provider, key, messages) {
  const { url, model } = MODELS[provider];
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()).choices[0].message.content;
}

async function callGemini(key, messages) {
  const sys = messages.find((m) => m.role === "system");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: sys ? sys.content : "" }] }, contents }),
    }
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  return d.candidates[0].content.parts.map((p) => p.text).join("");
}

const shuffle = (a) => [...a].sort(() => Math.random() - 0.5);

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });
    if (env.ALLOWED_ORIGIN && request.headers.get("Origin") !== env.ALLOWED_ORIGIN) {
      return new Response("Forbidden", { status: 403, headers: cors });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("Bad request", { status: 400, headers: cors });
    }
    // حدّ أقصى لحجم الطلب لحماية الحساب من الإساءة
    const messages = (Array.isArray(body.messages) ? body.messages : []).slice(-21).map((m) => ({
      role: ["system", "user", "assistant"].includes(m.role) ? m.role : "user",
      content: String(m.content || "").slice(0, 8000),
    }));

    const pools = JSON.parse(env.KEYS || "{}");
    const order = [
      ["groq", pools.groq],
      ["google", pools.google],
      ["deepseek", pools.deepseek],
      ["openai", pools.openai],
    ];

    for (const [name, list] of order) {
      for (const key of shuffle(list || []).slice(0, 3)) {
        try {
          const reply = name === "google"
            ? await callGemini(key, messages)
            : await callOpenAICompat(name, key, messages);
          return Response.json({ reply }, { headers: cors });
        } catch {
          /* جرّب المفتاح أو المزود التالي */
        }
      }
    }
    return Response.json({ reply: "تعذّر الرد الآن، حاول مرة أخرى بعد قليل." }, { headers: cors });
  },
};
