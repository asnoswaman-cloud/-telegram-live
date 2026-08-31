// ============================================================
// DARK STREAM BOT
// SOLO + GROUP
// MP4 LOOP
// IMAGE OVERLAY
// FACEBOOK RTMPS
// AUTO RESTART
// ============================================================

const TelegramBot = require("node-telegram-bot-api");
const { spawn, execFile } = require("child_process");
const fs = require("fs");
const https = require("https");
const http = require("http");
const path = require("path");

// ============================================================
// TELEGRAM TOKEN
// ============================================================

const TOKEN = "8938418856:AAHmkAy9CWRzuHmZc4b5bUmqSSZUGSbwUN4";

// ============================================================
// FACEBOOK RTMPS
// ============================================================

const FACEBOOK_RTMP =
    "rtmps://live-api-s.facebook.com:443/rtmp/";

// ============================================================
// IMAGE URL
// ============================================================

const IMAGE_URL =
    "https://yourimageshare.com/ib/tMIVKF0fCw.png";

// ============================================================
// IMAGE SETTINGS
// ============================================================

// حجم الصورة
const IMAGE_WIDTH = 171;

// مكان الصورة
// من اليمين
const IMAGE_RIGHT = 75;

// من الأعلى
const IMAGE_TOP = 43;

// ============================================================
// LOCAL IMAGE
// ============================================================

const IMAGE_FILE =
    path.join(process.cwd(), "stream-logo.png");

// ============================================================
// CHECK TOKEN
// ============================================================

if (
    !TOKEN ||
    TOKEN === "PUT_YOUR_TELEGRAM_BOT_TOKEN_HERE"
) {
    console.error(
        "❌ ضع Telegram Bot Token داخل TOKEN"
    );

    process.exit(1);
}

// ============================================================
// TELEGRAM
// ============================================================

const bot = new TelegramBot(
    TOKEN,
    {
        polling: true
    }
);

console.log(
    "🤖 DARK STREAM BOT Started"
);

// ============================================================
// STREAM STORAGE
// ============================================================

const streams = {};

const sessions = {};

// ============================================================
// DOWNLOAD IMAGE
// ============================================================

function downloadFile(url, output) {

    return new Promise((resolve, reject) => {

        const client =
            url.startsWith("https://")
                ? https
                : http;

        const request =
            client.get(
                url,
                response => {

                    // Redirect
                    if (
                        response.statusCode >= 300 &&
                        response.statusCode < 400 &&
                        response.headers.location
                    ) {

                        response.resume();

                        downloadFile(
                            response.headers.location,
                            output
                        )
                            .then(resolve)
                            .catch(reject);

                        return;
                    }

                    if (
                        response.statusCode !== 200
                    ) {

                        response.resume();

                        reject(
                            new Error(
                                "HTTP " +
                                response.statusCode
                            )
                        );

                        return;
                    }

                    const file =
                        fs.createWriteStream(
                            output
                        );

                    response.pipe(file);

                    file.on(
                        "finish",
                        () => {

                            file.close(
                                () => {

                                    resolve(
                                        output
                                    );

                                }
                            );

                        }
                    );

                    file.on(
                        "error",
                        error => {

                            try {
                                file.close();
                            } catch {}

                            reject(error);
                        }
                    );
                }
            );

        request.setTimeout(
            30000,
            () => {

                request.destroy(
                    new Error(
                        "Image download timeout"
                    )
                );

            }
        );

        request.on(
            "error",
            reject
        );
    });
}

// ============================================================
// PREPARE IMAGE
// ============================================================

async function prepareImage() {

    try {

        console.log(
            "🖼️ جاري تحميل صورة البث..."
        );

        await downloadFile(
            IMAGE_URL,
            IMAGE_FILE
        );

        if (
            !fs.existsSync(IMAGE_FILE)
        ) {

            throw new Error(
                "الصورة لم يتم تحميلها"
            );
        }

        const stat =
            fs.statSync(
                IMAGE_FILE
            );

        if (
            stat.size < 100
        ) {

            throw new Error(
                "ملف الصورة غير صالح"
            );
        }

        console.log(
            "✅ تم تحميل الصورة"
        );

        console.log(
            "📁 " + IMAGE_FILE
        );

        console.log(
            "📦 " +
            stat.size +
            " bytes"
        );

        return true;

    } catch (error) {

        console.error(
            "❌ خطأ تحميل الصورة:",
            error.message
        );

        return false;
    }
}

// ============================================================
// MASK FACEBOOK KEY
// ============================================================

function maskKey(key) {

    if (!key) {
        return "****";
    }

    key =
        String(key).trim();

    if (
        key.length <= 8
    ) {

        return "****";
    }

    return (
        key.substring(0, 4) +
        "****" +
        key.substring(
            key.length - 4
        )
    );
}

// ============================================================
// MAIN KEYBOARD
// ============================================================

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
                        text: "🔥 GROUP"
                    }
                ],

                [
                    {
                        text: "🛑 STOP"
                    }
                ],

                [
                    {
                        text: "📊 الحالة"
                    }
                ],

                [
                    {
                        text: "🔍 فحص الرابط"
                    }
                ],

                [
                    {
                        text: "📊 حالة بث معين"
                    }
                ]

            ],

            resize_keyboard: true
        }
    };
}

// ============================================================
// IS MP4
// ============================================================

function isMp4(source) {

    try {

        const clean =
            String(source)
                .split("?")[0]
                .split("#")[0];

        return /\.mp4$/i.test(
            clean
        );

    } catch {

        return false;
    }
}

// ============================================================
// BUILD FFMPEG
// ============================================================

function buildFFmpeg(
    source,
    facebookKey
) {

    const mp4 =
        isMp4(source);

    const target =
        FACEBOOK_RTMP +
        facebookKey;

    const args = [];

    // ========================================================
    // MP4 LOOP
    // ========================================================

    if (mp4) {

        args.push(
            "-stream_loop",
            "-1"
        );
    }

    // ========================================================
    // SOURCE INPUT
    // ========================================================

    args.push(

        "-re",

        "-reconnect",
        "1",

        "-reconnect_streamed",
        "1",

        "-reconnect_at_eof",
        "1",

        "-reconnect_delay_max",
        "10",

        "-i",
        source
    );

    // ========================================================
    // IMAGE INPUT
    // ========================================================

    args.push(

        "-loop",
        "1",

        "-framerate",
        "30",

        "-i",
        IMAGE_FILE
    );

    // ========================================================
    // IMAGE OVERLAY
    //
    // الصورة:
    // أعلى اليمين
    // ========================================================

    args.push(

        "-filter_complex",

        "[1:v]" +
        "format=rgba," +
        "scale=" +
        IMAGE_WIDTH +
        ":-1" +
        "[logo];" +

        "[0:v][logo]" +
        "overlay=" +
        "W-w-" +
        IMAGE_RIGHT +
        ":" +
        IMAGE_TOP +
        ":format=auto" +
        "[vout]"
    );

    // ========================================================
    // OUTPUT
    // ========================================================

    args.push(

        "-map",
        "[vout]",

        "-map",
        "0:a:0?",

        // VIDEO
        "-c:v",
        "libx264",

        "-preset",
        "veryfast",

        "-tune",
        "zerolatency",

        "-pix_fmt",
        "yuv420p",

        // FPS
        "-r",
        "30",

        // GOP
        "-g",
        "60",

        "-keyint_min",
        "60",

        // VIDEO BITRATE
        "-b:v",
        "2500k",

        "-maxrate",
        "3000k",

        "-bufsize",
        "6000k",

        // AUDIO
        "-c:a",
        "aac",

        "-b:a",
        "128k",

        "-ar",
        "44100",

        // FACEBOOK
        "-flvflags",
        "no_duration_filesize",

        "-f",
        "flv",

        target
    );

    return args;
}

// ============================================================
// START STREAM
// ============================================================

async function startStream(
    chatId,
    name,
    facebookKey,
    source,
    type
) {

    name =
        String(name || "").trim();

    facebookKey =
        String(facebookKey || "").trim();

    source =
        String(source || "").trim();

    // ========================================================
    // VALIDATION
    // ========================================================

    if (
        !name ||
        !facebookKey ||
        !source
    ) {

        await bot.sendMessage(
            chatId,

            "❌ البيانات ناقصة.",

            mainKeyboard()
        );

        return false;
    }

    // ========================================================
    // DUPLICATE
    // ========================================================

    if (
        streams[name]
    ) {

        await bot.sendMessage(
            chatId,

            `⚠️ البث "${name}" يعمل بالفعل.`,

            mainKeyboard()
        );

        return false;
    }

    // ========================================================
    // IMAGE
    // ========================================================

    if (
        !fs.existsSync(IMAGE_FILE)
    ) {

        const ok =
            await prepareImage();

        if (!ok) {

            await bot.sendMessage(
                chatId,

                "❌ لم أستطع تحميل الصورة.\n\n" +
                "تأكد أن IMAGE_URL رابط مباشر للصورة.",

                mainKeyboard()
            );

            return false;
        }
    }

    // ========================================================
    // FFMPEG
    // ========================================================

    const args =
        buildFFmpeg(
            source,
            facebookKey
        );

    console.log("");
    console.log(
        "======================================"
    );

    console.log(
        "▶️ START STREAM"
    );

    console.log(
        "📛 NAME:",
        name
    );

    console.log(
        "📡 TYPE:",
        type
    );

    console.log(
        "🔗 SOURCE:",
        source
    );

    console.log(
        "🔑 KEY:",
        maskKey(facebookKey)
    );

    console.log(
        "🖼️ IMAGE:",
        IMAGE_FILE
    );

    console.log(
        "======================================"
    );

    // ========================================================
    // SPAWN
    // ========================================================

    let ffmpeg;

    try {

        ffmpeg =
            spawn(
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

    } catch (error) {

        await bot.sendMessage(
            chatId,

            "❌ تعذر تشغيل FFmpeg:\n\n" +
            error.message,

            mainKeyboard()
        );

        return false;
    }

    // ========================================================
    // SAVE STREAM
    // ========================================================

    streams[name] = {

        name,

        key:
            facebookKey,

        source,

        type,

        process:
            ffmpeg,

        startedAt:
            Date.now(),

        status:
            "starting",

        stopping:
            false,

        restartTimer:
            null
    };

    // ========================================================
    // STDOUT
    // ========================================================

    ffmpeg.stdout.on(
        "data",
        data => {

            console.log(
                `[FFMPEG ${name}]`,
                data.toString().trim()
            );

        }
    );

    // ========================================================
    // STDERR
    // ========================================================

    ffmpeg.stderr.on(
        "data",
        data => {

            const output =
                data
                    .toString()
                    .trim();

            if (output) {

                console.log(
                    `[FFMPEG ${name}]`,
                    output
                );
            }

        }
    );

    // ========================================================
    // PROCESS STARTED
    // ========================================================

    ffmpeg.on(
        "spawn",
        async () => {

            if (
                streams[name]
            ) {

                streams[name].status =
                    "running";
            }

            console.log(
                `🟢 FFmpeg running: ${name}`
            );

            try {

                await bot.sendMessage(
                    chatId,

                    "✅ تم تشغيل البث\n\n" +

                    `📛 ${name}\n` +

                    `📡 ${type}\n` +

                    `🔑 ${maskKey(facebookKey)}\n\n` +

                    "🖼️ الصورة: مفعّلة ✅\n" +

                    "📍 المكان: أعلى اليمين\n\n" +

                    "🟢 FFmpeg: يعمل",

                    mainKeyboard()
                );

            } catch {}

        }
    );

    // ========================================================
    // ERROR
    // ========================================================

    ffmpeg.on(
        "error",
        async error => {

            console.error(
                `❌ FFmpeg ERROR ${name}:`,
                error.message
            );

            if (
                streams[name]
            ) {

                streams[name].status =
                    "error";
            }

        }
    );

    // ========================================================
    // CLOSE
    // ========================================================

    ffmpeg.on(
        "close",
        async code => {

            console.log(
                `🛑 FFmpeg closed: ${name}`
            );

            console.log(
                `Exit code: ${code}`
            );

            const stream =
                streams[name];

            if (!stream) {
                return;
            }

            // ==================================================
            // MANUAL STOP
            // ==================================================

            if (
                stream.stopping
            ) {

                delete streams[name];

                return;
            }

            // ==================================================
            // AUTO RESTART
            // ==================================================

            console.log(
                `🔄 إعادة تشغيل ${name} بعد 5 ثوانٍ...`
            );

            stream.status =
                "restarting";

            stream.restartTimer =
                setTimeout(
                    async () => {

                        if (
                            !streams[name]
                        ) {
                            return;
                        }

                        delete streams[name];

                        await startStream(
                            chatId,
                            name,
                            facebookKey,
                            source,
                            type
                        );

                    },
                    5000
                );

        }
    );

    return true;
}

// ============================================================
// STOP STREAM
// ============================================================

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

            `❌ البث "${name}" غير موجود.`,

            mainKeyboard()
        );

        return;
    }

    stream.stopping =
        true;

    if (
        stream.restartTimer
    ) {

        clearTimeout(
            stream.restartTimer
        );
    }

    try {

        stream.process.kill(
            "SIGTERM"
        );

    } catch {}

    delete streams[name];

    await bot.sendMessage(
        chatId,

        `🛑 تم إيقاف "${name}".`,

        mainKeyboard()
    );
}

// ============================================================
// STOP ALL
// ============================================================

async function stopAll(
    chatId
) {

    const names =
        Object.keys(
            streams
        );

    if (
        names.length === 0
    ) {

        await bot.sendMessage(
            chatId,

            "ℹ️ لا توجد بثوث تعمل.",

            mainKeyboard()
        );

        return;
    }

    for (
        const name of names
    ) {

        const stream =
            streams[name];

        stream.stopping =
            true;

        if (
            stream.restartTimer
        ) {

            clearTimeout(
                stream.restartTimer
            );
        }

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

// ============================================================
// STATUS
// ============================================================

async function showStatus(
    chatId
) {

    const names =
        Object.keys(
            streams
        );

    if (
        names.length === 0
    ) {

        await bot.sendMessage(
            chatId,

            "📊 لا توجد بثوث نشطة.",

            mainKeyboard()
        );

        return;
    }

    let text =
        `📊 البثوث النشطة: ${names.length}\n\n`;

    for (
        const name of names
    ) {

        const stream =
            streams[name];

        const seconds =
            Math.floor(
                (
                    Date.now() -
                    stream.startedAt
                ) / 1000
            );

        const hours =
            Math.floor(
                seconds / 3600
            );

        const minutes =
            Math.floor(
                (
                    seconds % 3600
                ) / 60
            );

        const secs =
            seconds % 60;

        text +=

            `📛 ${name}\n` +

            `🔑 ${maskKey(stream.key)}\n` +

            `🟢 ${stream.status}\n` +

            `⏱ ${hours}س ${minutes}د ${secs}ث\n` +

            `📡 ${stream.type}\n` +

            `🖼️ الصورة: نعم\n` +

            `🔄 MP4 Loop: ` +

            `${isMp4(stream.source) ? "نعم" : "لا"}\n\n`;
    }

    await bot.sendMessage(
        chatId,
        text,
        mainKeyboard()
    );
}

// ============================================================
// CHECK SOURCE
// ============================================================

function checkSource(
    chatId,
    source
) {

    bot.sendMessage(
        chatId,

        "🔎 جاري فحص الرابط..."
    );

    execFile(
        "ffprobe",
        [

            "-v",
            "error",

            "-show_entries",
            "stream=codec_type,codec_name",

            "-show_entries",
            "format=format_name,duration",

            "-of",
            "json",

            source

        ],

        {
            timeout: 30000,
            maxBuffer: 1024 * 1024
        },

        async (
            error,
            stdout,
            stderr
        ) => {

            if (error) {

                await bot.sendMessage(
                    chatId,

                    "❌ الرابط لم يتمكن FFprobe من قراءته.\n\n" +
                    String(
                        stderr ||
                        error.message
                    ).slice(
                        0,
                        3000
                    ),

                    mainKeyboard()
                );

                return;
            }

            try {

                const data =
                    JSON.parse(
                        stdout
                    );

                const streamsFound =
                    data.streams || [];

                const video =
                    streamsFound.find(
                        x =>
                            x.codec_type ===
                            "video"
                    );

                const audio =
                    streamsFound.find(
                        x =>
                            x.codec_type ===
                            "audio"
                    );

                await bot.sendMessage(
                    chatId,

                    "✅ الرابط قابل للقراءة\n\n" +

                    `🎥 Video: ${
                        video?.codec_name ||
                        "غير موجود"
                    }\n` +

                    `🔊 Audio: ${
                        audio?.codec_name ||
                        "غير موجود"
                    }\n\n` +

                    `📦 Format: ${
                        data.format?.format_name ||
                        "غير معروف"
                    }`,

                    mainKeyboard()
                );

            } catch {

                await bot.sendMessage(
                    chatId,

                    "⚠️ FFprobe أعاد نتيجة غير مفهومة.",

                    mainKeyboard()
                );
            }

        }
    );
}

// ============================================================
// SEND MENU
// ============================================================

function sendMenu(
    chatId
) {

    return bot.sendMessage(
        chatId,

        "🤖 DARK STREAM BOT\n\n" +
        "اختر العملية:",

        mainKeyboard()
    );
}

// ============================================================
// MESSAGE HANDLER
// ============================================================

bot.on(
    "message",
    async msg => {

        try {

            if (
                !msg.text
            ) {
                return;
            }

            const chatId =
                msg.chat.id;

            const userId =
                msg.from?.id;

            const text =
                msg.text.trim();

            // ==================================================
            // START
            // ==================================================

            if (
                text === "/start"
            ) {

                delete sessions[userId];

                return sendMenu(
                    chatId
                );
            }

            // ==================================================
            // SOLO
            // ==================================================

            if (
                text === "🎯 SOLO"
            ) {

                sessions[userId] = {

                    type:
                        "solo",

                    step:
                        "name"
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
                text === "🔥 GROUP"
            ) {

                sessions[userId] = {

                    type:
                        "group",

                    step:
                        "count"
                };

                return bot.sendMessage(
                    chatId,

                    "👥 كم عدد البثوث؟\n\n" +
                    "مثال: 10"
                );
            }

            // ==================================================
            // STOP
            // ==================================================

            if (
                text === "🛑 STOP"
            ) {

                sessions[userId] = {

                    type:
                        "stop",

                    step:
                        "name"
                };

                return bot.sendMessage(
                    chatId,

                    "🛑 أرسل اسم البث الذي تريد إيقافه:"
                );
            }

            // ==================================================
            // STOP ALL
            // ==================================================

            if (
                text === "⛔ إيقاف جميع البثوث"
            ) {

                return stopAll(
                    chatId
                );
            }

            // ==================================================
            // STATUS
            // ==================================================

            if (
                text === "📊 الحالة"
            ) {

                return showStatus(
                    chatId
                );
            }

            // ==================================================
            // CHECK
            // ==================================================

            if (
                text === "🔍 فحص الرابط"
            ) {

                sessions[userId] = {

                    type:
                        "check",

                    step:
                        "url"
                };

                return bot.sendMessage(
                    chatId,

                    "🌐 أرسل رابط المصدر:"
                );
            }

            // ==================================================
            // STREAM STATUS
            // ==================================================

            if (
                text === "📊 حالة بث معين"
            ) {

                sessions[userId] = {

                    type:
                        "streamstatus",

                    step:
                        "name"
                };

                return bot.sendMessage(
                    chatId,

                    "📛 أرسل اسم البث:"
                );
            }

            // ==================================================
            // NO SESSION
            // ==================================================

            if (
                !sessions[userId]
            ) {

                return bot.sendMessage(
                    chatId,

                    "استخدم /start",
                    mainKeyboard()
                );
            }

            const session =
                sessions[userId];

            // ==================================================
            // SOLO
            // ==================================================

            if (
                session.type ===
                "solo"
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

                        "2️⃣ أرسل Facebook Stream Key:"
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

                        "3️⃣ أرسل رابط المصدر:"
                    );
                }

                if (
                    session.step ===
                    "url"
                ) {

                    const name =
                        session.name;

                    const key =
                        session.key;

                    delete sessions[userId];

                    return startStream(
                        chatId,
                        name,
                        key,
                        text,
                        "SOLO"
                    );
                }
            }

            // ==================================================
            // GROUP
            // ==================================================

            if (
                session.type ===
                "group"
            ) {

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
                        count > 50
                    ) {

                        return bot.sendMessage(
                            chatId,

                            "❌ أدخل رقمًا بين 1 و50."
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

                        `📡 البث 1 من ${count}\n\n` +
                        "أرسل اسم البث:"
                    );
                }

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

                        `🔑 البث ${session.current} من ${session.count}\n\n` +
                        "أرسل Facebook Stream Key:"
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

                        "🌐 أرسل رابط المصدر:"
                    );
                }

                if (
                    session.step ===
                    "url"
                ) {

                    await startStream(

                        chatId,

                        session.name,

                        session.key,

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

                            `✅ تم إعداد ${session.count} بثوث.`,

                            mainKeyboard()
                        );
                    }

                    session.current++;

                    session.step =
                        "name";

                    return bot.sendMessage(
                        chatId,

                        `📡 البث ${session.current} من ${session.count}\n\n` +
                        "أرسل اسم البث:"
                    );
                }
            }

            // ==================================================
            // STOP
            // ==================================================

            if (
                session.type ===
                "stop"
            ) {

                if (
                    session.step ===
                    "name"
                ) {

                    delete sessions[userId];

                    return stopStream(
                        chatId,
                        text
                    );
                }
            }

            // ==================================================
            // CHECK
            // ==================================================

            if (
                session.type ===
                "check"
            ) {

                if (
                    session.step ===
                    "url"
                ) {

                    delete sessions[userId];

                    return checkSource(
                        chatId,
                        text
                    );
                }
            }

            // ==================================================
            // STREAM STATUS
            // ==================================================

            if (
                session.type ===
                "streamstatus"
            ) {

                if (
                    session.step ===
                    "name"
                ) {

                    const name =
                        text;

                    delete sessions[userId];

                    const stream =
                        streams[name];

                    if (!stream) {

                        return bot.sendMessage(
                            chatId,

                            `❌ البث "${name}" غير موجود.`,

                            mainKeyboard()
                        );
                    }

                    const seconds =
                        Math.floor(
                            (
                                Date.now() -
                                stream.startedAt
                            ) / 1000
                        );

                    return bot.sendMessage(
                        chatId,

                        "📊 حالة البث\n\n" +

                        `📛 ${name}\n` +

                        `🟢 ${stream.status}\n` +

                        `⏱ ${seconds} ثانية\n` +

                        `📡 ${stream.type}\n` +

                        "🖼️ الصورة: نعم\n" +

                        "📍 المكان: أعلى اليمين",

                        mainKeyboard()
                    );
                }
            }

        } catch (error) {

            console.error(
                "❌ BOT ERROR:",
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

// ============================================================
// TELEGRAM ERROR
// ============================================================

bot.on(
    "polling_error",
    error => {

        console.error(
            "Telegram polling error:",
            error?.message ||
            error
        );
    }
);

// ============================================================
// SAFE SHUTDOWN
// ============================================================

function shutdown() {

    console.log(
        "🛑 Shutdown..."
    );

    for (
        const name of Object.keys(streams)
    ) {

        try {

            streams[name].stopping =
                true;

            streams[name].process.kill(
                "SIGTERM"
            );

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

// ============================================================
// PREPARE IMAGE
// ============================================================

prepareImage()
    .then(ok => {

        if (ok) {

            console.log(
                "🖼️ صورة البث جاهزة ✅"
            );

        } else {

            console.log(
                "⚠️ صورة البث غير جاهزة."
            );
        }

    });
