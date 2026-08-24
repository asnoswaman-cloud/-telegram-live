import TelegramBot from "node-telegram-bot-api";
import { spawn } from "child_process";
import fs from "fs";

const TOKEN = "8826608464:AAGJC_p_0uLvnMFfD-dR5HVKlY04bABOOmU";

if (!TOKEN || TOKEN === "ضع_توكن_جديد_هنا") {
  console.error("❌ ضع توكن Telegram في TOKEN");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, {
  polling: true
});

const streams = new Map();
const sessions = new Map();

function maskKey(key) {
  if (!key) return "******";
  if (key.length <= 8) return "******";
  return `${key.slice(0, 4)}***${key.slice(-4)}`;
}

function getDuration(start) {
  const sec = Math.floor((Date.now() - start) / 1000);

  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;

  return `${h}س ${m}د ${s}ث`;
}

function mainKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🚀 Solo", callback_data: "solo" },
        { text: "👥 Group", callback_data: "group" }
      ],
      [
        { text: "⛔ إيقاف بث", callback_data: "stop_menu" },
        { text: "🔑 إيقاف بالمفتاح", callback_data: "stop_key" }
      ],
      [
        { text: "📊 حالة البثوث", callback_data: "status_all" },
        { text: "🔎 حالة بث", callback_data: "status_key" }
      ],
      [
        { text: "🌐 فحص الرابط", callback_data: "check_url" }
      ],
      [
        { text: "🛑 إيقاف الكل", callback_data: "stop_all" }
      ]
    ]
  };
}

function sendMenu(chatId) {
  return bot.sendMessage(
    chatId,
    "⚡ *DARK STREAM BOT*\n\nاختر العملية:",
    {
      parse_mode: "Markdown",
      reply_markup: mainKeyboard()
    }
  );
}

bot.onText(/^\/start$/, async (msg) => {
  sessions.delete(msg.from.id);
  await sendMenu(msg.chat.id);
});

// =====================================================
// الأزرار
// =====================================================

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;

  try {
    await bot.answerCallbackQuery(query.id);
  } catch {}

  if (query.data === "solo") {
    sessions.set(userId, {
      type: "solo",
      step: "name",
      chatId
    });

    return bot.sendMessage(
      chatId,
      "🚀 *SOLO*\n\n📛 أرسل اسم البث:",
      { parse_mode: "Markdown" }
    );
  }

  if (query.data === "group") {
    sessions.set(userId, {
      type: "group",
      step: "count",
      chatId,
      count: 0,
      current: 1
    });

    return bot.sendMessage(
      chatId,
      "👥 *GROUP*\n\n🔢 كم عدد البثوث التي تريد تشغيلها؟\n\nأرسل رقمًا مثل: `3`",
      { parse_mode: "Markdown" }
    );
  }

  if (query.data === "stop_menu") {
    return showStopMenu(chatId);
  }

  if (query.data === "stop_key") {
    sessions.set(userId, {
      type: "stop_key",
      step: "key",
      chatId
    });

    return bot.sendMessage(
      chatId,
      "🔑 أرسل مفتاح Facebook للبث الذي تريد إيقافه:"
    );
  }

  if (query.data === "status_all") {
    return showStatus(chatId);
  }

  if (query.data === "status_key") {
    sessions.set(userId, {
      type: "status_key",
      step: "key",
      chatId
    });

    return bot.sendMessage(
      chatId,
      "🔎 أرسل مفتاح Facebook:"
    );
  }

  if (query.data === "check_url") {
    sessions.set(userId, {
      type: "check_url",
      step: "url",
      chatId
    });

    return bot.sendMessage(
      chatId,
      "🌐 أرسل رابط البث لفحصه بواسطة FFprobe:"
    );
  }

  if (query.data === "stop_all") {
    return stopAll(chatId);
  }

  if (query.data.startsWith("stop:")) {
    const id = query.data.substring(5);
    return stopStream(chatId, id);
  }
});

// =====================================================
// استقبال الرسائل
// =====================================================

bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;

  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  const session = sessions.get(userId);

  if (!session) return;

  // ===================================================
  // SOLO
  // ===================================================

  if (session.type === "solo") {

    if (session.step === "name") {
      session.name = text;
      session.step = "key";

      return bot.sendMessage(
        chatId,
        `📛 الاسم: ${text}\n\n🔑 أرسل مفتاح Facebook:`
      );
    }

    if (session.step === "key") {
      session.key = text;
      session.step = "url";

      return bot.sendMessage(
        chatId,
        `🔑 المفتاح: ${maskKey(text)}\n\n🔗 أرسل رابط البث:`
      );
    }

    if (session.step === "url") {
      sessions.delete(userId);

      const result = await startStream({
        chatId,
        userId,
        name: session.name,
        key: session.key,
        url: text
      });

      return bot.sendMessage(chatId, result);
    }
  }

  // ===================================================
  // GROUP - العدد
  // ===================================================

  if (session.type === "group") {

    if (session.step === "count") {

      const count = Number(text);

      if (
        !Number.isInteger(count) ||
        count < 1 ||
        count > 50
      ) {
        return bot.sendMessage(
          chatId,
          "❌ أرسل رقمًا صحيحًا من 1 إلى 50."
        );
      }

      session.count = count;
      session.current = 1;
      session.step = "name";

      return bot.sendMessage(
        chatId,
        `👥 *GROUP*\n\n📊 عدد البثوث: ${count}\n\n📡 البث 1 من ${count}\n\n📛 أرسل اسم البث:`,
        { parse_mode: "Markdown" }
      );
    }

    if (session.step === "name") {

      session.name = text;
      session.step = "key";

      return bot.sendMessage(
        chatId,
        `📡 البث ${session.current} من ${session.count}\n\n📛 ${text}\n\n🔑 أرسل مفتاح Facebook:`
      );
    }

    if (session.step === "key") {

      session.key = text;
      session.step = "url";

      return bot.sendMessage(
        chatId,
        `📡 البث ${session.current} من ${session.count}\n\n🔑 ${maskKey(text)}\n\n🔗 أرسل رابط البث:`
      );
    }

    if (session.step === "url") {

      const result = await startStream({
        chatId,
        userId,
        name: session.name,
        key: session.key,
        url: text
      });

      if (session.current >= session.count) {

        sessions.delete(userId);

        return bot.sendMessage(
          chatId,
          `${result}\n\n👥 *تم الانتهاء من Group*\n\n📊 تم إدخال ${session.count} بث.`,
          {
            parse_mode: "Markdown",
            reply_markup: mainKeyboard()
          }
        );
      }

      session.current++;
      session.step = "name";

      return bot.sendMessage(
        chatId,
        `${result}\n\n━━━━━━━━━━━━━━\n\n📡 البث ${session.current} من ${session.count}\n\n📛 أرسل اسم البث:`,
        { parse_mode: "Markdown" }
      );
    }
  }

  // ===================================================
  // إيقاف بالمفتاح
  // ===================================================

  if (
    session.type === "stop_key" &&
    session.step === "key"
  ) {
    sessions.delete(userId);
    return stopByKey(chatId, text);
  }

  // ===================================================
  // حالة مفتاح
  // ===================================================

  if (
    session.type === "status_key" &&
    session.step === "key"
  ) {
    sessions.delete(userId);
    return statusByKey(chatId, text);
  }

  // ===================================================
  // فحص الرابط
  // ===================================================

  if (
    session.type === "check_url" &&
    session.step === "url"
  ) {
    sessions.delete(userId);
    return checkUrl(chatId, text);
  }
});

// =====================================================
// تشغيل البث
// =====================================================

async function startStream({
  chatId,
  userId,
  name,
  key,
  url
}) {

  name = name.trim();
  key = key.trim();
  url = url.trim();

  if (!name || !key || !url) {
    return "❌ الاسم أو المفتاح أو الرابط ناقص.";
  }

  if (!/^https?:\/\//i.test(url)) {
    return "❌ الرابط يجب أن يبدأ بـ http:// أو https://";
  }

  if (streams.has(key)) {
    return `⚠️ يوجد بث يعمل بهذا المفتاح:\n${maskKey(key)}`;
  }

  // فحص المصدر أولًا
  const probe = await probeUrl(url);

  if (!probe.ok) {
    return `❌ لم يتم تشغيل البث.\n\n🌐 فشل فحص المصدر:\n${probe.error}`;
  }

  const target =
    `rtmps://live-api-s.facebook.com:443/rtmp/${key}`;

  const isMp4 =
    /\.mp4(?:\?|$)/i.test(url);

  const args = [];

  if (isMp4) {
    args.push("-stream_loop", "-1");
  }

  args.push(
    "-re",
    "-nostdin",
    "-i",
    url,
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-f",
    "flv",
    target
  );

  const process = spawn(
    "ffmpeg",
    args,
    {
      stdio: [
        "ignore",
        "ignore",
        "pipe"
      ]
    }
  );

  const id =
    `${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 8)}`;

  let lastError = "";

  process.stderr.on("data", (data) => {
    lastError += data.toString();

    if (lastError.length > 5000) {
      lastError = lastError.slice(-5000);
    }

    try {
      fs.appendFileSync(
        "stream.log",
        data.toString()
      );
    } catch {}
  });

  process.on("error", (error) => {
    console.error(
      `FFmpeg error ${name}:`,
      error.message
    );
  });

  process.on("close", (code) => {

    console.log(
      `Stream stopped: ${name}, code=${code}`
    );

    streams.delete(key);

    try {
      fs.appendFileSync(
        "stream.log",
        `\n[STOP] ${name} code=${code}\n`
      );
    } catch {}
  });

  streams.set(key, {
    id,
    name,
    key,
    url,
    userId,
    chatId,
    process,
    startTime: Date.now(),
    isMp4
  });

  return `
✅ *تم تشغيل البث*

📛 الاسم:
${name}

🔑 المفتاح:
${maskKey(key)}

🔴 الحالة:
يعمل

${
  isMp4
    ? "🔁 MP4: تكرار تلقائي"
    : "🎬 المصدر: مباشر"
}
`;
}

// =====================================================
// FFPROBE - فحص حقيقي للرابط
// =====================================================

function probeUrl(url) {

  return new Promise((resolve) => {

    const args = [
      "-v",
      "error",
      "-show_entries",
      "format=format_name,duration",
      "-show_entries",
      "stream=codec_type,codec_name",
      "-of",
      "json",
      "-i",
      url
    ];

    const probe = spawn(
      "ffprobe",
      args,
      {
        stdio: [
          "ignore",
          "pipe",
          "pipe"
        ]
      }
    );

    let stdout = "";
    let stderr = "";

    probe.stdout.on(
      "data",
      (data) => {
        stdout += data.toString();
      }
    );

    probe.stderr.on(
      "data",
      (data) => {
        stderr += data.toString();
      }
    );

    const timer = setTimeout(() => {

      try {
        probe.kill("SIGKILL");
      } catch {}

      resolve({
        ok: false,
        error: "انتهت مهلة فحص الرابط."
      });

    }, 15000);

    probe.on("error", (error) => {

      clearTimeout(timer);

      if (
        error.code === "ENOENT"
      ) {
        resolve({
          ok: false,
          error:
            "FFprobe غير مثبت على السيرفر."
        });
        return;
      }

      resolve({
        ok: false,
        error: error.message
      });
    });

    probe.on("close", (code) => {

      clearTimeout(timer);

      if (code === 0) {

        let data = null;

        try {
          data = JSON.parse(stdout);
        } catch {}

        const streamsFound =
          data?.streams || [];

        if (streamsFound.length === 0) {

          resolve({
            ok: false,
            error:
              "الرابط استجاب لكن لم يجد FFprobe أي Stream."
          });

          return;
        }

        resolve({
          ok: true,
          data
        });

        return;
      }

      const error =
        stderr
          .replace(/\s+/g, " ")
          .trim();

      resolve({
        ok: false,
        error:
          error ||
          `FFprobe انتهى بالرمز ${code}`
      });
    });
  });
}

// =====================================================
// فحص الرابط من البوت
// =====================================================

async function checkUrl(chatId, url) {

  await bot.sendMessage(
    chatId,
    "🔎 جاري فحص الرابط بواسطة FFprobe..."
  );

  const result =
    await probeUrl(url);

  if (!result.ok) {

    return bot.sendMessage(
      chatId,
      `
❌ *الرابط لم ينجح في الفحص*

🌐 الرابط:
${url}

⚠️ السبب:
${result.error}
`,
      {
        parse_mode: "Markdown"
      }
    );
  }

  const streamList =
    result.data.streams
      .map(
        s =>
          `${s.codec_type || "unknown"} : ${s.codec_name || "unknown"}`
      )
      .join("\n");

  return bot.sendMessage(
    chatId,
    `
✅ *الرابط صالح لـ FFprobe*

🌐 الرابط:
${url}

🎬 Streams:

${streamList}
`,
    {
      parse_mode: "Markdown"
    }
  );
}

// =====================================================
// حالة جميع البثوث
// =====================================================

function showStatus(chatId) {

  if (streams.size === 0) {

    return bot.sendMessage(
      chatId,
      "📊 لا توجد بثوث نشطة."
    );
  }

  let text =
    "📊 *البثوث النشطة*\n\n";

  let i = 1;

  for (const stream of streams.values()) {

    text +=
      `${i}. 🔴 *${stream.name}*\n` +
      `🔑 ${maskKey(stream.key)}\n` +
      `⏱ ${getDuration(stream.startTime)}\n` +
      `${stream.isMp4 ? "🔁 MP4 Loop" : "🎬 Live"}\n\n`;

    i++;
  }

  return bot.sendMessage(
    chatId,
    text,
    {
      parse_mode: "Markdown",
      reply_markup: mainKeyboard()
    }
  );
}

// =====================================================
// قائمة الإيقاف
// =====================================================

function showStopMenu(chatId) {

  if (streams.size === 0) {

    return bot.sendMessage(
      chatId,
      "⛔ لا توجد بثوث نشطة."
    );
  }

  const buttons = [];

  for (const stream of streams.values()) {

    buttons.push([
      {
        text: `⛔ ${stream.name}`,
        callback_data: `stop:${stream.id}`
      }
    ]);
  }

  return bot.sendMessage(
    chatId,
    "⛔ اختر البث الذي تريد إيقافه:",
    {
      reply_markup: {
        inline_keyboard: buttons
      }
    }
  );
}

// =====================================================
// إيقاف ID
// =====================================================

function stopStream(chatId, id) {

  let found = null;

  for (const stream of streams.values()) {

    if (stream.id === id) {
      found = stream;
      break;
    }
  }

  if (!found) {

    return bot.sendMessage(
      chatId,
      "❌ البث غير موجود أو تم إيقافه."
    );
  }

  try {
    found.process.kill("SIGTERM");
  } catch {}

  streams.delete(found.key);

  return bot.sendMessage(
    chatId,
    `
🛑 *تم إيقاف البث*

📛 ${found.name}

🔑 ${maskKey(found.key)}
`,
    {
      parse_mode: "Markdown",
      reply_markup: mainKeyboard()
    }
  );
}

// =====================================================
// إيقاف بالمفتاح
// =====================================================

function stopByKey(chatId, key) {

  const stream = streams.get(key);

  if (!stream) {

    return bot.sendMessage(
      chatId,
      `⚪ لا يوجد بث يعمل بهذا المفتاح:\n${maskKey(key)}`
    );
  }

  try {
    stream.process.kill("SIGTERM");
  } catch {}

  streams.delete(key);

  return bot.sendMessage(
    chatId,
    `
🛑 *تم إيقاف البث*

📛 ${stream.name}

🔑 ${maskKey(key)}
`,
    {
      parse_mode: "Markdown",
      reply_markup: mainKeyboard()
    }
  );
}

// =====================================================
// حالة مفتاح
// =====================================================

function statusByKey(chatId, key) {

  const stream = streams.get(key);

  if (!stream) {

    return bot.sendMessage(
      chatId,
      `
⚪ *البث غير نشط*

🔑 ${maskKey(key)}
`,
      {
        parse_mode: "Markdown"
      }
    );
  }

  return bot.sendMessage(
    chatId,
    `
🔴 *البث يعمل*

📛 ${stream.name}

🔑 ${maskKey(stream.key)}

⏱ ${getDuration(stream.startTime)}

${
  stream.isMp4
    ? "🔁 MP4 Loop: ON"
    : "🎬 Live"
}
`,
    {
      parse_mode: "Markdown"
    }
  );
}

// =====================================================
// إيقاف الكل
// =====================================================

function stopAll(chatId) {

  if (streams.size === 0) {

    return bot.sendMessage(
      chatId,
      "🛑 لا توجد بثوث نشطة."
    );
  }

  const count = streams.size;

  for (const stream of streams.values()) {

    try {
      stream.process.kill("SIGTERM");
    } catch {}
  }

  streams.clear();

  return bot.sendMessage(
    chatId,
    `
🛑 *تم إيقاف جميع البثوث*

📊 العدد:
${count}
`,
    {
      parse_mode: "Markdown",
      reply_markup: mainKeyboard()
    }
  );
}

// =====================================================
// أخطاء Telegram
// =====================================================

bot.on("polling_error", (error) => {
  console.error(
    "Telegram polling error:",
    error.message
  );
});

console.log(
  "🤖 DARK STREAM BOT يعمل..."
);
