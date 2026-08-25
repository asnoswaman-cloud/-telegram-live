// ======================================================
// DARK TELEGRAM STREAM BOT
// JavaScript / Node.js
// SOLO + GROUP + STOP + STATUS + FFprobe + MP4 LOOP
// ======================================================

import TelegramBot from "node-telegram-bot-api";
import { spawn, execFile } from "child_process";
import fs from "fs";

// ======================================================
// ضع توكن Telegram Bot هنا
// ======================================================

const BOT_TOKEN = "8938418856:AAHmkAy9CWRzuHmZc4b5bUmqSSZUGSbwUN4";

// ======================================================
// Facebook RTMPS
// ======================================================

const FACEBOOK_RTMP =
    "rtmps://live-api-s.facebook.com:443/rtmp/";

// ======================================================
// تخزين البثوث وحالات المستخدمين
// ======================================================

const streams = {};
const users = {};

// ======================================================
// Telegram Bot
// ======================================================

if (!BOT_TOKEN || BOT_TOKEN === "ضع_توكن_البوت_هنا") {
    console.error("❌ ضع توكن Telegram داخل BOT_TOKEN");
    process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, {
    polling: true
});

console.log("=================================");
console.log("🤖 Telegram Stream Bot Started");
console.log("🎯 SOLO");
console.log("🔥 GROUP");
console.log("🛑 STOP");
console.log("📊 STATUS");
console.log("🔍 FFprobe");
console.log("🔄 MP4 LOOP");
console.log("=================================");

// ======================================================
// القوائم
// ======================================================

function mainKeyboard() {
    return {
        reply_markup: {
            keyboard: [
                ["🎯 SOLO"],
                ["🔥 GROUP"],
                ["🛑 STOP"],
                ["📊 الحالة"],
                ["🔍 فحص الرابط"]
            ],
            resize_keyboard: true
        }
    };
}

function stopKeyboard() {
    return {
        reply_markup: {
            keyboard: [
                ["🛑 إيقاف بث معين"],
                ["⛔ إيقاف جميع البثوث"],
                ["↩️ رجوع"]
            ],
            resize_keyboard: true
        }
    };
}

// ======================================================
// أدوات مساعدة
// ======================================================

function makeId() {
    const chars =
        "abcdefghijklmnopqrstuvwxyz0123456789";

    let suffix = "";

    for (let i = 0; i < 6; i++) {
        suffix += chars[
            Math.floor(Math.random() * chars.length)
        ];
    }

    return `${Date.now()}_${suffix}`;
}

function maskKey(key) {

    if (!key) {
        return "غير معروف";
    }

    key = key.trim();

    if (key.length <= 8) {
        return "********";
    }

    return (
        key.substring(0, 3) +
        "***" +
        key.substring(key.length - 4)
    );
}

function getStreamsForUser(chatId) {

    return Object.values(streams).filter(
        stream =>
            String(stream.chatId) === String(chatId)
    );
}

// ======================================================
// FFprobe
// ======================================================

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

            "-timeout",
            "10000000",

            url
        ];

        execFile(
            "ffprobe",
            args,
            {
                timeout: 20000,
                maxBuffer: 1024 * 1024
            },
            (error, stdout, stderr) => {

                if (error) {

                    resolve({
                        ok: false,
                        error:
                            stderr ||
                            error.message ||
                            "الرابط غير صالح."
                    });

                    return;
                }

                try {

                    const data =
                        JSON.parse(stdout);

                    const foundStreams =
                        data.streams || [];

                    const video =
                        foundStreams.find(
                            x =>
                                x.codec_type ===
                                "video"
                        );

                    const audio =
                        foundStreams.find(
                            x =>
                                x.codec_type ===
                                "audio"
                        );

                    const format =
                        data.format || {};

                    let duration =
                        format.duration;

                    if (duration) {

                        try {

                            const seconds =
                                Math.floor(
                                    Number(duration)
                                );

                            const h =
                                Math.floor(
                                    seconds / 3600
                                );

                            const m =
                                Math.floor(
                                    (seconds % 3600) /
                                    60
                                );

                            const s =
                                seconds % 60;

                            duration =
                                `${String(h).padStart(2, "0")}:` +
                                `${String(m).padStart(2, "0")}:` +
                                `${String(s).padStart(2, "0")}`;

                        } catch {

                            duration = "مباشر";
                        }

                    } else {

                        duration = "مباشر";
                    }

                    resolve({

                        ok: true,

                        video:
                            video?.codec_name ||
                            "غير معروف",

                        audio:
                            audio?.codec_name ||
                            "غير موجود",

                        format:
                            format.format_name ||
                            "غير معروف",

                        duration
                    });

                } catch {

                    resolve({
                        ok: false,
                        error:
                            "تعذر قراءة نتيجة FFprobe."
                    });
                }
            }
        );
    });
}

// ======================================================
// بناء أمر FFmpeg
// ======================================================

function buildFFmpegArgs(url, output) {

    const cleanUrl =
        url.split("?")[0].toLowerCase();

    const isMp4 =
        cleanUrl.endsWith(".mp4");

    let args = [];

    if (isMp4) {

        args = [
            "-hide_banner",
            "-loglevel",
            "warning",

            "-re",

            "-stream_loop",
            "-1",

            "-i",
            url
        ];

    } else {

        args = [
            "-hide_banner",
            "-loglevel",
            "warning",

            "-reconnect",
            "1",

            "-reconnect_streamed",
            "1",

            "-reconnect_delay_max",
            "10",

            "-i",
            url
        ];
    }

    args.push(

        "-map",
        "0:v:0",

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

        output
    );

    return {
        args,
        isMp4
    };
}

// ======================================================
// مراقبة FFmpeg
// ======================================================

function monitorFFmpeg(
    streamId,
    process
) {

    const stream =
        streams[streamId];

    if (!stream) {
        return;
    }

    const name =
        stream.name;

    let logFile;

    try {

        logFile =
            `stream-${name.replace(
                /[^a-zA-Z0-9_-]/g,
                "_"
            )}.log`;

    } catch {

        logFile =
            `stream-${streamId}.log`;
    }

    const logStream =
        fs.createWriteStream(
            logFile,
            {
                flags: "a"
            }
        );

    process.stderr.on(
        "data",
        (data) => {

            const line =
                data.toString();

            console.log(
                `[${name}] ${line.trim()}`
            );

            try {
                logStream.write(line);
            } catch {}
        }
    );

    process.on(
        "error",
        (error) => {

            console.error(
                `[${name}] FFmpeg error:`,
                error.message
            );
        }
    );

    process.on(
        "close",
        async (code) => {

            try {
                logStream.end();
            } catch {}

            console.log(
                `[${name}] FFmpeg stopped: ${code}`
            );

            const current =
                streams[streamId];

            if (!current) {
                return;
            }

            const manualStop =
                Boolean(
                    current.manualStop
                );

            current.status =
                "متوقف";

            delete streams[streamId];

            if (!manualStop) {

                try {

                    await bot.sendMessage(
                        current.chatId,

                        `🔴 توقف البث:\n\n` +
                        `📺 ${name}\n\n` +
                        `رمز FFmpeg: ${code}`
                    );

                } catch {}
            }
        }
    );
}

// ======================================================
// تشغيل بث
// ======================================================

async function startStreamFromData(
    chatId,
    name,
    key,
    url,
    streamType
) {

    name = String(name || "").trim();
    key = String(key || "").trim();
    url = String(url || "").trim();

    if (!name || !key || !url) {

        await bot.sendMessage(
            chatId,
            "❌ البيانات ناقصة."
        );

        return false;
    }

    await bot.sendMessage(
        chatId,

        `🔍 جاري فحص الرابط بواسطة FFprobe...\n\n` +
        `📺 ${name}`
    );

    const probe =
        await probeUrl(url);

    if (!probe.ok) {

        await bot.sendMessage(
            chatId,

            `❌ فشل فحص البث:\n\n` +
            `📺 ${name}\n\n` +
            `${probe.error || "الرابط غير صالح."}`
        );

        return false;
    }

    const streamId =
        makeId();

    const output =
        FACEBOOK_RTMP + key;

    const {
        args,
        isMp4
    } =
        buildFFmpegArgs(
            url,
            output
        );

    console.log(
        `🚀 Starting stream: ${name}`
    );

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

            `❌ تعذر تشغيل FFmpeg:\n\n` +
            error.message
        );

        return false;
    }

    process.once(
        "error",
        async (error) => {

            console.error(
                `FFmpeg error ${name}:`,
                error
            );

            const stream =
                streams[streamId];

            if (stream) {

                delete streams[streamId];

                try {

                    await bot.sendMessage(
                        chatId,

                        `❌ حدث خطأ في بث:\n\n` +
                        `📺 ${name}\n\n` +
                        error.message
                    );

                } catch {}
            }
        }
    );

    streams[streamId] = {

        id: streamId,

        chatId,

        name,

        key,

        url,

        type: streamType,

        process,

        startedAt: Date.now(),

        status: "يعمل",

        isMp4,

        manualStop: false
    };

    monitorFFmpeg(
        streamId,
        process
    );

    await bot.sendMessage(
        chatId,

        `✅ تم تشغيل البث\n\n` +

        `📺 الاسم:\n${name}\n\n` +

        `🔑 المفتاح:\n${maskKey(key)}\n\n` +

        `🔗 الرابط:\n${url}\n\n` +

        `📡 النوع:\n${streamType}\n\n` +

        `🔄 تكرار MP4:\n` +
        `${isMp4 ? "مفعّل ✅" : "غير مطلوب"}\n\n` +

        `🟢 الحالة:\nيعمل`,

        mainKeyboard()
    );

    return true;
}

// ======================================================
// إيقاف بث
// ======================================================

function stopStream(streamId) {

    const stream =
        streams[streamId];

    if (!stream) {
        return false;
    }

    stream.manualStop =
        true;

    stream.status =
        "متوقف";

    const process =
        stream.process;

    try {

        process.kill(
            "SIGTERM"
        );

    } catch {}

    delete streams[streamId];

    return true;
}

// ======================================================
// إيقاف جميع البثوث
// ======================================================

async function stopAll(chatId) {

    const list =
        getStreamsForUser(chatId);

    if (list.length === 0) {

        await bot.sendMessage(
            chatId,
            "📊 لا توجد بثوث نشطة."
        );

        return;
    }

    for (const stream of list) {

        stopStream(
            stream.id
        );
    }

    await bot.sendMessage(
        chatId,

        `⛔ تم إيقاف جميع البثوث.\n\n` +
        `عدد البثوث: ${list.length}`,

        mainKeyboard()
    );
}

// ======================================================
// الحالة
// ======================================================

async function sendStatus(chatId) {

    const list =
        getStreamsForUser(chatId);

    if (list.length === 0) {

        await bot.sendMessage(
            chatId,

            "📺 البثوث:\n\n" +
            "لا توجد بثوث نشطة.",

            mainKeyboard()
        );

        return;
    }

    let text =
        "📺 البثوث النشطة:\n\n";

    list.forEach(
        (stream, index) => {

            text +=
                `${index + 1}️⃣ ${stream.name}\n` +

                `   🔑 ${maskKey(
                    stream.key
                )}\n` +

                `   📡 ${stream.type}\n` +

                `   🟢 ${stream.status}\n` +

                `   🔄 MP4: ${
                    stream.isMp4
                        ? "نعم"
                        : "لا"
                }\n\n`;
        }
    );

    await bot.sendMessage(
        chatId,
        text,
        mainKeyboard()
    );
}

// ======================================================
// START
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

            const text =
                msg.text.trim();

            // ==================================================
            // /start
            // ==================================================

            if (text === "/start") {

                delete users[chatId];

                await bot.sendMessage(
                    chatId,

                    "👋 مرحباً\n\n" +

                    "🎯 SOLO\n" +
                    "تشغيل بث واحد.\n\n" +

                    "🔥 GROUP\n" +
                    "تشغيل عدة بثوث في نفس الوقت.\n\n" +

                    "🛑 STOP\n" +
                    "إيقاف بث معين أو جميع البثوث.\n\n" +

                    "📊 الحالة\n" +
                    "عرض حالة جميع البثوث.\n\n" +

                    "🔍 فحص الرابط\n" +
                    "فحص رابط البث بواسطة FFprobe.",

                    mainKeyboard()
                );

                return;
            }

            // ==================================================
            // SOLO
            // ==================================================

            if (text === "🎯 SOLO") {

                users[chatId] = {

                    action: "solo",

                    step: "name"
                };

                await bot.sendMessage(
                    chatId,

                    "🎯 SOLO\n\n" +
                    "📺 اسم البث؟"
                );

                return;
            }

            // ==================================================
            // GROUP
            // ==================================================

            if (text === "🔥 GROUP") {

                users[chatId] = {

                    action: "group",

                    step: "count"
                };

                await bot.sendMessage(
                    chatId,

                    "🔥 GROUP\n\n" +
                    "🔢 كم عدد البثوث التي تريد تشغيلها؟"
                );

                return;
            }

            // ==================================================
            // STOP
            // ==================================================

            if (text === "🛑 STOP") {

                await bot.sendMessage(
                    chatId,

                    "🛑 اختر:",

                    stopKeyboard()
                );

                return;
            }

            // ==================================================
            // STOP STREAM
            // ==================================================

            if (
                text ===
                "🛑 إيقاف بث معين"
            ) {

                const list =
                    getStreamsForUser(
                        chatId
                    );

                if (list.length === 0) {

                    await bot.sendMessage(
                        chatId,
                        "📊 لا توجد بثوث نشطة."
                    );

                    return;
                }

                let message =
                    "🛑 اختر رقم البث لإيقافه:\n\n";

                list.forEach(
                    (stream, index) => {

                        message +=
                            `${index + 1}️⃣ ${stream.name}\n`;
                    }
                );

                users[chatId] = {

                    action: "stop",

                    step: "number",

                    list
                };

                await bot.sendMessage(
                    chatId,
                    message
                );

                return;
            }

            // ==================================================
            // STOP ALL
            // ==================================================

            if (
                text ===
                "⛔ إيقاف جميع البثوث"
            ) {

                await stopAll(chatId);

                return;
            }

            // ==================================================
            // STATUS
            // ==================================================

            if (text === "📊 الحالة") {

                await sendStatus(
                    chatId
                );

                return;
            }

            // ==================================================
            // CHECK
            // ==================================================

            if (
                text ===
                "🔍 فحص الرابط"
            ) {

                users[chatId] = {

                    action: "check",

                    step: "url"
                };

                await bot.sendMessage(
                    chatId,

                    "🔍 أرسل رابط البث لفحصه:"
                );

                return;
            }

            // ==================================================
            // BACK
            // ==================================================

            if (text === "↩️ رجوع") {

                delete users[chatId];

                await bot.sendMessage(
                    chatId,

                    "🏠 القائمة الرئيسية",

                    mainKeyboard()
                );

                return;
            }

            // ==================================================
            // لا توجد جلسة
            // ==================================================

            const state =
                users[chatId];

            if (!state) {
                return;
            }

            // ==================================================
            // SOLO
            // ==================================================

            if (
                state.action ===
                "solo"
            ) {

                if (
                    state.step ===
                    "name"
                ) {

                    state.name =
                        text;

                    state.step =
                        "key";

                    await bot.sendMessage(
                        chatId,

                        `📺 الاسم: ${state.name}\n\n` +
                        "🔑 أرسل مفتاح Facebook:"
                    );

                    return;
                }

                if (
                    state.step ===
                    "key"
                ) {

                    state.key =
                        text;

                    state.step =
                        "url";

                    await bot.sendMessage(
                        chatId,

                        "🔗 أرسل رابط البث:"
                    );

                    return;
                }

                if (
                    state.step ===
                    "url"
                ) {

                    state.url =
                        text;

                    const name =
                        state.name;

                    const key =
                        state.key;

                    const url =
                        state.url;

                    delete users[chatId];

                    await startStreamFromData(
                        chatId,
                        name,
                        key,
                        url,
                        "SOLO"
                    );

                    return;
                }
            }

            // ==================================================
            // GROUP
            // ==================================================

            if (
                state.action ===
                "group"
            ) {

                if (
                    state.step ===
                    "count"
                ) {

                    const count =
                        Number(text);

                    if (
                        !Number.isInteger(count) ||
                        count < 1 ||
                        count > 50
                    ) {

                        await bot.sendMessage(
                            chatId,

                            "❌ أرسل عددًا بين 1 و50."
                        );

                        return;
                    }

                    state.count =
                        count;

                    state.current =
                        1;

                    state.items =
                        [];

                    state.step =
                        "name";

                    await bot.sendMessage(
                        chatId,

                        `🔥 GROUP\n\n` +
                        `📺 البث 1 من ${count}\n\n` +
                        "📛 اسم البث؟"
                    );

                    return;
                }

                if (
                    state.step ===
                    "name"
                ) {

                    state.name =
                        text;

                    state.step =
                        "key";

                    await bot.sendMessage(
                        chatId,

                        "🔑 أرسل مفتاح Facebook:"
                    );

                    return;
                }

                if (
                    state.step ===
                    "key"
                ) {

                    state.key =
                        text;

                    state.step =
                        "url";

                    await bot.sendMessage(
                        chatId,

                        "🔗 أرسل رابط البث:"
                    );

                    return;
                }

                if (
                    state.step ===
                    "url"
                ) {

                    state.items.push({

                        name:
                            state.name,

                        key:
                            state.key,

                        url:
                            text
                    });

                    if (
                        state.current <
                        state.count
                    ) {

                        state.current++;

                        state.step =
                            "name";

                        await bot.sendMessage(
                            chatId,

                            `🔥 GROUP\n\n` +
                            `📺 البث ${state.current} من ${state.count}\n\n` +
                            "📛 اسم البث؟"
                        );

                        return;
                    }

                    const items =
                        state.items;

                    delete users[chatId];

                    await bot.sendMessage(
                        chatId,

                        `🔥 تم إدخال ${items.length} بثوث.\n\n` +
                        "🔍 جاري فحص الروابط..."
                    );

                    let started = 0;

                    for (
                        const item of items
                    ) {

                        const result =
                            await startStreamFromData(
                                chatId,
                                item.name,
                                item.key,
                                item.url,
                                "GROUP"
                            );

                        if (result) {
                            started++;
                        }
                    }

                    await bot.sendMessage(
                        chatId,

                        `🔥 انتهى تشغيل GROUP\n\n` +
                        `📊 المطلوب: ${items.length}\n` +
                        `🟢 تم التشغيل: ${started}\n` +
                        `🔴 فشل: ${
                            items.length -
                            started
                        }`,

                        mainKeyboard()
                    );

                    return;
                }
            }

            // ==================================================
            // STOP
            // ==================================================

            if (
                state.action ===
                "stop"
            ) {

                if (
                    state.step ===
                    "number"
                ) {

                    const number =
                        Number(text);

                    if (
                        !Number.isInteger(number) ||
                        number < 1 ||
                        number > state.list.length
                    ) {

                        await bot.sendMessage(
                            chatId,
                            "❌ رقم غير صحيح."
                        );

                        return;
                    }

                    const stream =
                        state.list[
                            number - 1
                        ];

                    stopStream(
                        stream.id
                    );

                    delete users[chatId];

                    await bot.sendMessage(
                        chatId,

                        `🛑 تم إيقاف البث:\n\n` +

                        `📺 ${stream.name}\n\n` +

                        `🔑 ${maskKey(
                            stream.key
                        )}`,

                        mainKeyboard()
                    );

                    return;
                }
            }

            // ==================================================
            // CHECK
            // ==================================================

            if (
                state.action ===
                "check"
            ) {

                if (
                    state.step ===
                    "url"
                ) {

                    delete users[chatId];

                    await bot.sendMessage(
                        chatId,

                        "🔍 جاري فحص الرابط بواسطة FFprobe..."
                    );

                    const result =
                        await probeUrl(
                            text
                        );

                    if (!result.ok) {

                        await bot.sendMessage(
                            chatId,

                            `❌ فشل فحص الرابط.\n\n` +
                            `${result.error ||
                                "الرابط غير صالح أو غير قابل للوصول."}`,

                            mainKeyboard()
                        );

                        return;
                    }

                    await bot.sendMessage(
                        chatId,

                        `✅ الرابط يعمل\n\n` +

                        `🌐 الرابط:\n${text}\n\n` +

                        `🎥 الفيديو:\n${result.video}\n\n` +

                        `🔊 الصوت:\n${result.audio}\n\n` +

                        `⏱ المدة:\n${result.duration}\n\n` +

                        `📡 المصدر:\n${result.format}`,

                        mainKeyboard()
                    );

                    return;
                }
            }
        }

        catch (error) {

            console.error(
                "BOT ERROR:",
                error
            );

            try {

                await bot.sendMessage(
                    msg.chat.id,

                    "❌ حدث خطأ:\n\n" +
                    error.message
                );

            } catch {}
        }
    }
);

// ======================================================
// Telegram polling errors
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

function shutdown() {

    console.log(
        "🛑 إيقاف البثوث..."
    );

    for (
        const streamId of
        Object.keys(streams)
    ) {

        try {

            streams[streamId]
                .manualStop = true;

            streams[streamId]
                .process
                .kill("SIGTERM");

        } catch {}
    }

    process.exit(0);
}

process.on(
    "SIGTERM",
    shutdown
);

process.on(
    "SIGINT",
    shutdown
);
