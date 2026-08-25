// ======================================================
// DARK TELEGRAM STREAM BOT
// Solo + Group + Stop + Status + FFprobe + MP4 Loop
// JavaScript ES Module
// ======================================================

import TelegramBot from "node-telegram-bot-api";
import { spawn, execFile } from "child_process";
import fs from "fs";

// ======================================================
// 👇 ضع توكن Telegram Bot هنا
// ======================================================

const TOKEN = "8938418856:AAHmkAy9CWRzuHmZc4b5bUmqSSZUGSbwUN4";

// مثال:
// const TOKEN = "123456789:AAxxxxxxxxxxxxxxxx";

// ======================================================

if (!TOKEN || TOKEN === "YOUR_BOT_TOKEN") {
    console.error("❌ ضع توكن Telegram داخل TOKEN");
    process.exit(1);
}

// ======================================================
// تشغيل البوت
// ======================================================

const bot = new TelegramBot(TOKEN, {
    polling: true
});

console.log("🤖 DARK STREAM BOT Started");

// ======================================================
// البيانات
// ======================================================

const streams = {};
const sessions = {};

// ======================================================
// إخفاء مفتاح Facebook
// ======================================================

function maskKey(key) {
    if (!key) return "غير معروف";

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
// لوحة الأزرار الخارجية
// ======================================================

function mainKeyboard() {
    return {
        reply_markup: {
            keyboard: [
                [
                    {
                        text: "🎯 SOLO"
                    }
                ],
                [
                    {
                        text: "👥 GROUP"
                    }
                ],
                [
                    {
                        text: "🛑 STOP"
                    }
                ],
                [
                    {
                        text: "📊 STATUS"
                    }
                ],
                [
                    {
                        text: "🔎 CHECK"
                    }
                ],
                [
                    {
                        text: "📊 STREAM STATUS"
                    }
                ]
            ],
            resize_keyboard: true,
            is_persistent: true
        }
    };
}

// ======================================================
// لوحة STOP
// ======================================================

function stopKeyboard() {
    return {
        reply_markup: {
            keyboard: [
                [
                    {
                        text: "🛑 إيقاف بث معين"
                    }
                ],
                [
                    {
                        text: "⛔ إيقاف جميع البثوث"
                    }
                ],
                [
                    {
                        text: "↩️ رجوع"
                    }
                ]
            ],
            resize_keyboard: true,
            is_persistent: true
        }
    };
}

// ======================================================
// فحص الرابط بواسطة FFprobe
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
                "-show_entries",
                "stream=codec_type,codec_name",
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

                    const data = JSON.parse(stdout);

                    const streamList =
                        data.streams || [];

                    const video =
                        streamList.find(
                            x => x.codec_type === "video"
                        );

                    const audio =
                        streamList.find(
                            x => x.codec_type === "audio"
                        );

                    const format =
                        data?.format?.format_name ||
                        "unknown";

                    const duration =
                        data?.format?.duration ||
                        null;

                    resolve({
                        ok: true,
                        format,
                        duration,
                        video:
                            video?.codec_name ||
                            "unknown",
                        audio:
                            audio?.codec_name ||
                            "غير موجود"
                    });

                } catch {

                    resolve({
                        ok: true,
                        format: "unknown",
                        duration: null,
                        video: "unknown",
                        audio: "غير معروف"
                    });
                }
            }
        );
    });
}

// ======================================================
// فحص الرابط من البوت
// ======================================================

async function checkUrl(chatId, url) {

    await bot.sendMessage(
        chatId,
        "🔎 جاري فحص الرابط بواسطة FFprobe..."
    );

    const result =
        await probeUrl(url);

    if (!result.ok) {

        await bot.sendMessage(
            chatId,
            "❌ الرابط غير صالح أو FFprobe لم يستطع قراءة المصدر.\n\n" +
            "تأكد أن الرابط مباشر ويعمل.",
            mainKeyboard()
        );

        return;
    }

    let message =
        "✅ الرابط يعمل\n\n" +
        "🌐 الرابط:\n" +
        url +
        "\n\n" +
        "📡 الصيغة: " +
        result.format +
        "\n\n" +
        "🎥 الفيديو: " +
        result.video +
        "\n\n" +
        "🔊 الصوت: " +
        result.audio;

    if (result.duration) {

        message +=
            "\n\n⏱ المدة: " +
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
    sourceUrl,
    streamType = "SOLO"
) {

    name =
        String(name || "").trim();

    facebookKey =
        String(facebookKey || "").trim();

    sourceUrl =
        String(sourceUrl || "").trim();

    if (
        !name ||
        !facebookKey ||
        !sourceUrl
    ) {

        await bot.sendMessage(
            chatId,
            "❌ البيانات ناقصة."
        );

        return false;
    }

    // ==================================================
    // منع تكرار الاسم
    // ==================================================

    if (streams[name]) {

        await bot.sendMessage(
            chatId,
            `⚠️ البث "${name}" يعمل بالفعل.`
        );

        return false;
    }

    // ==================================================
    // فحص الرابط
    // ==================================================

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
            `لن يتم تشغيل البث.\n\n` +
            `${probe.error || ""}`
        );

        return false;
    }

    // ==================================================
    // Facebook RTMPS
    // ==================================================

    const target =
        `rtmps://live-api-s.facebook.com:443/rtmp/${facebookKey}`;

    // ==================================================
    // معرفة MP4
    // ==================================================

    const isMp4 =
        sourceUrl
            .toLowerCase()
            .split("?")[0]
            .endsWith(".mp4");

    // ==================================================
    // FFmpeg arguments
    // ==================================================

    let args = [];

    // ==================================================
    // MP4 Loop
    // ==================================================

    if (isMp4) {

        args.push(
            "-stream_loop",
            "-1"
        );

    } else {

        // إعادة الاتصال للمصادر المباشرة

        args.push(
            "-reconnect",
            "1",
            "-reconnect_streamed",
            "1",
            "-reconnect_delay_max",
            "10"
        );
    }

    // ==================================================
    // Input
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

        "-keyint_min",
        "60",

        "-b:v",
        "2500k",

        "-maxrate",
        "3000k",

        "-bufsize",
        "6000k",

        "-c:a",
        "aac",

        "-b:a",
        "128k",

        "-ar",
        "44100",

        "-f",
        "flv",

        target
    );

    console.log(
        `▶️ Starting stream: ${name}`
    );

    // ==================================================
    // تشغيل FFmpeg
    // ==================================================

    let process;

    try {

        process =
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

    } catch (error) {

        await bot.sendMessage(
            chatId,
            "❌ تعذر تشغيل FFmpeg:\n\n" +
            error.message
        );

        return false;
    }

    // ==================================================
    // تسجيل البث
    // ==================================================

    streams[name] = {

        name,

        key:
            facebookKey,

        url:
            sourceUrl,

        type:
            streamType,

        process,

        startedAt:
            Date.now(),

        status:
            "starting",

        manualStop:
            false,

        isMp4
    };

    // ==================================================
    // Log file
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

    process.stderr.pipe(logStream);

    // ==================================================
    // FFmpeg Spawn
    // ==================================================

    process.on(
        "spawn",
        async () => {

            if (streams[name]) {

                streams[name].status =
                    "running";
            }

            try {

                await bot.sendMessage(
                    chatId,
                    `✅ تم تشغيل البث\n\n` +
                    `📛 الاسم: ${name}\n` +
                    `🔑 المفتاح: ${maskKey(facebookKey)}\n` +
                    `📡 النوع: ${streamType}\n` +
                    `🔄 MP4: ${
                        isMp4
                            ? "تكرار تلقائي ✅"
                            : "لا"
                    }\n` +
                    `🟢 الحالة: يعمل`,
                    mainKeyboard()
                );

            } catch {}
        }
    );

    // ==================================================
    // FFmpeg Error
    // ==================================================

    process.on(
        "error",
        async (error) => {

            console.error(
                `FFmpeg error ${name}:`,
                error
            );

            const stream =
                streams[name];

            if (stream) {

                const manual =
                    stream.manualStop;

                delete streams[name];

                if (!manual) {

                    try {

                        await bot.sendMessage(
                            chatId,
                            `❌ حدث خطأ في بث "${name}"\n\n` +
                            error.message,
                            mainKeyboard()
                        );

                    } catch {}
                }
            }
        }
    );

    // ==================================================
    // FFmpeg Close
    // ==================================================

    process.on(
        "close",
        async (code) => {

            console.log(
                `FFmpeg stopped: ${name}, code=${code}`
            );

            const stream =
                streams[name];

            if (!stream) {
                return;
            }

            const manual =
                stream.manualStop;

            delete streams[name];

            if (!manual) {

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
        }
    );

    return true;
}

// ======================================================
// إيقاف بث معين
// ======================================================

async function stopStream(
    chatId,
    name
) {

    name =
        String(name || "").trim();

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

    stream.manualStop = true;

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

        const stream =
            streams[name];

        stream.manualStop = true;

        try {

            stream.process.kill(
                "SIGTERM"
            );

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
                ? `${hours}س ${minutes % 60}د`
                : `${minutes}د ${seconds % 60}ث`;

        text +=
            `📛 ${name}\n` +
            `🔑 ${maskKey(stream.key)}\n` +
            `📡 ${stream.type}\n` +
            `🟢 ${stream.status}\n` +
            `🔄 MP4: ${
                stream.isMp4
                    ? "نعم"
                    : "لا"
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

    name =
        String(name || "").trim();

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
        `🔑 المفتاح: ${maskKey(stream.key)}\n` +
        `🟢 الحالة: ${stream.status}\n` +
        `⏱ المدة: ${seconds} ثانية\n` +
        `📡 المصدر: ${stream.url}`,
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

                // ==============================================
                // هنا فقط تظهر الأزرار الخارجية
                // ولا يتم إرسال قائمة الأوامر
                // ==============================================

                return bot.sendMessage(
                    chatId,
                    "🤖 DARK STREAM BOT",
                    mainKeyboard()
                );
            }

            // ==================================================
            // SOLO
            // ==================================================

            if (
                text === "🎯 SOLO" ||
                text === "/solo"
            ) {

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

            if (
                text === "👥 GROUP" ||
                text === "/group"
            ) {

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

            if (
                text === "🛑 STOP" ||
                text === "/stop"
            ) {

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
                text === "📊 STATUS" ||
                text === "/status"
            ) {

                return showStatus(chatId);
            }

            // ==================================================
            // CHECK
            // ==================================================

            if (
                text === "🔎 CHECK" ||
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
                text === "📊 STREAM STATUS" ||
                text === "/streamstatus"
            ) {

                sessions[userId] = {
                    type: "streamstatus",
                    step: "name"
                };

                return bot.sendMessage(
                    chatId,
                    "📊 أرسل اسم البث:"
                );
            }

            // ==================================================
            // رجوع
            // ==================================================

            if (text === "↩️ رجوع") {

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
                    "❓ استخدم /start لعرض الأزرار.",
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
                    session.step === "name"
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
                    session.step === "key"
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
                    session.step === "url"
                ) {

                    const name =
                        session.name;

                    const key =
                        session.key;

                    delete sessions[userId];

                    await startStream(
                        chatId,
                        name,
                        key,
                        text,
                        "SOLO"
                    );

                    return;
                }
            }

            // ==================================================
            // GROUP
            // ==================================================

            if (
                session.type === "group"
            ) {

                if (
                    session.step === "count"
                ) {

                    const count =
                        Number(text);

                    if (
                        !Number.isInteger(count) ||
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

                if (
                    session.step === "name"
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

                if (
                    session.step === "key"
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

                if (
                    session.step === "url"
                ) {

                    const name =
                        session.currentName;

                    const key =
                        session.currentKey;

                    await startStream(
                        chatId,
                        name,
                        key,
                        text,
                        "GROUP"
                    );

                    if (
                        session.current >=
                        session.count
                    ) {

                        delete sessions[userId];

                        return bot.sendMessage(
                            chatId,
                            `✅ انتهى إعداد Group.\n\n` +
                            `📊 العدد المطلوب: ${session.count}`,
                            mainKeyboard()
                        );
                    }

                    session.current++;

                    session.step =
                        "name";

                    return bot.sendMessage(
                        chatId,
                        `📡 البث ${session.current} من ${session.count}\n\n` +
                        `أرسل اسم البث:`
                    );
                }
            }

            // ==================================================
            // STOP
            // ==================================================

            if (
                session.type === "stop"
            ) {

                delete sessions[userId];

                return stopStream(
                    chatId,
                    text
                );
            }

            // ==================================================
            // CHECK
            // ==================================================

            if (
                session.type === "check"
            ) {

                delete sessions[userId];

                return checkUrl(
                    chatId,
                    text
                );
            }

            // ==================================================
            // STREAM STATUS
            // ==================================================

            if (
                session.type ===
                "streamstatus"
            ) {

                delete sessions[userId];

                return showStreamStatus(
                    chatId,
                    text
                );
            }

        } catch (error) {

            console.error(
                "BOT ERROR:",
                error
            );

            try {

                await bot.sendMessage(
                    msg.chat.id,
                    "❌ حدث خطأ:\n\n" +
                    error.message,
                    mainKeyboard()
                );

            } catch {}
        }
    }
);

// ======================================================
// أخطاء Telegram
// ======================================================

bot.on(
    "polling_error",
    (error) => {

        console.error(
            "Telegram polling error:",
            error.message
        );
    }
);

// ======================================================
// إيقاف آمن
// ======================================================

function safeShutdown() {

    console.log(
        "🛑 إيقاف البثوث..."
    );

    for (
        const name of Object.keys(streams)
    ) {

        try {

            streams[name].manualStop =
                true;

            streams[name].process.kill(
                "SIGTERM"
            );

        } catch {}
    }

    process.exit(0);
}

// ======================================================
// SIGTERM
// ======================================================

process.on(
    "SIGTERM",
    safeShutdown
);

// ======================================================
// SIGINT
// ======================================================

process.on(
    "SIGINT",
    safeShutdown
);

console.log(
    "======================================"
);

console.log(
    "🤖 DARK TELEGRAM STREAM BOT"
);

console.log(
    "🎯 SOLO"
);

console.log(
    "👥 GROUP"
);

console.log(
    "🛑 STOP"
);

console.log(
    "⛔ STOP ALL"
);

console.log(
    "📊 STATUS"
);

console.log(
    "🔎 CHECK"
);

console.log(
    "📊 STREAM STATUS"
);

console.log(
    "🔄 MP4 LOOP"
);

console.log(
    "======================================"
);
