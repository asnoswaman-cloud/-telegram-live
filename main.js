import TelegramBot from "node-telegram-bot-api";
import fs from "fs";
import path from "path";
import os from "os";
import https from "https";
import http from "http";
import { spawn } from "child_process";

// =====================================================
// 🔐 TELEGRAM TOKEN
// الأفضل وضعه في Railway Variables
// =====================================================

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8938418856:AAHmkAy9CWRzuHmZc4b5bUmqSSZUGSbwUN4";

// =====================================================
// 🖼️ IMAGE URL
// ضع هنا رابط الصورة المباشر
// =====================================================

const IMAGE_URL =
  process.env.IMAGE_URL ||
  "https://imgbs.com/uploads/bot-03891859.png";

// =====================================================
// 📺 FACEBOOK RTMPS
// =====================================================

const FACEBOOK_URL =
  process.env.FACEBOOK_URL ||
  "rtmps://live-api-s.facebook.com:443/rtmp/";

// =====================================================
// ⚙️ SETTINGS
// =====================================================

const DATA_DIR = path.join(os.tmpdir(), "dark-stream");
const IMAGE_FILE = path.join(DATA_DIR, "overlay.png");

const RESTART_DELAY = 5000;

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// =====================================================
// ❗ CHECK TOKEN
// =====================================================

if (!TELEGRAM_TOKEN) {
  console.error("❌ TELEGRAM_TOKEN غير موجود");
  process.exit(1);
}

// =====================================================
// 🤖 TELEGRAM BOT
// =====================================================

const bot = new TelegramBot(TELEGRAM_TOKEN, {
  polling: true
});

console.log("🤖 DARK STREAM BOT Started");

// =====================================================
// 📡 STREAMS
// =====================================================

const streams = new Map();

/*
stream structure:

{
  id,
  key,
  source,
  process,
  running,
  restarting
}
*/

// =====================================================
// 🖼️ DOWNLOAD IMAGE
// =====================================================

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;

    const request = protocol.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0"
        }
      },
      response => {

        // Redirect
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();

          return downloadFile(
            response.headers.location,
            destination
          )
            .then(resolve)
            .catch(reject);
        }

        if (response.statusCode !== 200) {
          response.resume();

          reject(
            new Error(
              `HTTP ${response.statusCode}`
            )
          );

          return;
        }

        const file = fs.createWriteStream(destination);

        response.pipe(file);

        file.on("finish", () => {
          file.close(resolve);
        });

        file.on("error", err => {
          file.close();
          reject(err);
        });
      }
    );

    request.on("error", reject);
  });
}

// =====================================================
// 🖼️ PREPARE IMAGE
// =====================================================

async function prepareImage() {
  try {

    console.log("🖼️ تحميل الصورة...");

    if (fs.existsSync(IMAGE_FILE)) {
      fs.unlinkSync(IMAGE_FILE);
    }

    await downloadFile(
      IMAGE_URL,
      IMAGE_FILE
    );

    const size = fs.statSync(IMAGE_FILE).size;

    if (size < 100) {
      throw new Error("الصورة فارغة أو غير صالحة");
    }

    console.log(
      `✅ تم تحميل الصورة: ${size} bytes`
    );

    return true;

  } catch (error) {

    console.error(
      "❌ فشل تحميل الصورة:",
      error.message
    );

    return false;
  }
}

// =====================================================
// 🔑 CREATE STREAM URL
// =====================================================

function createStreamUrl(key) {

  if (!key) {
    throw new Error(
      "Facebook Stream Key غير موجود"
    );
  }

  return `${FACEBOOK_URL}${key}`;
}

// =====================================================
// 🎬 BUILD FFMPEG
// =====================================================

function createFFmpeg(stream) {

  const output = createStreamUrl(
    stream.key
  );

  /*
    الصورة يتم وضعها في الأسفل بالمنتصف.

    scale=640:-1
    يعني عرض الصورة 640px
    والارتفاع يحسب تلقائياً.

    x=(main_w-overlay_w)/2
    = المنتصف تماماً.

    y=main_h-overlay_h-25
    = أسفل الشاشة مع هامش 25px.
  */

  const filter = [
    "[1:v]scale=640:-1,format=rgba,colorchannelmixer=aa=1[logo]",
    "[0:v][logo]overlay=x=(main_w-overlay_w)/2:y=main_h-overlay_h-25:format=auto[v]"
  ].join(";");

  const args = [

    // INPUT
    "-re",
    "-i",
    stream.source,

    // IMAGE
    "-loop",
    "1",
    "-i",
    IMAGE_FILE,

    // VIDEO FILTER
    "-filter_complex",
    filter,

    // VIDEO
    "-map",
    "[v]",

    // AUDIO
    "-map",
    "0:a?",

    "-c:v",
    "libx264",

    "-preset",
    "veryfast",

    "-tune",
    "zerolatency",

    "-pix_fmt",
    "yuv420p",

    "-r",
    "30",

    "-g",
    "60",

    "-b:v",
    "4000k",

    "-maxrate",
    "4500k",

    "-bufsize",
    "9000k",

    // AUDIO
    "-c:a",
    "aac",

    "-b:a",
    "128k",

    "-ar",
    "44100",

    // FLV
    "-f",
    "flv",

    output
  ];

  // ===================================================
  // 🔁 MP4 LOOP
  // ===================================================

  const lower = stream.source.toLowerCase();

  if (
    lower.endsWith(".mp4") ||
    lower.includes(".mp4?")
  ) {

    // remove normal input
    args.splice(
      args.indexOf("-re"),
      2
    );

    // add loop before input
    args.unshift(
      "-stream_loop",
      "-1",
      "-re"
    );
  }

  return args;
}

// =====================================================
// 🚀 START STREAM
// =====================================================

async function startStream(stream) {

  if (stream.running) {
    return false;
  }

  if (!fs.existsSync(IMAGE_FILE)) {

    const imageReady =
      await prepareImage();

    if (!imageReady) {
      return false;
    }
  }

  let args;

  try {

    args = createFFmpeg(stream);

  } catch (error) {

    console.error(
      "❌ FFmpeg configuration error:",
      error.message
    );

    return false;
  }

  console.log(
    `🚀 Starting stream ${stream.id}`
  );

  const ffmpeg = spawn(
    "ffmpeg",
    args,
    {
      stdio: [
        "ignore",
        "pipe",
        "pipe"
      ]
    }
  );

  stream.process = ffmpeg;
  stream.running = true;

  ffmpeg.stdout.on(
    "data",
    data => {
      console.log(
        `[${stream.id}] ${data}`
      );
    }
  );

  ffmpeg.stderr.on(
    "data",
    data => {

      const text =
        data.toString();

      // FFmpeg outputs almost everything
      // through stderr.

      if (
        text.includes("frame=") ||
        text.includes("speed=")
      ) {
        process.stdout.write(
          `[${stream.id}] ${text}`
        );
      }
    }
  );

  ffmpeg.on(
    "error",
    error => {

      console.error(
        `[${stream.id}] FFmpeg error:`,
        error.message
      );

      stream.running = false;
      stream.process = null;
    }
  );

  ffmpeg.on(
    "close",
    code => {

      console.log(
        `🛑 ${stream.id} FFmpeg stopped. Code: ${code}`
      );

      stream.running = false;
      stream.process = null;

      // Automatic restart
      if (!stream.restarting) {

        stream.restarting = true;

        setTimeout(
          async () => {

            stream.restarting = false;

            if (!stream.running) {
              await startStream(stream);
            }

          },
          RESTART_DELAY
        );
      }
    }
  );

  return true;
}

// =====================================================
// ⛔ STOP STREAM
// =====================================================

function stopStream(stream) {

  if (!stream.process) {
    stream.running = false;
    return false;
  }

  console.log(
    `⛔ Stopping ${stream.id}`
  );

  stream.restarting = true;

  try {

    stream.process.kill(
      "SIGTERM"
    );

  } catch (error) {

    console.error(
      error.message
    );
  }

  stream.process = null;
  stream.running = false;

  setTimeout(() => {
    stream.restarting = false;
  }, 3000);

  return true;
}

// =====================================================
// 📊 STATUS
// =====================================================

function statusText() {

  if (streams.size === 0) {
    return "📊 لا توجد بثوث.";
  }

  let text =
    "📊 حالة البثوث\n\n";

  for (const stream of streams.values()) {

    text +=
      `📛 ${stream.id}\n`;

    text +=
      stream.running
        ? "🟢 RUNNING\n"
        : "🔴 STOPPED\n";

    text +=
      `🔑 ${maskKey(stream.key)}\n`;

    text +=
      `📡 ${stream.source}\n\n`;
  }

  return text;
}

// =====================================================
// 🔒 HIDE KEY
// =====================================================

function maskKey(key) {

  if (!key) {
    return "غير موجود";
  }

  if (key.length < 8) {
    return "********";
  }

  return (
    key.substring(0, 4) +
    "****" +
    key.substring(key.length - 4)
  );
}

// =====================================================
// 🎛️ KEYBOARD
// =====================================================

function keyboard() {

  return {
    reply_markup: {
      keyboard: [

        [
          {
            text: "🔴 SOLO"
          },
          {
            text: "🔥 GROUP"
          }
        ],

        [
          {
            text: "📊 الحالة"
          },
          {
            text: "⛔ STOP"
          }
        ],

        [
          {
            text: "🔗 تغيير الرابط"
          }
        ],

        [
          {
            text: "🔑 تغيير المفتاح"
          }
        ],

        [
          {
            text: "🎬 تغيير المصدر"
          }
        ]

      ],

      resize_keyboard: true
    }
  };
}

// =====================================================
// 🏠 /START
// =====================================================

bot.onText(
  /\/start/,
  async msg => {

    await bot.sendMessage(
      msg.chat.id,

      "🤖 DARK STREAM BOT\n\n" +
      "اختر العملية من الأزرار:",
      keyboard()
    );
  }
);

// =====================================================
// 📊 STATUS COMMAND
// =====================================================

bot.onText(
  /\/status/,
  async msg => {

    await bot.sendMessage(
      msg.chat.id,
      statusText(),
      keyboard()
    );
  }
);

// =====================================================
// ⛔ STOP COMMAND
// =====================================================

bot.onText(
  /\/stop/,
  async msg => {

    let count = 0;

    for (
      const stream of streams.values()
    ) {

      if (stream.running) {
        stopStream(stream);
        count++;
      }
    }

    await bot.sendMessage(
      msg.chat.id,

      `⛔ تم إيقاف ${count} بث.`,
      keyboard()
    );
  }
);

// =====================================================
// 🔴 SOLO
// =====================================================

bot.on(
  "message",
  async msg => {

    if (!msg.text) {
      return;
    }

    if (msg.text === "🔴 SOLO") {

      const stream =
        streams.get("SOLO");

      if (!stream) {

        await bot.sendMessage(
          msg.chat.id,

          "❌ لا توجد إعدادات SOLO.\n\n" +
          "استخدم /setsolo أو أرسل الإعدادات من جديد."
        );

        return;
      }

      // stop existing
      if (stream.running) {
        stopStream(stream);

        await new Promise(
          resolve =>
            setTimeout(resolve, 1500)
        );
      }

      const ok =
        await startStream(stream);

      await bot.sendMessage(
        msg.chat.id,

        ok
          ? "🟢 تم تشغيل SOLO"
          : "❌ فشل تشغيل SOLO",

        keyboard()
      );
    }
  }
);

// =====================================================
// 🔥 GROUP
// =====================================================

bot.on(
  "message",
  async msg => {

    if (
      !msg.text ||
      msg.text !== "🔥 GROUP"
    ) {
      return;
    }

    if (streams.size === 0) {

      await bot.sendMessage(
        msg.chat.id,
        "❌ لا توجد بثوث."
      );

      return;
    }

    let started = 0;

    for (
      const stream of streams.values()
    ) {

      if (!stream.running) {

        const ok =
          await startStream(stream);

        if (ok) {
          started++;
        }
      }
    }

    await bot.sendMessage(
      msg.chat.id,

      `🔥 GROUP\n\n` +
      `🟢 تم تشغيل: ${started}\n` +
      `📊 الإجمالي: ${streams.size}`,

      keyboard()
    );
  }
);

// =====================================================
// 📊 STATUS BUTTON
// =====================================================

bot.on(
  "message",
  async msg => {

    if (
      !msg.text ||
      msg.text !== "📊 الحالة"
    ) {
      return;
    }

    await bot.sendMessage(
      msg.chat.id,
      statusText(),
      keyboard()
    );
  }
);

// =====================================================
// ⛔ STOP BUTTON
// =====================================================

bot.on(
  "message",
  async msg => {

    if (
      !msg.text ||
      msg.text !== "⛔ STOP"
    ) {
      return;
    }

    let count = 0;

    for (
      const stream of streams.values()
    ) {

      if (stream.running) {
        stopStream(stream);
        count++;
      }
    }

    await bot.sendMessage(
      msg.chat.id,

      `⛔ تم إيقاف ${count} بث.`,

      keyboard()
    );
  }
);

// =====================================================
// 🔗 SET URL
// =====================================================

bot.onText(
  /\/seturl (.+)/,
  async msg => {

    const url =
      msg[1].trim();

    process.env.FACEBOOK_URL = url;

    await bot.sendMessage(
      msg.chat.id,
      "✅ تم تغيير Facebook RTMPS URL."
    );
  }
);

// =====================================================
// 🔑 SET KEY
// =====================================================

bot.onText(
  /\/setkey (.+)/,
  async msg => {

    const key =
      msg[1].trim();

    let stream =
      streams.get("SOLO");

    if (!stream) {

      stream = {
        id: "SOLO",
        key,
        source: "",
        process: null,
        running: false,
        restarting: false
      };

      streams.set(
        "SOLO",
        stream
      );

    } else {

      stream.key = key;
    }

    await bot.sendMessage(
      msg.chat.id,
      "✅ تم حفظ Stream Key."
    );
  }
);

// =====================================================
// 🎬 SET VIDEO / SOURCE
// =====================================================

bot.onText(
  /\/setvideo (.+)/,
  async msg => {

    const source =
      msg[1].trim();

    let stream =
      streams.get("SOLO");

    if (!stream) {

      stream = {
        id: "SOLO",
        key: "",
        source,
        process: null,
        running: false,
        restarting: false
      };

      streams.set(
        "SOLO",
        stream
      );

    } else {

      stream.source = source;
    }

    await bot.sendMessage(
      msg.chat.id,
      "✅ تم حفظ مصدر الفيديو."
    );
  }
);

// =====================================================
// 🔗 CHANGE URL BUTTON
// =====================================================

bot.on(
  "message",
  async msg => {

    if (
      !msg.text ||
      msg.text !== "🔗 تغيير الرابط"
    ) {
      return;
    }

    await bot.sendMessage(
      msg.chat.id,

      "أرسل الرابط بهذا الشكل:\n\n" +
      "/seturl rtmps://live-api-s.facebook.com:443/rtmp/"
    );
  }
);

// =====================================================
// 🔑 CHANGE KEY BUTTON
// =====================================================

bot.on(
  "message",
  async msg => {

    if (
      !msg.text ||
      msg.text !== "🔑 تغيير المفتاح"
    ) {
      return;
    }

    await bot.sendMessage(
      msg.chat.id,

      "أرسل المفتاح بهذا الشكل:\n\n" +
      "/setkey YOUR_STREAM_KEY"
    );
  }
);

// =====================================================
// 🎬 CHANGE SOURCE BUTTON
// =====================================================

bot.on(
  "message",
  async msg => {

    if (
      !msg.text ||
      msg.text !== "🎬 تغيير المصدر"
    ) {
      return;
    }

    await bot.sendMessage(
      msg.chat.id,

      "أرسل رابط M3U8 أو TS أو MP4:\n\n" +
      "/setvideo https://example.com/video.mp4"
    );
  }
);

// =====================================================
// ❌ POLLING ERRORS
// =====================================================

bot.on(
  "polling_error",
  error => {

    console.error(
      "Telegram polling error:",
      error.message
    );
  }
);

// =====================================================
// 🛑 PROCESS EXIT
// =====================================================

process.on(
  "SIGTERM",
  () => {

    console.log(
      "🛑 Shutting down..."
    );

    for (
      const stream of streams.values()
    ) {

      if (stream.process) {

        try {
          stream.process.kill(
            "SIGTERM"
          );
        } catch {}
      }
    }

    bot.stopPolling();

    process.exit(0);
  }
);

process.on(
  "SIGINT",
  () => {

    for (
      const stream of streams.values()
    ) {

      if (stream.process) {

        try {
          stream.process.kill(
            "SIGTERM"
          );
        } catch {}
      }
    }

    bot.stopPolling();

    process.exit(0);
  }
);

console.log(
  "✅ Bot is ready."
);
