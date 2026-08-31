// ======================================================
// DARK TELEGRAM STREAM BOT
// SOLO + GROUP + STOP + STATUS + FFprobe + MP4 LOOP
// + IMAGE OVERLAY
// ======================================================

import TelegramBot from "node-telegram-bot-api";
import { spawn, execFile } from "child_process";
import fs from "fs";
import https from "https";
import http from "http";
import path from "path";

// ======================================================
// ضع توكن Telegram هنا
// ======================================================

const TOKEN = "8938418856:AAHmkAy9CWRzuHmZc4b5bUmqSSZUGSbwUN4";

// ======================================================
// Facebook RTMPS
// ======================================================

const FACEBOOK_RTMP =
    "rtmps://live-api-s.facebook.com:443/rtmp/";

// ======================================================
// رابط الصورة
// ======================================================

const IMAGE_URL =
    "https://i.postimg.cc/5NdcJMdk/file-00000000f784820a9ed0a4bd18755f4f.png";

// ======================================================
// إعدادات الصورة
// ======================================================

// عرض الصورة
const IMAGE_WIDTH = 180;

// المسافة من اليمين
const IMAGE_RIGHT = 70;

// المسافة من الأعلى
const IMAGE_TOP = 40;

// ======================================================
// ملف الصورة المحلي
// ======================================================

const IMAGE_FILE =
    path.join(
        process.cwd(),
        "stream-logo.png"
    );

// ======================================================
// التحقق من التوكن
// ======================================================

if (
    !TOKEN ||
    TOKEN === "PUT_YOUR_NEW_TELEGRAM_BOT_TOKEN_HERE"
) {
    console.error(
        "❌ ضع توكن Telegram الجديد داخل TOKEN"
    );

    process.exit(1);
}

// ======================================================
// تحميل الصورة من الرابط
// ======================================================

function downloadImage(url, outputFile) {

    return new Promise((resolve, reject) => {

        const client =
            url.startsWith("https://")
                ? https
                : http;

        const request =
            client.get(
                url,
                response => {

                    // إعادة التوجيه
                    if (
                        response.statusCode >= 300 &&
                        response.statusCode < 400 &&
                        response.headers.location
                    ) {

                        response.resume();

                        downloadImage(
                            response.headers.location,
                            outputFile
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
                            outputFile
                        );

                    response.pipe(file);

                    file.on(
                        "finish",
                        () => {

                            file.close(
                                () => resolve(
                                    outputFile
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
                        "انتهت مهلة تحميل الصورة."
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

// ======================================================
// التأكد من وجود الصورة
// ======================================================

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
            !fs.existsSync(IMAGE_FILE)
        ) {

            throw new Error(
                "لم يتم إنشاء ملف الصورة."
            );
        }

        const stat =
            fs.statSync(
                IMAGE_FILE
            );

        if (stat.size < 100) {

            throw new Error(
                "ملف الصورة فارغ أو غير صالح."
            );
        }

        console.log(
            `✅ تم تحميل الصورة: ${IMAGE_FILE}`
        );

        console.log(
            `📦 حجم الصورة: ${stat.size} bytes`
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

// ======================================================
// تشغيل Telegram
// ======================================================

const bot = new TelegramBot(
    TOKEN,
    {
        polling: true
    }
);

console.log(
    "🤖 DARK STREAM BOT Started"
);

// ======================================================
// البيانات
// ======================================================

const streams = {};
const sessions = {};

// ======================================================
// إخفاء مفتاح Facebook
// ======================================================

function maskKey(key) {

    if (!key) {
        return "غير معروف";
    }

    key =
        String(key).trim();

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
// القائمة الرئيسية
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
// FFprobe
// ======================================================

function probeUrl(url) {

    return new Promise(resolve => {

        url =
            String(url || "").trim();

        if (!url) {

            resolve({
                ok: false,
                error: "الرابط فارغ."
            });

            return;
        }

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

                "-timeout",
                "10000000",

                url

            ],

            {
                timeout: 30000,
                maxBuffer: 1024 * 1024
            },

            (error, stdout, stderr) => {

                if (error) {

                    resolve({

                        ok: false,

                        error:
                            String(
                                stderr || ""
                            ).trim() ||

                            error.message ||

                            "تعذر فحص الرابط."
                    });

                    return;
                }

                try {

                    const data =
                        JSON.parse(
                            stdout || "{}"
                        );

                    const foundStreams =
                        Array.isArray(
                            data.streams
                        )
                            ? data.streams
                            : [];

                    const video =
                        foundStreams.find(
                            x =>
                                x &&
                                x.codec_type ===
                                "video"
                        );

                    const audio =
                        foundStreams.find(
                            x =>
                                x &&
                                x.codec_type ===
                                "audio"
                        );

                    const format =
                        data?.format
                            ?.format_name ||
                        "unknown";

                    const duration =
                        data?.format
                            ?.duration ||
                        null;

                    resolve({

                        ok: true,

                        format,

                        duration,

                        video:
                            video?.codec_name ||
                            "غير معروف",

                        audio:
                            audio?.codec_name ||
                            "غير موجود"
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
// فحص الرابط من البوت
// ======================================================

async function checkUrl(
    chatId,
    url
) {

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

            "❌ فشل فحص الرابط.\n\n" +
            "تأكد أن الرابط يمكن الوصول إليه وأن FFmpeg/FFprobe يستطيع قراءته.",

            mainKeyboard()
        );

        return;
    }

    let message =

        "✅ الرابط قابل للقراءة\n\n" +

        "🌐 الرابط:\n" +
        url +

        "\n\n📡 الصيغة: " +
        result.format +

        "\n🎥 الفيديو: " +
        result.video +

        "\n🔊 الصوت: " +
        result.audio;

    if (result.duration) {

        const durationNumber =
            Number(result.duration);

        if (
            Number.isFinite(
                durationNumber
            )
        ) {

            message +=
                "\n⏱ المدة: " +
                durationNumber.toFixed(1) +
                " ثانية";

        } else {

            message +=
                "\n⏱ المدة: مباشر / غير محددة";
        }

    } else {

        message +=
            "\n⏱ المدة: مباشر / غير محددة";
    }

    await bot.sendMessage(
        chatId,
        message,
        mainKeyboard()
    );
}

// ======================================================
// معرفة MP4
// ======================================================

function isMp4Url(sourceUrl) {

    try {

        const withoutHash =
            String(sourceUrl)
                .split("#")[0];

        const withoutQuery =
            withoutHash
                .split("?")[0];

        return /\.mp4$/i.test(
            withoutQuery
        );

    } catch {

        return false;
    }
}

// ======================================================
// بناء FFmpeg
//
// المصدر = input 0
// الصورة = input 1
//
// الصورة تظهر طوال البث
// ======================================================

function buildFFmpegArgs(
    sourceUrl,
    target
) {

    const isMp4 =
        isMp4Url(sourceUrl);

    let args = [];

    // ==================================================
    // MP4 LOOP
    // ==================================================

    if (isMp4) {

        args.push(
            "-stream_loop",
            "-1"
        );
    }

    // ==================================================
    // المصدر
    // ==================================================

    args.push(

        "-re",

        "-nostdin",

        "-reconnect",
        "1",

        "-reconnect_at_eof",
        "1",

        "-reconnect_streamed",
        "1",

        "-reconnect_delay_max",
        "10",

        "-i",
        sourceUrl
    );

    // ==================================================
    // الصورة المحلية
    //
    // loop 1 = الصورة مستمرة
    // ==================================================

    args.push(

        "-loop",
        "1",

        "-i",
        IMAGE_FILE
    );

    // ==================================================
    // Overlay
    //
    // الصورة أعلى اليمين
    // ==================================================

    args.push(

        "-filter_complex",

        `[1:v]scale=${IMAGE_WIDTH}:-1[logo];` +
        `[0:v][logo]overlay=` +
        `W-w-${IMAGE_RIGHT}:` +
        `${IMAGE_TOP}:format=auto[vout]`
    );

    // ==================================================
    // Video + Audio
    // ==================================================

    args.push(

        "-map",
        "[vout]",

        "-map",
        "0:a:0?",

        // H264
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

        // AAC
        "-c:a",
        "aac",

        "-b:a",
        "128k",

        "-ar",
        "44100",

        // Facebook
        "-f",
        "flv",

        target
    );

    return {
        args,
        isMp4
    };
}

// ======================================================
// تشغيل بث
// ======================================================

async function startStream(
    chatId,
    name,
    facebookKey,
    sourceUrl,
    streamType
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

            "❌ البيانات ناقصة.",

            mainKeyboard()
        );

        return false;
    }

    // ==================================================
    // منع تكرار الاسم
    // ==================================================

    if (streams[name]) {

        await bot.sendMessage(
            chatId,

            `⚠️ البث "${name}" يعمل بالفعل.`,

            mainKeyboard()
        );

        return false;
    }

    // ==================================================
    // التأكد من الصورة
    // ==================================================

    if (
        !fs.existsSync(IMAGE_FILE)
    ) {

        const imageReady =
            await prepareImage();

        if (!imageReady) {

            await bot.sendMessage(
                chatId,

                "❌ تعذر تحميل صورة البث.\n\n" +
                "تأكد من أن IMAGE_URL رابط مباشر للصورة.",

                mainKeyboard()
            );

            return false;
        }
    }

    // ==================================================
    // فحص المصدر
    // ==================================================

    await bot.sendMessage(
        chatId,

        `🔎 جاري فحص الرابط...\n\n` +
        `📛 ${name}`
    );

    const probe =
        await probeUrl(sourceUrl);

    if (!probe.ok) {

        await bot.sendMessage(
            chatId,

            `❌ فشل فحص الرابط.\n\n` +
            `📛 ${name}\n\n` +
            `${probe.error || "الرابط غير صالح."}`,

            mainKeyboard()
        );

        return false;
    }

    // ==================================================
    // Facebook
    // ==================================================

    const target =
        FACEBOOK_RTMP +
        facebookKey;

    // ==================================================
    // FFmpeg
    // ==================================================

    const ff =
        buildFFmpegArgs(
            sourceUrl,
            target
        );

    const args =
        ff.args;

    const isMp4 =
        ff.isMp4;

    console.log(
        `▶️ Starting stream: ${name}`
    );

    console.log(
        `📡 Source: ${sourceUrl}`
    );

    console.log(
        `🖼️ Image: ${IMAGE_FILE}`
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

            `❌ تعذر تشغيل FFmpeg:\n\n` +
            error.message,

            mainKeyboard()
        );

        return false;
    }

    // ==================================================
    // تخزين البث
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

        isMp4,

        probe,

        imageUrl:
            IMAGE_URL
    };

    // ==================================================
    // سجل FFmpeg
    // ==================================================

    const safeName =
        name.replace(
            /[^a-zA-Z0-9_-]/g,
            "_"
        );

    const logFile =
        `stream-${safeName}.log`;

    let logStream;

    try {

        logStream =
            fs.createWriteStream(
                logFile,
                {
                    flags: "a"
                }
            );

        process.stderr.pipe(
            logStream
        );

    } catch (error) {

        console.error(
            "Log error:",
            error.message
        );
    }

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

            try {

                await bot.sendMessage(
                    chatId,

                    `✅ تم تشغيل البث\n\n` +

                    `📛 الاسم:\n${name}\n\n` +

                    `🔑 المفتاح:\n${maskKey(facebookKey)}\n\n` +

                    `🔗 المصدر:\n${sourceUrl}\n\n` +

                    `📡 النوع:\n${streamType}\n\n` +

                    `🎥 الفيديو:\n${probe.video}\n\n` +

                    `🔊 الصوت:\n${probe.audio}\n\n` +

                    `🖼️ الصورة:\nمفعّلة ✅\n\n` +

                    `📍 المكان:\nأعلى اليمين\n\n` +

                    `🔄 MP4 Loop:\n` +
                    `${isMp4 ? "مفعّل ✅" : "غير مطلوب"}\n\n` +

                    `🟢 الحالة:\nيعمل`,

                    mainKeyboard()
                );

            } catch {}
        }
    );

    // ==================================================
    // خطأ FFmpeg
    // ==================================================

    process.on(
        "error",
        async error => {

            console.error(
                `FFmpeg error ${name}:`,
                error
            );

            const stream =
                streams[name];

            if (
                stream &&
                !stream.manualStop
            ) {

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
        }
    );

    // ==================================================
    // توقف FFmpeg
    // ==================================================

    process.on(
        "close",
        async code => {

            console.log(
                `FFmpeg stopped: ${name}, code=${code}`
            );

            if (logStream) {

                try {
                    logStream.end();
                } catch {}
            }

            const stream =
                streams[name];

            if (!stream) {
                return;
            }

            const manualStop =
                Boolean(
                    stream.manualStop
                );

            delete streams[name];

            if (manualStop) {
                return;
            }

            try {

                await bot.sendMessage(
                    chatId,

                    `🛑 توقف البث "${name}"\n\n` +
                    `كود FFmpeg: ${code ?? "غير معروف"}\n\n` +
                    `🔗 المصدر:\n${sourceUrl}`,

                    mainKeyboard()
                );

            } catch {}
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

    stream.manualStop =
        true;

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

async function stopAll(
    chatId
) {

    const names =
        Object.keys(streams);

    if (
        names.length === 0
    ) {

        await bot.sendMessage(
            chatId,

            "ℹ️ لا توجد بثوث تعمل حالياً.",

            mainKeyboard()
        );

        return;
    }

    for (
        const name of names
    ) {

        try {

            streams[name].manualStop =
                true;

            streams[name].process.kill(
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

async function showStatus(
    chatId
) {

    const names =
        Object.keys(streams);

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

            `🟢 ${stream.status}\n` +

            `⏱ ${time}\n` +

            `📡 ${stream.type}\n` +

            `🖼️ الصورة: نعم\n` +

            `🔄 MP4 Loop: ` +
            `${stream.isMp4 ? "نعم" : "لا"}\n\n`;
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
            (
                Date.now() -
                stream.startedAt
            ) / 1000
        );

    await bot.sendMessage(
        chatId,

        `📊 حالة البث\n\n` +

        `📛 الاسم: ${name}\n` +

        `🔑 المفتاح: ${maskKey(stream.key)}\n` +

        `🟢 الحالة: ${stream.status}\n` +

        `⏱ المدة: ${seconds} ثانية\n` +

        `📡 النوع: ${stream.type}\n` +

        `🎥 الفيديو: ${stream.probe?.video || "غير معروف"}\n` +

        `🔊 الصوت: ${stream.probe?.audio || "غير معروف"}\n` +

        `🖼️ الصورة: مفعّلة ✅\n` +

        `📍 المكان: أعلى اليمين\n` +

        `🔄 MP4 Loop: ${stream.isMp4 ? "نعم" : "لا"}\n\n` +

        `🔗 المصدر:\n${stream.url}`,

        mainKeyboard()
    );
}

// ======================================================
// القائمة الرئيسية
// ======================================================

function sendMenu(
    chatId
) {

    return bot.sendMessage(
        chatId,

        "🤖 DARK STREAM BOT\n\n" +
        "اختر من الأزرار الموجودة أسفل الشاشة:",

        mainKeyboard()
    );
}

// ======================================================
// استقبال الرسائل
// ======================================================

bot.on(
    "message",
    async msg => {

        try {

            if (!msg.text) {
                return;
            }

            const chatId =
                msg.chat.id;

            const userId =
                msg.from?.id;

            if (!userId) {
                return;
            }

            const text =
                msg.text.trim();

            // ==========================================
            // START
            // ==========================================

            if (
                text === "/start"
            ) {

                delete sessions[userId];

                return sendMenu(
                    chatId
                );
            }

            // ==========================================
            // SOLO
            // ==========================================

            if (
                text === "🎯 SOLO" ||
                text === "/solo"
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

            // ==========================================
            // GROUP
            // ==========================================

            if (
                text === "🔥 GROUP" ||
                text === "/group"
            ) {

                sessions[userId] = {

                    type:
                        "group",

                    step:
                        "count",

                    streams:
                        []
                };

                return bot.sendMessage(
                    chatId,

                    "👥 كم عدد البثوث التي تريد تشغيلها؟\n\n" +
                    "مثال: 3"
                );
            }

            // ==========================================
            // STOP
            // ==========================================

            if (
                text === "🛑 STOP" ||
                text === "/stop"
            ) {

                sessions[userId] = {

                    type:
                        "stop",

                    step:
                        "name"
                };

                return bot.sendMessage(
                    chatId,

                    "🛑 أرسل اسم البث الذي تريد إيقافه:",

                    stopKeyboard()
                );
            }

            // ==========================================
            // STOP ALL
            // ==========================================

            if (
                text ===
                "⛔ إيقاف جميع البثوث" ||
                text === "/stopall"
            ) {

                return stopAll(
                    chatId
                );
            }

            // ==========================================
            // STATUS
            // ==========================================

            if (
                text === "📊 الحالة" ||
                text === "/status"
            ) {

                return showStatus(
                    chatId
                );
            }

            // ==========================================
            // CHECK
            // ==========================================

            if (
                text === "🔍 فحص الرابط" ||
                text === "/check"
            ) {

                sessions[userId] = {

                    type:
                        "check",

                    step:
                        "url"
                };

                return bot.sendMessage(
                    chatId,

                    "🌐 أرسل رابط المصدر لفحصه:"
                );
            }

            // ==========================================
            // STREAM STATUS
            // ==========================================

            if (
                text ===
                "📊 حالة بث معين" ||
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

            // ==========================================
            // STOP MENU
            // ==========================================

            if (
                text ===
                "🛑 إيقاف بث معين"
            ) {

                sessions[userId] = {

                    type:
                        "stop",

                    step:
                        "name"
                };

                return bot.sendMessage(
                    chatId,

                    "🛑 أرسل اسم البث:"
                );
            }

            // ==========================================
            // BACK
            // ==========================================

            if (
                text === "↩️ رجوع"
            ) {

                delete sessions[userId];

                return sendMenu(
                    chatId
                );
            }

            // ==========================================
            // لا توجد جلسة
            // ==========================================

            if (
                !sessions[userId]
            ) {

                return bot.sendMessage(
                    chatId,

                    "❓ استخدم /start لعرض الأزرار.",

                    mainKeyboard()
                );
            }

            const session =
                sessions[userId];

            // ==========================================
            // SOLO
            // ==========================================

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

                        "3️⃣ أرسل رابط المصدر:"
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

            // ==========================================
            // GROUP
            // ==========================================

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
                        count > 50
                    ) {

                        return bot.sendMessage(
                            chatId,

                            "❌ أرسل رقماً من 1 إلى 50."
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

                        `👥 تم تحديد ${count} بث.\n\n` +
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
                        `أرسل رابط المصدر:`
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

                            `✅ انتهى إعداد GROUP.\n\n` +
                            `📊 العدد المطلوب: ${session.count}\n\n` +
                            `🖼️ الصورة: مفعّلة على جميع البثوث.`,

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

            // ==========================================
            // STOP
            // ==========================================

            if (
                session.type === "stop"
            ) {

                if (
                    session.step === "name"
                ) {

                    delete sessions[userId];

                    return stopStream(
                        chatId,
                        text
                    );
                }
            }

            // ==========================================
            // CHECK
            // ==========================================

            if (
                session.type === "check"
            ) {

                if (
                    session.step === "url"
                ) {

                    delete sessions[userId];

                    return checkUrl(
                        chatId,
                        text
                    );
                }
            }

            // ==========================================
            // STREAM STATUS
            // ==========================================

            if (
                session.type ===
                "streamstatus"
            ) {

                if (
                    session.step === "name"
                ) {

                    delete sessions[userId];

                    return showStreamStatus(
                        chatId,
                        text
                    );
                }
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
    error => {

        console.error(
            "Telegram polling error:",
            error?.message || error
        );
    }
);

// ======================================================
// إيقاف آمن
// ======================================================

function shutdown() {

    console.log(
        "🛑 إيقاف البوت..."
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

process.on(
    "SIGTERM",
    shutdown
);

process.on(
    "SIGINT",
    shutdown
);

// ======================================================
// تجهيز الصورة عند تشغيل البوت
// ======================================================

prepareImage()
    .then(ok => {

        if (ok) {

            console.log(
                "🖼️ صورة البث جاهزة."
            );

        } else {

            console.warn(
                "⚠️ صورة البث غير جاهزة."
            );
        }
    });
