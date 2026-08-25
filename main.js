// ======================================================
// DARK TELEGRAM STREAM BOT
// Solo + Group + Stop + Status + FFprobe + MP4 Loop
// JavaScript ES Module
// ======================================================

import TelegramBot from "node-telegram-bot-api";
import { spawn, execFile } from "child_process";
import fs from "fs";

// ======================================================
// 👇 ضع توكن Telegram Bot هنا 👇
// ======================================================

const TOKEN = "8938418856:AAHmkAy9CWRzuHmZc4b5bUmqSSZUGSbwUN4";

// ======================================================

if (!TOKEN || TOKEN === "ضع_توكن_البوت_هنا") {
    console.error("❌ ضع توكن Telegram داخل TOKEN");
    process.exit(1);
}

const bot = new TelegramBot(TOKEN, {
    polling: true
});

console.log("🤖 Telegram Bot Started");

// ======================================================
// البيانات
// ======================================================

const streams = {};
const sessions = {};

// ======================================================
// القائمة الرئيسية - الأزرار الخارجية
// ======================================================

function mainKeyboard() {
    return {
        reply_markup: {
            keyboard: [
                [
                    { text: "🎯 SOLO" },
                    { text: "🔥 GROUP" }
                ],
                [
                    { text: "🛑 STOP" },
                    { text: "📊 الحالة" }
                ],
                [
                    { text: "🔍 فحص الرابط" }
                ]
            ],
            resize_keyboard: true,
            is_persistent: true
        }
    };
}

// ======================================================
// قائمة STOP
// ======================================================

function stopKeyboard() {
    return {
        reply_markup: {
            keyboard: [
                [
                    { text: "🛑 إيقاف بث معين" }
                ],
                [
                    { text: "⛔ إيقاف جميع البثوث" }
                ],
                [
                    { text: "↩️ رجوع" }
                ]
            ],
            resize_keyboard: true,
            is_persistent: true
        }
    };
}

// ======================================================
// إخفاء مفتاح Facebook
// ======================================================

function maskKey(key) {

    if (!key) {
        return "غير معروف";
    }

    key = key.trim();

    if (key.length <= 8) {
        return "****";
    }

    return (
        key.substring(0, 4) +
        "****" +
        key.substring(key.length - 4)
    );
}

// ======================================================
// FFprobe
// ======================================================

function probeUrl(url) {

    return new Promise((resolve) => {

        execFile(
            "ffprobe",
            [
                "-v",
                "error",

                "-show_entries",
                "format=format_name,duration",

                "-of",
                "json",

                url
            ],
            {
                timeout: 20000
            },

            (error, stdout, stderr) => {

                if (error) {

                    resolve({
                        ok: false,
                        error: stderr || error.message
                    });

                    return;
                }

                try {

                    const data =
                        JSON.parse(stdout);

                    resolve({
                        ok: true,
                        format:
                            data?.format?.format_name ||
                            "unknown",

                        duration:
                            data?.format?.duration ||
                            null
                    });

                } catch {

                    resolve({
                        ok: true,
                        format: "unknown",
                        duration: null
                    });
                }
            }
        );
    });
}

// ======================================================
// فحص الرابط
// ======================================================

async function checkUrl(chatId, url) {

    await bot.sendMessage(
        chatId,
        "🔎 جاري فحص الرابط بواسطة FFprobe...\n\n" +
        url
    );

    const result =
        await probeUrl(url);

    if (!result.ok) {

        await bot.sendMessage(
            chatId,
            "❌ الرابط غير صالح أو FFprobe لم يستطع قراءة المصدر.\n\n" +
            "تأكد أن الرابط مباشر ويعمل."
        );

        return;
    }

    let message =
        "✅ الرابط يعمل\n\n" +
        "📡 الصيغة: " +
        result.format;

    if (result.duration) {

        message +=
            "\n⏱ المدة: " +
            Number(result.duration).toFixed(1) +
            " ثانية";
    }

    await bot.sendMessage(
        chatId,
        message,
        mainKeyboard()
    );
}

// ======================================================
// تشغيل بث
// ======================================================

async function startStream(
    chatId,
    name,
    facebookKey,
    sourceUrl
) {

    name = name.trim();
    facebookKey = facebookKey.trim();
    sourceUrl = sourceUrl.trim();

    if (!name || !facebookKey || !sourceUrl) {

        await bot.sendMessage(
            chatId,
            "❌ البيانات ناقصة."
        );

        return false;
    }

    // منع تكرار الاسم
    if (streams[name]) {

        await bot.sendMessage(
            chatId,
            `⚠️ البث "${name}" يعمل بالفعل.`
        );

        return false;
    }

    // فحص الرابط
    await bot.sendMessage(
        chatId,
        `🔎 فحص رابط البث "${name}"...`
    );

    const probe =
        await probeUrl(sourceUrl);

    if (!probe.ok) {

        await bot.sendMessage(
            chatId,
            `❌ فشل فحص رابط البث "${name}".\n\n` +
            `لن يتم تشغيل البث.`
        );

        return false;
    }

    const target =
        `rtmps://live-api-s.facebook.com:443/rtmp/${facebookKey}`;

    const isMp4 =
        sourceUrl
            .toLowerCase()
            .split("?")[0]
            .endsWith(".mp4");

    let args = [];

    // ==================================================
    // MP4 Loop
    // ==================================================

    if (isMp4) {

        args.push(
            "-stream_loop",
            "-1"
        );
    }

    // ==================================================
    // FFmpeg
    // ==================================================

    args.push(
        "-re",
        "-nostdin",

        "-i",
        sourceUrl,

        "-map",
        "0:v:0?",

        "-map",
        "0:a:0?",

        "-c:v",
        "copy",

        "-c:a",
        "copy",

        "-f",
        "flv",

        target
    );

    console.log(
        `▶️ Starting stream: ${name}`
    );

    const process =
        spawn(
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

    streams[name] = {

        name,

        key: facebookKey,

        url: sourceUrl,

        process,

        startedAt:
            Date.now(),

        status:
            "starting"
    };

    // ==================================================
    // حفظ Log
    // ==================================================

    const logFile =
        `stream-${name.replace(
            /[^a-zA-Z0-9_-]/g,
            "_"
        )}.log`;

    const logStream =
        fs.createWriteStream(
            logFile,
            {
                flags: "a"
            }
        );

    process.stderr.pipe(
        logStream
    );

    // ==================================================
    // FFmpeg بدأ
    // ==================================================

    process.on(
        "spawn",
        async () => {

            if (streams[name]) {

                streams[name].status =
                    "running";
            }

            await bot.sendMessage(
                chatId,

                `✅ تم تشغيل البث\n\n` +

                `📛 الاسم: ${name}\n` +

                `🔑 المفتاح: ${maskKey(
                    facebookKey
                )}\n` +

                `📡 المصدر: ${
                    isMp4
                        ? "MP4 🔁 تكرار تلقائي"
                        : "مباشر"
                }\n` +

                `🟢 الحالة: يعمل`,

                mainKeyboard()
            );
        }
    );

    // ==================================================
    // خطأ
    // ==================================================

    process.on(
        "error",
        async (error) => {

            console.error(
                `FFmpeg error ${name}:`,
                error
            );

            delete streams[name];

            try {

                await bot.sendMessage(
                    chatId,

                    `❌ حدث خطأ في بث "${name}"\n\n` +
                    error.message,

                    mainKeyboard()
                );

            } catch {}
        }
    );

    // ==================================================
    // توقف FFmpeg
    // ==================================================

    process.on(
        "close",
        async (code) => {

            console.log(
                `FFmpeg stopped: ${name}, code=${code}`
            );

            delete streams[name];

            try {

                await bot.sendMessage(
                    chatId,

                    `🛑 توقف البث "${name}"\n\n` +
                    `كود FFmpeg: ${
                        code ?? "غير معروف"
                    }`,

                    mainKeyboard()
                );

            } catch {}
        }
    );

    return true;
}

// ======================================================
// إيقاف بث
// ======================================================

async function stopStream(
    chatId,
    name
) {

    name = name.trim();

    const stream =
        streams[name];

    if (!stream) {

        await bot.sendMessage(
            chatId,
            `❌ لا يوجد بث باسم "${name}".`,
            mainKeyboard()
        );

        return;
    }

    try {

        stream.process.kill(
            "SIGTERM"
        );

    } catch {}

    delete streams[name];

    await bot.sendMessage(
        chatId,

        `🛑 تم إيقاف البث "${name}".`,

        mainKeyboard()
    );
}

// ======================================================
// إيقاف جميع البثوث
// ======================================================

async function stopAll(chatId) {

    const names =
        Object.keys(streams);

    if (names.length === 0) {

        await bot.sendMessage(
            chatId,

            "ℹ️ لا توجد بثوث تعمل حالياً.",

            mainKeyboard()
        );

        return;
    }

    for (const name of names) {

        try {

            streams[name]
                .process
                .kill("SIGTERM");

        } catch {}

        delete streams[name];
    }

    await bot.sendMessage(
        chatId,

        `🛑 تم إيقاف جميع البثوث.\n\n` +
        `📊 العدد: ${names.length}`,

        mainKeyboard()
    );
}

// ======================================================
// حالة جميع البثوث
// ======================================================

async function showStatus(chatId) {

    const names =
        Object.keys(streams);

    if (names.length === 0) {

        await bot.sendMessage(
            chatId,

            "📊 لا توجد بثوث نشطة.",

            mainKeyboard()
        );

        return;
    }

    let text =
        `📊 البثوث النشطة: ${names.length}\n\n`;

    for (const name of names) {

        const stream =
            streams[name];

        const seconds =
            Math.floor(
                (Date.now() -
                    stream.startedAt) /
                1000
            );

        const minutes =
            Math.floor(
                seconds / 60
            );

        const hours =
            Math.floor(
                minutes / 60
            );

        const time =
            hours > 0
                ? `${hours}س ${
                    minutes % 60
                  }د`

                : `${minutes}د ${
                    seconds % 60
                  }ث`;

        text +=
            `📛 ${name}\n` +

            `🔑 ${
                maskKey(stream.key)
            }\n` +

            `🟢 ${
                stream.status
            }\n` +

            `⏱ ${time}\n\n`;
    }

    await bot.sendMessage(
        chatId,
        text,
        mainKeyboard()
    );
}

// ======================================================
// حالة بث معين
// ======================================================

async function showStreamStatus(
    chatId,
    name
) {

    name = name.trim();

    const stream =
        streams[name];

    if (!stream) {

        await bot.sendMessage(
            chatId,

            `❌ البث "${name}" غير موجود أو متوقف.`,

            mainKeyboard()
        );

        return;
    }

    const seconds =
        Math.floor(
            (Date.now() -
                stream.startedAt) /
            1000
        );

    await bot.sendMessage(
        chatId,

        `📊 حالة البث\n\n` +

        `📛 الاسم: ${name}\n` +

        `🔑 المفتاح: ${
            maskKey(stream.key)
        }\n` +

        `🟢 الحالة: ${
            stream.status
        }\n` +

        `⏱ المدة: ${
            seconds
        } ثانية\n` +

        `📡 المصدر: ${
            stream.url
        }`,

        mainKeyboard()
    );
}

// ======================================================
// /start
// ======================================================

bot.on(
    "message",
    async (msg) => {

        try {

            if (!msg.text) {
                return;
            }

            const chatId =
                msg.chat.id;

            const userId =
                msg.from.id;

            const text =
                msg.text.trim();

            // ==================================================
            // /start
            // ==================================================

            if (text === "/start") {

                delete sessions[userId];

                // لا نرسل قائمة الأوامر
                // فقط رسالة بسيطة + الأزرار الخارجية

                return bot.sendMessage(
                    chatId,
                    "🤖 DARK STREAM BOT",
                    mainKeyboard()
                );
            }

            // ==================================================
            // SOLO
            // ==================================================

            if (text === "🎯 SOLO" ||
                text === "/solo") {

                sessions[userId] = {

                    type: "solo",

                    step: "name"
                };

                return bot.sendMessage(
                    chatId,

                    "1️⃣ أرسل اسم البث:"
                );
            }

            // ==================================================
            // GROUP
            // ==================================================

            if (text === "🔥 GROUP" ||
                text === "/group") {

                sessions[userId] = {

                    type: "group",

                    step: "count",

                    streams: []
                };

                return bot.sendMessage(
                    chatId,

                    "👥 كم عدد البثوث التي تريد تشغيلها؟\n\n" +
                    "مثال: 3"
                );
            }

            // ==================================================
            // STOP
            // ==================================================

            if (text === "🛑 STOP" ||
                text === "/stop") {

                sessions[userId] = {

                    type: "stop",

                    step: "name"
                };

                return bot.sendMessage(
                    chatId,

                    "🛑 أرسل اسم البث الذي تريد إيقافه:",
                    stopKeyboard()
                );
            }

            // ==================================================
            // STOP ALL
            // ==================================================

            if (
                text === "⛔ إيقاف جميع البثوث" ||
                text === "/stopall"
            ) {

                return stopAll(chatId);
            }

            // ==================================================
            // STATUS
            // ==================================================

            if (
                text === "📊 الحالة" ||
                text === "/status"
            ) {

                return showStatus(chatId);
            }

            // ==================================================
            // CHECK
            // ==================================================

            if (
                text === "🔍 فحص الرابط" ||
                text === "/check"
            ) {

                sessions[userId] = {

                    type: "check",

                    step: "url"
                };

                return bot.sendMessage(
                    chatId,

                    "🌐 أرسل رابط البث لفحصه:"
                );
            }

            // ==================================================
            // STREAM STATUS
            // ==================================================

            if (
                text === "/streamstatus"
            ) {

                sessions[userId] = {

                    type:
                        "streamstatus",

                    step:
                        "name"
                };

                return bot.sendMessage(
                    chatId,

                    "📊 أرسل اسم البث:"
                );
            }

            // ==================================================
            // رجوع
            // ==================================================

            if (
                text === "↩️ رجوع"
            ) {

                delete sessions[userId];

                return bot.sendMessage(
                    chatId,

                    "🏠 القائمة الرئيسية",

                    mainKeyboard()
                );
            }

            // ==================================================
            // لا توجد جلسة
            // ==================================================

            if (!sessions[userId]) {

                return bot.sendMessage(
                    chatId,

                    "❓ استخدم /start لعرض القائمة.",

                    mainKeyboard()
                );
            }

            const session =
                sessions[userId];

            // ==================================================
            // SOLO
            // ==================================================

            if (
                session.type === "solo"
            ) {

                if (
                    session.step ===
                    "name"
                ) {

                    session.name =
                        text;

                    session.step =
                        "key";

                    return bot.sendMessage(
                        chatId,

                        "2️⃣ أرسل مفتاح Facebook:"
                    );
                }

                if (
                    session.step ===
                    "key"
                ) {

                    session.key =
                        text;

                    session.step =
                        "url";

                    return bot.sendMessage(
                        chatId,

                        "3️⃣ أرسل رابط البث:"
                    );
                }

                if (
                    session.step ===
                    "url"
                ) {

                    const {
                        name,
                        key
                    } = session;

                    delete sessions[
                        userId
                    ];

                    await startStream(
                        chatId,
                        name,
                        key,
                        text
                    );

                    return;
                }
            }

            // ==================================================
            // GROUP
            // ==================================================

            if (
                session.type ===
                "group"
            ) {

                // العدد
                if (
                    session.step ===
                    "count"
                ) {

                    const count =
                        Number(text);

                    if (
                        !Number.isInteger(
                            count
                        ) ||
                        count < 1 ||
                        count > 20
                    ) {

                        return bot.sendMessage(
                            chatId,

                            "❌ أرسل رقماً من 1 إلى 20."
                        );
                    }

                    session.count =
                        count;

                    session.current =
                        1;

                    session.step =
                        "name";

                    return bot.sendMessage(
                        chatId,

                        `👥 تم تحديد ${count} بثوث.\n\n` +
                        `📡 البث 1 من ${count}\n\n` +
                        `أرسل اسم البث:`
                    );
                }

                // الاسم
                if (
                    session.step ===
                    "name"
                ) {

                    session.currentName =
                        text;

                    session.step =
                        "key";

                    return bot.sendMessage(
                        chatId,

                        `🔑 البث ${session.current} من ${session.count}\n\n` +
                        `أرسل مفتاح Facebook:`
                    );
                }

                // المفتاح
                if (
                    session.step ===
                    "key"
                ) {

                    session.currentKey =
                        text;

                    session.step =
                        "url";

                    return bot.sendMessage(
                        chatId,

                        `🌐 البث ${session.current} من ${session.count}\n\n` +
                        `أرسل رابط البث:`
                    );
                }

                // الرابط
                if (
                    session.step ===
                    "
