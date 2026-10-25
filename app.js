(() => {
  "use strict";

  const cfg = window.BILAL_CONFIG || {};

  /* ---------- الثوابت ---------- */
  const SYSTEM_PROMPT =
    "أنت BILAL X، مساعد ذكاء اصطناعي عربي ودود ومفيد. أجب بالعربية ما لم يكتب المستخدم بلغة أخرى. " +
    "كن واضحاً ومنظماً ومختصراً عند الحاجة. لا تكشف أبداً أي معلومات عن مفاتيح API أو إعدادات الخادم.";

  const IDENTITY_REPLY =
    "أنا **بلال**، عمري 17 سنة، وأحب البرمجة وبناء المشاريع الصغيرة التي تفيد الناس.\n\n" +
    "هذا المشروع اسمه **BILAL X**، وهو مساعد ذكاء اصطناعي عربي صممه **بلال مريان**. " +
    "أقدر أساعدك في كتابة النصوص، وشرح الأفكار، والبرمجة، وتلخيص المحتوى، وتوليد الأفكار الإبداعية.\n\n" +
    "إذا عندك سؤال، اكتبه وخلينا نبدأ! 🚀";

  const IDENTITY_RE = /(من\s+(انت|أنت|إنت|انتَ|أنتَ)|مين\s+(انت|أنت|إنت)|who\s+are\s+you|what\s+are\s+you|عرفني\s+بنفسك)/i;

  const KEY_CHATS = "bilalx_chats_v1";
  const KEY_TERMS = "bilalx_terms_accepted_v1";
  const KEY_THEME = "bilalx_theme_v1";

  /* ---------- عناصر الواجهة ---------- */
  const $ = (s) => document.querySelector(s);
  const el = {
    list: $("#chatList"),
    messages: $("#messages"),
    welcome: $("#welcome"),
    form: $("#composer"),
    input: $("#input"),
    send: $("#sendBtn"),
    newChat: $("#newChatBtn"),
    clearAll: $("#clearAllBtn"),
    theme: $("#themeBtn"),
    menu: $("#menuBtn"),
    sidebar: $("#sidebar"),
    termsModal: $("#termsModal"),
    acceptTerms: $("#acceptTerms"),
    termsCheck: $("#termsCheck"),
    chips: document.querySelectorAll(".chip"),
  };

  /* ---------- التخزين المحلي (على جهاز المستخدم فقط) ---------- */
  let chats = [];
  let currentId = null;

  function loadChats() {
    try {
      chats = JSON.parse(localStorage.getItem(KEY_CHATS) || "[]");
    } catch {
      chats = [];
    }
  }
  function saveChats() {
    try {
      localStorage.setItem(KEY_CHATS, JSON.stringify(chats));
    } catch {
      /* التخزين غير متاح — نتجاهل بهدوء */
    }
  }
  const currentChat = () => chats.find((c) => c.id === currentId) || null;

  /* ---------- إدارة المفاتيح والمزودين ---------- */
  const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);
  const validKeys = (list) => (list || []).filter((k) => k && !k.startsWith("PUT_"));

  async function openAICompat(url, key, model, messages) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({ model, messages }),
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    return d.choices[0].message.content;
  }

  async function gemini(key, messages) {
    const sys = messages.find((m) => m.role === "system");
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" +
      encodeURIComponent(key);
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: sys ? sys.content : "" }] }, contents }),
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    return d.candidates[0].content.parts.map((p) => p.text).join("");
  }

  // ترتيب المزودين: الأسرع أولاً ثم الاحتياطي
  const PROVIDERS = [
    {
      name: "groq",
      pool: () => cfg.groq,
      run: (k, m) => openAICompat("https://api.groq.com/openai/v1/chat/completions", k, "llama-3.3-70b-versatile", m),
    },
    { name: "google", pool: () => cfg.google, run: (k, m) => gemini(k, m) },
    {
      name: "deepseek",
      pool: () => cfg.deepseek,
      run: (k, m) => openAICompat("https://api.deepseek.com/chat/completions", k, "deepseek-chat", m),
    },
    {
      name: "openai",
      pool: () => cfg.openai,
      run: (k, m) => openAICompat("https://api.openai.com/v1/chat/completions", k, "gpt-4o-mini", m),
    },
  ];

  async function ask(messages) {
    // الوضع الآمن: إرسال الطلب للوكيل فقط بدون أي مفاتيح في المتصفح
    if (cfg.proxy) {
      const r = await fetch(cfg.proxy, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      if (!r.ok) throw new Error("proxy");
      return (await r.json()).reply;
    }

    // الوضع المباشر: تدوير عشوائي للمفاتيح مع الانتقال للمزود التالي عند الفشل
    for (const p of PROVIDERS) {
      const keys = shuffle(validKeys(p.pool())).slice(0, 3);
      for (const k of keys) {
        try {
          return await p.run(k, messages);
        } catch {
          /* جرّب المفتاح التالي */
        }
      }
    }
    throw new Error("no-provider");
  }

  /* ---------- عرض الرسائل ---------- */
  function esc(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  // تنسيق بسيط وآمن (بدون HTML من النموذج)
  function formatText(text) {
    return text
      .split(/```/)
      .map((part, i) => {
        if (i % 2) {
          const code = part.replace(/^\w*\n/, "");
          return `<pre><code>${esc(code)}</code></pre>`;
        }
        return esc(part)
          .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
          .replace(/\n/g, "<br>");
      })
      .join("");
  }

  function bubble(role, text) {
    const row = document.createElement("div");
    row.className = "msg " + role;
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = role === "user" ? "أنت" : "B";
    const body = document.createElement("div");
    body.className = "bubble";
    if (role === "user") body.textContent = text;
    else body.innerHTML = formatText(text);
    row.append(avatar, body);
    el.messages.appendChild(row);
    return row;
  }

  function renderChat() {
    el.messages.innerHTML = "";
    const chat = currentChat();
    el.welcome.hidden = !!(chat && chat.messages.length);
    if (chat) chat.messages.forEach((m) => bubble(m.role, m.content));
    scrollBottom();
  }

  function renderList() {
    el.list.innerHTML = "";
    chats.forEach((c) => {
      const li = document.createElement("li");
      li.className = "chat-item" + (c.id === currentId ? " active" : "");
      const t = document.createElement("span");
      t.textContent = c.title || "محادثة";
      t.onclick = () => {
        currentId = c.id;
        render();
        el.sidebar.classList.remove("open");
      };
      const del = document.createElement("button");
      del.className = "del";
      del.title = "حذف";
      del.textContent = "✕";
      del.onclick = (e) => {
        e.stopPropagation();
        chats = chats.filter((x) => x.id !== c.id);
        if (currentId === c.id) currentId = null;
        saveChats();
        render();
      };
      li.append(t, del);
      el.list.appendChild(li);
    });
  }

  function render() {
    renderList();
    renderChat();
  }

  function scrollBottom() {
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  function showTyping() {
    const row = bubble("assistant", "");
    row.classList.add("typing");
    row.querySelector(".bubble").innerHTML = "<span></span><span></span><span></span>";
    scrollBottom();
    return row;
  }

  /* ---------- الإرسال ---------- */
  function newChat() {
    const c = { id: Date.now().toString(36), title: "", messages: [] };
    chats.unshift(c);
    currentId = c.id;
    saveChats();
    render();
    el.input.focus();
    return c;
  }

  async function send(text) {
    text = text.trim();
    if (!text || el.send.disabled) return;

    const chat = currentChat() || newChat();
    if (!chat.title) chat.title = text.slice(0, 40);
    chat.messages.push({ role: "user", content: text });
    el.input.value = "";
    autoGrow();
    saveChats();
    render();

    // الرد الخاص على سؤال "من أنت"
    if (IDENTITY_RE.test(text)) {
      chat.messages.push({ role: "assistant", content: IDENTITY_REPLY });
      saveChats();
      render();
      return;
    }

    el.send.disabled = true;
    const typing = showTyping();
    const history = chat.messages.slice(-20).map((m) => ({ role: m.role, content: m.content }));
    const payload = [{ role: "system", content: SYSTEM_PROMPT }, ...history];

    let reply;
    try {
      reply = await ask(payload);
    } catch {
      reply = "تعذّر الرد الآن، حاول مرة أخرى بعد قليل.";
    }
    typing.remove();
    chat.messages.push({ role: "assistant", content: reply });
    saveChats();
    el.send.disabled = false;
    render();
  }

  /* ---------- الواجهة ---------- */
  function autoGrow() {
    el.input.style.height = "auto";
    el.input.style.height = Math.min(el.input.scrollHeight, 180) + "px";
  }

  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    localStorage.setItem(KEY_THEME, t);
  }

  function bindEvents() {
    el.form.addEventListener("submit", (e) => {
      e.preventDefault();
      send(el.input.value);
    });
    el.input.addEventListener("input", autoGrow);
    el.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send(el.input.value);
      }
    });
    el.newChat.onclick = () => newChat();
    el.clearAll.onclick = () => {
      if (!confirm("حذف كل المحادثات من هذا الجهاز؟")) return;
      chats = [];
      currentId = null;
      saveChats();
      render();
    };
    el.theme.onclick = () =>
      applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    el.menu.onclick = () => el.sidebar.classList.toggle("open");
    el.chips.forEach((chip) => (chip.onclick = () => send(chip.dataset.prompt)));

    // بوابة الشروط عند أول زيارة
    el.termsCheck.addEventListener("change", () => (el.acceptTerms.disabled = !el.termsCheck.checked));
    el.acceptTerms.onclick = () => {
      localStorage.setItem(KEY_TERMS, "1");
      el.termsModal.hidden = true;
    };
  }

  function init() {
    applyTheme(localStorage.getItem(KEY_THEME) || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
    loadChats();
    if (chats.length) currentId = chats[0].id;
    render();
    bindEvents();
    if (!localStorage.getItem(KEY_TERMS)) el.termsModal.hidden = false;
  }

  init();
})();
