import TelegramBot from "node-telegram-bot-api";
import { spawn, execFile } from "child_process";
import fs from "fs";
import https from "https";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

// ============================================================
// PATH
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// TELEGRAM TOKEN
// ============================================================

const TOKEN = process.env.TELEGRAM_TOKEN || "PUT_YOUR_TOKEN_HERE";

// ============================================================
// FACEBOOK RTMPS
// ============================================================

const FACEBOOK_RTMP =
    "rtmps://live-api-s.facebook.com:443/rtmp/";

// ============================================================
// IMAGE URL
// ضع هنا رابط الصورة المباشر
// ============================================================

const IMAGE_URL =
    "https://yourimageshare.com/ib/tMIVKF0fCw.png";

// ============================================================
// IMAGE SETTINGS
// ============================================================

// عرض الصورة
const IMAGE_WIDTH = 171;

// المسافة من اليمين
const IMAGE_RIGHT = 75;

// المسافة من الأعلى
const IMAGE_TOP = 43;

// ============================================================
// LOCAL IMAGE
// ============================================================

const IMAGE_FILE =
    path.join(__dirname, "stream-image.png");

// ============================================================
// STREAMS
// ============================================================

const streams = new Map();

// ============================================================
// USER SESSIONS
// ============================================================

const sessions = new Map();

// ============================================================
// CHECK TOKEN
// ============================================================

if (
    !TOKEN ||
    TOKEN === "PUT_YOUR_TOKEN_HERE"
) {
    console.error(
        "❌ TELEGRAM_TOKEN غير موجود."
    );

    process.exit(1);
}

// ============================================================
// TELEGRAM BOT
// ============================================================

const bot = new TelegramBot(
    TOKEN,
    {
        polling: true
    }
);

console.log("");
console.log("==============================");
console.log("🤖 DARK STREAM BOT Started");
console.log("==============================");

// ============================================================
// DOWNLOAD IMAGE
// ============================================================

function downloadImage(url, destination) {

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

                        downloadImage(
                            response.headers.location,
                            destination
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
                                `HTTP ${response.statusCode}`
                            )
                        );

                        return;
                    }

                    const file =
                        fs.createWriteStream(
                            destination
                        );

                    response.pipe(file);

                    file.on(
                        "finish",
                        () => {

                            file.close(
                                () => resolve(
                                    destination
                                )
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

        await downloadImage(
            IMAGE_URL,
            IMAGE_FILE
        );

        if (
            !fs.existsSync(
                IMAGE_FILE
            )
        ) {

            throw new Error(
                "الصورة لم يتم تحميلها"
            );
        }

        const size =
            fs.statSync(
                IMAGE_FILE
            ).size;

        if (
            size < 100
        ) {

            throw new Error(
                "ملف الصورة فارغ أو غير صالح"
            );
        }

        console.log(
            `✅ تم تحميل الصورة (${size} bytes)`
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
// KEY MASK
// ============================================================

function maskKey(key) {

    if (!key) {
        return "****";
    }

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
// KEYBOARD
// ============================================================

function keyboard() {

    return {

        reply_markup: {

            keyboard: [

                [
                    "🎯 SOLO",
                    "🔥 GROUP"
                ],

                [
                    "📊 الحالة",
                    "🛑 STOP"
                ],

                [
                    "🔍 فحص الرابط"
                ]

            ],

            resize_keyboard: true

        }

    };
}

// ============================================================
// IS MP4
// ============================================================

function isMP4(source) {

    const clean =
        String(source)
            .split("?")[0]
            .split("#")[0];

    return /\.mp4$/i.test(clean);
}

// ============================================================
// BUILD FFMPEG ARGS
// ============================================================

function buildFFmpegArgs(
    source,
    streamKey
) {

    const args = [];

    const mp4 =
        isMP4(source);

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
    // SOURCE
    // ========================================================

    args.push(
        "-re"
    );

    // Reconnect options
    // مناسبة للمصادر الشبكية

    if (!mp4) {

        args.push(
            "-reconnect",
            "1",

            "-reconnect_streamed",
            "1",

            "-reconnect_at_eof",
            "1",

            "-reconnect_delay_max",
            "10"
        );

    }

    args.push(
        "-i",
        source
    );

    // ========================================================
    // IMAGE
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
    // OVERLAY
    //
    // الصورة في أعلى اليمين
    // ========================================================

    args.push(

        "-filter_complex",

        `[1:v]format=rgba,scale=${IMAGE_WIDTH}:-1[logo];` +
        `[0:v][logo]overlay=W-w-${IMAGE_RIGHT}:${IMAGE_TOP}:format=auto[v]`

    );

    // ========================================================
    // VIDEO
    // ========================================================

    args.push(

        "-map",
        "[v]",

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
        "6000k"

    );

    // ========================================================
    // AUDIO
    // ========================================================

    args.push(

        "-c:a",
        "aac",

        "-b:a",
        "128k",

        "-ar",
        "44100",

        "-ac",
        "2"

    );

    // ========================================================
    // FACEBOOK
    // ========================================================

    args.push(

        "-flvflags",
        "no_duration_filesize",

        "-f",
        "flv",

        FACEBOOK_RTMP +
        streamKey

    );

    return args;
}

// ============================================================
// START STREAM
// ============================================================

async function startStream(
    chatId,
    name,
    key,
    source,
    type
) {

    name =
        String(name).trim();

    key =
        String(key).trim();

    source =
        String(source).trim();

    // ========================================================
    // VALIDATION
    // ========================================================

    if (
        !name ||
        !key ||
        !source
    ) {

        await bot.sendMessage(
            chatId,
            "❌ البيانات ناقصة.",
            keyboard()
        );

        return;

    }

    // ========================================================
    // DUPLICATE
    // ========================================================

    if (
        streams.has(name)
    ) {

        await bot.sendMessage(
            chatId,

            `⚠️ البث "${name}" يعمل بالفعل.`,

            keyboard()
        );

        return;
    }

    // ========================================================
    // IMAGE
    // ========================================================

    if (
        !fs.existsSync(
            IMAGE_FILE
        )
    ) {

        const ok =
            await prepareImage();

        if (!ok) {

            await bot.sendMessage(
                chatId,

                "❌ فشل تحميل الصورة.\n\n" +
                "تأكد أن IMAGE_URL رابط مباشر للصورة.",

                keyboard()
            );

            return;
        }
    }

    // ========================================================
    // FFMPEG
    // ========================================================

    const args =
        buildFFmpegArgs(
            source,
            key
        );

    console.log("");
    console.log(
        "===================================="
    );

    console.log(
        `▶️ START: ${name}`
    );

    console.log(
        `📡 TYPE: ${type}`
    );

    console.log(
        `🔗 SOURCE: ${source}`
    );

    console.log(
        `🔑 KEY: ${maskKey(key)}`
    );

    console.log(
        `🖼️ IMAGE: ENABLED`
    );

    console.log(
        "===================================="
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
                        "pipe",
                        "pipe"
                    ]
                }
            );

    } catch (error) {

        console.error(
            "❌ FFmpeg spawn error:",
            error.message
        );

        await bot.sendMessage(
            chatId,

            "❌ تعذر تشغيل FFmpeg:\n\n" +
            error.message,

            keyboard()
        );

        return;
    }

    // ========================================================
    // SAVE
    // ========================================================

    const stream = {

        name,

        key,

        source,

        type,

        process,

        chatId,

        startedAt:
            Date.now(),

        status:
            "starting",

        stopping:
            false,

        restartTimer:
            null

    };

    streams.set(
        name,
        stream
    );

    // ========================================================
    // STDOUT
    // ========================================================

    process.stdout.on(
        "data",
        data => {

            const output =
                data
                    .toString()
                    .trim();

            if (output) {

                console.log(
                    `[FFMPEG ${name}] ${output}`
                );

            }

        }
    );

    // ========================================================
    // STDERR
    //
    // FFmpeg يكتب المعلومات والأخطاء هنا
    // ========================================================

    process.stderr.on(
        "data",
        data => {

            const output =
                data
                    .toString()
                    .trim();

            if (output) {

                console.log(
                    `[FFMPEG ${name}] ${output}`
                );

            }

        }
    );

    // ========================================================
    // SPAWN
    // ========================================================

    process.on(
        "spawn",
        async () => {

            const current =
                streams.get(name);

            if (current) {

                current.status =
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

                    "🖼️ الصورة: مفعلة ✅\n" +

                    "📍 المكان: أعلى اليمين\n\n" +

                    "🟢 FFmpeg: يعمل",

                    keyboard()
                );

            } catch {}

        }
    );

    // ========================================================
    // ERROR
    // ========================================================

    process.on(
        "error",
        error => {

            console.error(
                `❌ FFmpeg ERROR [${name}]`,
                error.message
            );

            const current =
                streams.get(name);

            if (current) {

                current.status =
                    "error";

            }

        }
    );

    // ========================================================
    // CLOSE
    // ========================================================

    process.on(
        "close",
        async code => {

            console.log(
                `🛑 FFmpeg closed: ${name} | code=${code}`
            );

            const current =
                streams.get(name);

            if (!current) {
                return;
            }

            // Manual stop
            if (
                current.stopping
            ) {

                streams.delete(
                    name
                );

                console.log(
                    `🛑 Stream stopped: ${name}`
                );

                return;
            }

            // ==================================================
            // AUTO RESTART
            // ==================================================

            console.log(
                `🔄 إعادة تشغيل ${name} بعد 5 ثوانٍ...`
            );

            current.status =
                "restarting";

            current.restartTimer =
                setTimeout(
                    async () => {

                        if (
                            !streams.has(name)
                        ) {

                            return;
                        }

                        streams.delete(
                            name
                        );

                        await startStream(
                            chatId,
                            name,
                            key,
                            source,
                            type
                        );

                    },
                    5000
                );

        }
    );
}

// ============================================================
// STOP STREAM
// ============================================================

async function stopStream(
    chatId,
    name
) {

    name =
        String(name).trim();

    const stream =
        streams.get(name);

    if (!stream) {

        await bot.sendMessage(
            chatId,

            `❌ البث "${name}" غير موجود.`,

            keyboard()
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

    streams.delete(
        name
    );

    await bot.sendMessage(
        chatId,

        `🛑 تم إيقاف البث "${name}".`,

        keyboard()
    );
}

// ============================================================
// STOP ALL
// ============================================================

async function stopAll(
    chatId
) {

    const list =
        [...streams.values()];

    if (
        list.length === 0
    ) {

        await bot.sendMessage(
            chatId,

            "ℹ️ لا توجد بثوث تعمل.",

            keyboard()
        );

        return;
    }

    for (
        const stream of list
    ) {

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

        streams.delete(
            stream.name
        );

    }

    await bot.sendMessage(
        chatId,

        `🛑 تم إيقاف ${list.length} بثوث.`,

        keyboard()
    );
}

// ============================================================
// STATUS
// ============================================================

async function showStatus(
    chatId
) {

    const list =
        [...streams.values()];

    if (
        list.length === 0
    ) {

        await bot.sendMessage(
            chatId,

            "📊 لا توجد بثوث نشطة.",

            keyboard()
        );

        return;
    }

    let text =
        `📊 البثوث النشطة: ${list.length}\n\n`;

    for (
        const stream of list
    ) {

        const seconds =
            Math.floor(
                (
                    Date.now() -
                    stream.startedAt
                ) / 1000
            );

        const minutes =
            Math.floor(
                seconds / 60
            );

        const secs =
            seconds % 60;

        text +=

            `📛 ${stream.name}\n` +

            `🔑 ${maskKey(stream.key)}\n` +

            `🟢 ${stream.status}\n` +

            `⏱ ${minutes}د ${secs}ث\n` +

            `📡 ${stream.type}\n` +

            `🖼️ الصورة: نعم\n` +

            `🔄 MP4 Loop: ` +

            `${isMP4(stream.source) ? "نعم" : "لا"}\n\n`;

    }

    await bot.sendMessage(
        chatId,
        text,
        keyboard()
    );
}

// ============================================================
// CHECK SOURCE
// ============================================================

async function checkSource(
    chatId,
    source
) {

    await bot.sendMessage(
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

                    "❌ فشل فحص الرابط:\n\n" +
                    String(
                        stderr ||
                        error.message
                    ).slice(
                        0,
                        3000
                    ),

                    keyboard()
                );

                return;
            }

            try {

                const data =
                    JSON.parse(
                        stdout
                    );

                const list =
                    data.streams || [];

                const video =
                    list.find(
                        x =>
                            x.codec_type ===
                            "video"
                    );

                const audio =
                    list.find(
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

                    keyboard()
                );

            } catch {

                await bot.sendMessage(
                    chatId,

                    "⚠️ تعذر قراءة نتيجة FFprobe.",

                    keyboard()
                );

            }

        }
    );
}

// ============================================================
// TELEGRAM MESSAGE
// ============================================================

bot.on(
    "message",
    async message => {

        try {

            if (
                !message.text
            ) {

                return;
            }

            const chatId =
                message.chat.id;

            const userId =
                message.from?.id;

            const text =
                message.text.trim();

            // ==================================================
            // START
            // ==================================================

            if (
                text === "/start"
            ) {

                sessions.delete(
                    userId
                );

                await bot.sendMessage(
                    chatId,

                    "🤖 DARK STREAM BOT\n\n" +
                    "اختر العملية:",

                    keyboard()
                );

                return;
            }

            // ==================================================
            // SOLO
            // ==================================================

            if (
                text === "🎯 SOLO"
            ) {

                sessions.set(
                    userId,

                    {
                        type: "solo",
                        step: "name"
                    }
                );

                await bot.sendMessage(
                    chatId,

                    "1️⃣ أرسل اسم البث:"
                );

                return;
            }

            // ==================================================
            // GROUP
            // ==================================================

            if (
                text === "🔥 GROUP"
            ) {

                sessions.set(
                    userId,

                    {
                        type: "group",
                        step: "count"
                    }
                );

                await bot.sendMessage(
                    chatId,

                    "👥 كم عدد البثوث؟\n\n" +
                    "مثال: 10"
                );

                return;
            }

            // ==================================================
            // STOP
            // ==================================================

            if (
                text === "🛑 STOP"
            ) {

                sessions.set(
                    userId,

                    {
                        type: "stop",
                        step: "name"
                    }
                );

                await bot.sendMessage(
                    chatId,

                    "🛑 أرسل اسم البث لإيقافه:"
                );

                return;
            }

            // ==================================================
            // STATUS
            // ==================================================

            if (
                text === "📊 الحالة"
            ) {

                await showStatus(
                    chatId
                );

                return;
            }

            // ==================================================
            // CHECK
            // ==================================================

            if (
                text === "🔍 فحص الرابط"
            ) {

                sessions.set(
                    userId,

                    {
                        type: "check",
                        step: "url"
                    }
                );

                await bot.sendMessage(
                    chatId,

                    "🌐 أرسل رابط المصدر:"
                );

                return;
            }

            // ==================================================
            // SESSION
            // ==================================================

            const session =
                sessions.get(
                    userId
                );

            if (!session) {

                await bot.sendMessage(
                    chatId,

                    "استخدم /start",

                    keyboard()
                );

                return;
            }

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

                    await bot.sendMessage(
                        chatId,

                        "2️⃣ أرسل Facebook Stream Key:"
                    );

                    return;
                }

                if (
                    session.step ===
                    "key"
                ) {

                    session.key =
                        text;

                    session.step =
                        "url";

                    await bot.sendMessage(
                        chatId,

                        "3️⃣ أرسل رابط المصدر:"
                    );

                    return;
                }

                if (
                    session.step ===
                    "url"
                ) {

                    const name =
                        session.name;

                    const key =
                        session.key;

                    sessions.delete(
                        userId
                    );

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

                        await bot.sendMessage(
                            chatId,

                            "❌ أدخل رقمًا بين 1 و50."
                        );

                        return;
                    }

                    session.count =
                        count;

                    session.current =
                        1;

                    session.step =
                        "name";

                    await bot.sendMessage(
                        chatId,

                        `📡 البث 1 من ${count}\n\n` +
                        "أرسل اسم البث:"
                    );

                    return;
                }

                if (
                    session.step ===
                    "name"
                ) {

                    session.name =
                        text;

                    session.step =
                        "key";

                    await bot.sendMessage(
                        chatId,

                        `🔑 البث ${session.current} من ${session.count}\n\n` +
                        "أرسل Stream Key:"
                    );

                    return;
                }

                if (
                    session.step ===
                    "key"
                ) {

                    session.key =
                        text;

                    session.step =
                        "url";

                    await bot.sendMessage(
                        chatId,

                        "🌐 أرسل رابط المصدر:"
                    );

                    return;
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

                        sessions.delete(
                            userId
                        );

                        await bot.sendMessage(
                            chatId,

                            `✅ تم تشغيل/إعداد ${session.count} بث.`,

                            keyboard()
                        );

                        return;
                    }

                    session.current++;

                    session.step =
                        "name";

                    await bot.sendMessage(
                        chatId,

                        `📡 البث ${session.current} من ${session.count}\n\n` +
                        "أرسل اسم البث:"
                    );

                    return;
                }
            }

            // ==================================================
            // STOP SESSION
            // ==================================================

            if (
                session.type ===
                "stop"
            ) {

                sessions.delete(
                    userId
                );

                await stopStream(
                    chatId,
                    text
                );

                return;
            }

            // ==================================================
            // CHECK SESSION
            // ==================================================

            if (
                session.type ===
                "check"
            ) {

                sessions.delete(
                    userId
                );

                await checkSource(
                    chatId,
                    text
                );

                return;
            }

        } catch (error) {

            console.error(
                "❌ BOT ERROR:",
                error
            );

            try {

                await bot.sendMessage(
                    message.chat.id,

                    "❌ حدث خطأ:\n\n" +
                    error.message,

                    keyboard()
                );

            } catch {}

        }

    }
);

// ============================================================
// TELEGRAM POLLING ERROR
// ============================================================

bot.on(
    "polling_error",
    error => {

        console.error(
            "❌ Telegram polling error:",
            error?.message ||
            error
        );

    }
);

// ============================================================
// SHUTDOWN
// ============================================================

async function shutdown() {

    console.log(
        "🛑 إيقاف البوت..."
    );

    try {

        await bot.stopPolling();

    } catch {}

    for (
        const stream of streams.values()
    ) {

        stream.stopping =
            true;

        try {

            stream.process.kill(
                "SIGTERM"
            );

        } catch {}

    }

    streams.clear();

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
// START IMAGE DOWNLOAD
// ============================================================

prepareImage()
    .then(
        ok => {

            if (ok) {

                console.log(
                    "🖼️ صورة البث جاهزة ✅"
                );

            } else {

                console.log(
                    "⚠️ صورة البث غير جاهزة"
                );

            }

        }
    );
