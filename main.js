// ======================================================
// DARK TELEGRAM STREAM BOT
// SOLO + GROUP + STOP + STATUS + FFprobe + MP4 LOOP
// LOW CPU / LOW RAM VERSION
// LARGE IMAGE
// JavaScript ES MODULE
// ======================================================

import TelegramBot from "node-telegram-bot-api";
import { spawn, execFile } from "child_process";
import fs from "fs";

// ======================================================
// Telegram Bot Token
// ======================================================

const TOKEN = "8774499504:AAGn4dXL4d4wDdYxz8C8NvzkCvg_pYTFKAM";

// ======================================================
// Facebook RTMPS
// ======================================================

const FACEBOOK_RTMP =
    "rtmps://live-api-s.facebook.com:443/rtmp/";

// ======================================================
// 🖼️ الصورة
// ======================================================

const IMAGE_URL =
    "https://imgbs.com/uploads/bot-03891859.png";

// الصورة أكبر
const IMAGE_WIDTH = 400;

// الموضع
const IMAGE_RIGHT = 25;
const IMAGE_TOP = 25;

// ======================================================
// ⚙️ إعدادات FFmpeg لتقليل الموارد
// ======================================================

// عدد خيوط CPU لكل بث
const FFMPEG_THREADS = "1";

// FPS
const VIDEO_FPS = "25";

// Bitrate
const VIDEO_BITRATE = "2000k";
const VIDEO_MAXRATE = "2200k";
const VIDEO_BUFSIZE = "4400k";

// ======================================================
// التحقق من التوكن
// ======================================================

if (
    !TOKEN ||
    TOKEN === "PUT_YOUR_NEW_BOT_TOKEN_HERE"
) {
    console.error(
        "❌ ضع توكن Telegram داخل TOKEN"
    );

    process.exit(1);
}

// ======================================================
// Telegram
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
// إخفاء Facebook Key
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
// Keyboard
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
// STOP Keyboard
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
// فحص وجود FFmpeg
// ======================================================

function checkFFmpeg() {

    return new Promise(
        resolve => {

            execFile(
                "ffmpeg",
                [
                    "-version"
                ],
                {
                    timeout: 10000
                },
                (
                    error,
                    stdout,
                    stderr
                ) => {

                    if (error) {

                        resolve({

                            ok: false,

                            error:
                                String(
                                    stderr || ""
                                ).trim() ||
                                error.message

                        });

                        return;
                    }

                    resolve({

                        ok: true,

                        version:
                            String(
                                stdout || ""
                            )
                            .split("\n")[0]

                    });

                }
            );

        }
    );
}

// ======================================================
// FFprobe
// ======================================================

function probeUrl(url) {

    return new Promise(
        resolve => {

            url =
                String(
                    url || ""
                ).trim();

            if (!url) {

                resolve({

                    ok: false,

                    error:
                        "الرابط فارغ."

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

                    timeout:
                        30000,

                    maxBuffer:
                        1024 * 1024

                },

                (
                    error,
                    stdout,
                    stderr
                ) => {

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

                    } catch (error) {

                        resolve({

                            ok: false,

                            error:
                                "تعذر قراءة نتيجة FFprobe: " +
                                error.message

                        });

                    }

                }

            );

        }
    );
}

// ======================================================
// فحص الرابط من Telegram
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

            "🔴 الخطأ الحقيقي:\n" +

            result.error,

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

                durationNumber.toFixed(
                    1
                ) +

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
// هل MP4 ؟
// ======================================================

function isMp4Url(
    sourceUrl
) {

    try {

        const withoutHash =
            String(
                sourceUrl
            )
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
// ======================================================

function buildFFmpegArgs(
    sourceUrl,
    target
) {

    const isMp4 =
        isMp4Url(
            sourceUrl
        );

    const args = [];

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
    // الصورة
    // ==================================================

    args.push(

        "-loop",
        "1",

        "-i",
        IMAGE_URL

    );

    // ==================================================
    // الصورة كبيرة
    // ==================================================

    args.push(

        "-filter_complex",

        `[1:v]scale=${IMAGE_WIDTH}:-1[logo];` +

        `[0:v][logo]overlay=` +

        `W-w-${IMAGE_RIGHT}:` +

        `${IMAGE_TOP}:` +

        `format=auto[v]`

    );

    // ==================================================
    // الفيديو
    // ==================================================

    args.push(

        "-map",
        "[v]",

        "-map",
        "0:a:0?",

        // H264
        "-c:v",
        "libx264",

        // أقل استهلاك CPU
        "-preset",
        "ultrafast",

        "-tune",
        "zerolatency",

        "-pix_fmt",
        "yuv420p",

        // FPS
        "-r",
        VIDEO_FPS,

        // GOP
        "-g",
        "50",

        "-keyint_min",
        "50",

        // bitrate
        "-b:v",
        VIDEO_BITRATE,

        "-maxrate",
        VIDEO_MAXRATE,

        "-bufsize",
        VIDEO_BUFSIZE,

        // Threads
        "-threads",
        FFMPEG_THREADS,

        // Audio
        "-c:a",
        "aac",

        "-b:a",
        "96k",

        "-ar",
        "44100",

        // Output
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
// إرسال خطأ FFmpeg
// ======================================================

async function sendFFmpegError(
    chatId,
    name,
    code,
    signal,
    ffmpegOutput
) {

    let errorText =
        String(
            ffmpegOutput || ""
        ).trim();

    if (!errorText) {

        errorText =
            "FFmpeg لم يعطِ رسالة خطأ.";

    }

    // آخر 6000 حرف
    errorText =
        errorText.slice(-6000);

    const message =

        "❌ FFmpeg توقف\n\n" +

        `📛 البث:\n${name}\n\n` +

        `🔴 Exit code:\n` +
        `${code ?? "غير معروف"}\n\n` +

        `⚠️ Signal:\n` +
        `${signal ?? "لا يوجد"}\n\n` +

        "📄 الخطأ الحقيقي:\n\n" +

        errorText;

    try {

        await bot.sendMessage(
            chatId,
            message,
            mainKeyboard()
        );

    } catch (error) {

        console.error(
            "Telegram error:",
            error.message
        );

    }
}

// ======================================================
// تشغيل بث واحد
// ======================================================

async function startStream(

    chatId,

    name,

    facebookKey,

    sourceUrl,

    streamType,

    existingProbe = null

) {

    name =
        String(
            name || ""
        ).trim();

    facebookKey =
        String(
            facebookKey || ""
        ).trim();

    sourceUrl =
        String(
            sourceUrl || ""
        ).trim();

    // ==================================================
    // التحقق
    // ==================================================

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
    // الاسم مستخدم؟
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
    // FFprobe
    // ==================================================

    let probe =
        existingProbe;

    if (!probe) {

        await bot.sendMessage(

            chatId,

            `🔎 جاري فحص الرابط...\n\n` +
            `📛 ${name}`

        );

        probe =
            await probeUrl(
                sourceUrl
            );

        if (!probe.ok) {

            await bot.sendMessage(

                chatId,

                `❌ فشل فحص الرابط.\n\n` +

                `📛 ${name}\n\n` +

                `🔴 الخطأ:\n` +

                `${probe.error}`,

                mainKeyboard()

            );

            return false;
        }
    }

    // ==================================================
    // Facebook
    // ==================================================

    const target =
        FACEBOOK_RTMP +
        facebookKey;

    // ==================================================
    // FFmpeg arguments
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

    // ==================================================
    // تسجيل الأمر بدون كشف المفتاح
    // ==================================================

    const safeTarget =
        FACEBOOK_RTMP +
        "****";

    console.log(
        "\n================================="
    );

    console.log(
        `▶️ Starting stream: ${name}`
    );

    console.log(
        `🌐 Source: ${sourceUrl}`
    );

    console.log(
        `📡 Target: ${safeTarget}`
    );

    console.log(
        `🖼️ Image width: ${IMAGE_WIDTH}px`
    );

    console.log(
        `⚙️ Threads: ${FFMPEG_THREADS}`
    );

    console.log(
        `🎞️ FPS: ${VIDEO_FPS}`
    );

    console.log(
        `📊 Bitrate: ${VIDEO_BITRATE}`
    );

    console.log(
        "=================================\n"
    );

    // ==================================================
    // تشغيل FFmpeg
    // ==================================================

    let ffmpegProcess;

    try {

        ffmpegProcess =
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

        console.error(
            "❌ FFmpeg spawn exception:",
            error
        );

        await bot.sendMessage(

            chatId,

            `❌ تعذر تشغيل FFmpeg\n\n` +

            `📛 ${name}\n\n` +

            `🔴 الخطأ الحقيقي:\n` +

            `${error.message}`,

            mainKeyboard()

        );

        return false;
    }

    // ==================================================
    // البيانات
    // ==================================================

    streams[name] = {

        name,

        key:
            facebookKey,

        url:
            sourceUrl,

        type:
            streamType,

        process:
            ffmpegProcess,

        startedAt:
            Date.now(),

        status:
            "starting",

        manualStop:
            false,

        isMp4,

        probe,

        ffmpegError:
            ""

    };

    // ==================================================
    // FFmpeg STDERR
    // ==================================================

    let ffmpegOutput = "";

    if (
        ffmpegProcess.stderr
    ) {

        ffmpegProcess.stderr.on(

            "data",

            chunk => {

                const output =
                    String(
                        chunk
                    );

                ffmpegOutput +=
                    output;

                // الاحتفاظ بآخر 20000 حرف
                if (
                    ffmpegOutput.length >
                    20000
                ) {

                    ffmpegOutput =
                        ffmpegOutput.slice(
                            -20000
                        );

                }

                console.error(

                    `[FFMPEG ${name}] ` +
                    output.trim()

                );

                if (
                    streams[name]
                ) {

                    streams[name]
                        .ffmpegError =
                        ffmpegOutput;

                }

            }

        );

    }

    // ==================================================
    // ملف Log
    // ==================================================

    const safeName =
        name.replace(
            /[^a-zA-Z0-9_-]/g,
            "_"
        );

    const logFile =
        `stream-${safeName}.log`;

    let logStream = null;

    try {

        logStream =
            fs.createWriteStream(

                logFile,

                {
                    flags: "a"
                }

            );

        if (
            ffmpegProcess.stderr
        ) {

            ffmpegProcess.stderr.pipe(
                logStream
            );

        }

    } catch (error) {

        console.error(
            "Log error:",
            error.message
        );

    }

    // ==================================================
    // FFmpeg Spawn
    // ==================================================

    ffmpegProcess.on(

        "spawn",

        async () => {

            console.log(

                `🟢 FFmpeg process started: ${name}`

            );

            if (
                streams[name]
            ) {

                streams[name].status =
                    "running";

            }

            try {

                await bot.sendMessage(

                    chatId,

                    `✅ تم تشغيل FFmpeg\n\n` +

                    `📛 الاسم:\n${name}\n\n` +

                    `🔑 المفتاح:\n` +
                    `${maskKey(facebookKey)}\n\n` +

                    `🔗 المصدر:\n` +
                    `${sourceUrl}\n\n` +

                    `📡 النوع:\n` +
                    `${streamType}\n\n` +

                    `🎥 الفيديو:\n` +
                    `${probe.video}\n\n` +

                    `🔊 الصوت:\n` +
                    `${probe.audio}\n\n` +

                    `🔄 MP4 Loop:\n` +
                    `${isMp4 ? "مفعّل ✅" : "غير مطلوب"}\n\n` +

                    `🖼️ الصورة:\nمفعّلة ✅\n\n` +

                    `📐 حجم الصورة:\n` +
                    `${IMAGE_WIDTH}px عرض\n\n` +

                    `⚙️ CPU:\n` +
                    `${FFMPEG_THREADS} Thread\n\n` +

                    `🎞️ FPS:\n` +
                    `${VIDEO_FPS}\n\n` +

                    `📊 Bitrate:\n` +
                    `${VIDEO_BITRATE}\n\n` +

                    `🟢 الحالة:\nيعمل`,

                    mainKeyboard()

                );

            } catch (error) {

                console.error(
                    "Telegram send error:",
                    error.message
                );

            }

        }

    );

    // ==================================================
    // FFmpeg ERROR
    // ==================================================

    ffmpegProcess.on(

        "error",

        async error => {

            console.error(
                `❌ FFmpeg ERROR ${name}:`,
                error
            );

            if (
                streams[name]
            ) {

                streams[name].status =
                    "error";

            }

            const errorText =
                ffmpegOutput.trim();

            try {

                await bot.sendMessage(

                    chatId,

                    `❌ خطأ في FFmpeg\n\n` +

                    `📛 البث:\n${name}\n\n` +

                    `🔴 الخطأ:\n` +

                    `${error.message}\n\n` +

                    `📄 FFmpeg:\n` +

                    `${errorText.slice(-5000)}`,

                    mainKeyboard()

                );

            } catch {}

        }

    );

    // ==================================================
    // FFmpeg CLOSE
    // ==================================================

    ffmpegProcess.on(

        "close",

        async (
            code,
            signal
        ) => {

            console.log(

                `🛑 FFmpeg stopped: ${name}`

            );

            console.log(
                `Exit code: ${code}`
            );

            console.log(
                `Signal: ${signal}`
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

            // ==================================================
            // إيقاف يدوي
            // ==================================================

            if (manualStop) {

                console.log(
                    `🛑 Manual stop: ${name}`
                );

                return;
            }

            // ==================================================
            // خطأ حقيقي
            // ==================================================

            const realError =
                ffmpegOutput
                    .trim()
                    .slice(-7000);

            console.error(
                "================================="
            );

            console.error(
                `❌ FFmpeg failed: ${name}`
            );

            console.error(
                `Exit code: ${code}`
            );

            console.error(
                realError ||
                "No FFmpeg error output"
            );

            console.error(
                "================================="
            );

            await sendFFmpegError(

                chatId,

                name,

                code,

                signal,

                realError

            );

        }

    );

    return true;
}

// ======================================================
// GROUP
// ======================================================

async function startGroupStreams(

    chatId,
    groupStreams

) {

    if (
        !Array.isArray(
            groupStreams
        ) ||
        groupStreams.length === 0
    ) {

        await bot.sendMessage(

            chatId,

            "❌ لا توجد بثوث في GROUP.",

            mainKeyboard()

        );

        return;
    }

    // ==================================================
    // فحص
    // ==================================================

    await bot.sendMessage(

        chatId,

        `⏳ تم جمع معلومات GROUP.\n\n` +

        `📊 العدد: ${groupStreams.length}\n\n` +

        `🔎 جاري فحص الروابط...`

    );

    const checkedStreams = [];

    for (
        let i = 0;
        i < groupStreams.length;
        i++
    ) {

        const item =
            groupStreams[i];

        await bot.sendMessage(

            chatId,

            `🔎 فحص البث ${i + 1} من ${groupStreams.length}\n\n` +

            `📛 ${item.name}`

        );

        const probe =
            await probeUrl(
                item.url
            );

        if (!probe.ok) {

            await bot.sendMessage(

                chatId,

                `❌ فشل فحص GROUP.\n\n` +

                `📛 البث: ${item.name}\n\n` +

                `🔴 الخطأ:\n` +

                `${probe.error}\n\n` +

                `🛑 لم يتم تشغيل أي بث.`,

                mainKeyboard()

            );

            return;
        }

        checkedStreams.push({

            ...item,

            probe

        });

    }

    // ==================================================
    // أسماء مكررة
    // ==================================================

    const names =
        checkedStreams.map(
            x => x.name
        );

    const uniqueNames =
        new Set(names);

    if (
        uniqueNames.size !==
        names.length
    ) {

        await bot.sendMessage(

            chatId,

            "❌ يوجد اسم بث مكرر داخل GROUP.\n\n" +

            "يجب أن يكون لكل بث اسم مختلف.\n\n" +

            "🛑 لم يتم تشغيل أي بث.",

            mainKeyboard()

        );

        return;
    }

    // ==================================================
    // أسماء تعمل بالفعل
    // ==================================================

    for (
        const item of checkedStreams
    ) {

        if (
            streams[item.name]
        ) {

            await bot.sendMessage(

                chatId,

                `❌ البث "${item.name}" يعمل بالفعل.\n\n` +

                `🛑 لم يتم تشغيل GROUP.`,

                mainKeyboard()

            );

            return;
        }

    }

    // ==================================================
    // تشغيل
    // ==================================================

    await bot.sendMessage(

        chatId,

        `✅ جميع الروابط صالحة.\n\n` +

        `📊 العدد: ${checkedStreams.length}\n\n` +

        `🚀 سيتم تشغيل GROUP الآن...\n\n` +

        `⚙️ الوضع: Low CPU\n` +

        `🎞️ FPS: ${VIDEO_FPS}\n` +

        `📊 Bitrate: ${VIDEO_BITRATE}\n` +

        `🖼️ الصورة: ${IMAGE_WIDTH}px`

    );

    // ==================================================
    // تشغيل متزامن
    // ==================================================

    const startPromises =
        checkedStreams.map(
            item =>
                startStream(

                    chatId,

                    item.name,

                    item.key,

                    item.url,

                    "GROUP",

                    item.probe

                )
        );

    const results =
        await Promise.all(
            startPromises
        );

    const started =
        results.filter(
            x => x === true
        ).length;

    // ==================================================
    // النتيجة
    // ==================================================

    let resultText =

        `🚀 GROUP انتهى\n\n` +

        `📊 المطلوب: ` +
        `${checkedStreams.length}\n` +

        `🟢 تم التشغيل: ` +
        `${started}\n` +

        `🔴 فشل التشغيل: ` +
        `${checkedStreams.length - started}\n\n`;

    for (
        const item of checkedStreams
    ) {

        if (
            streams[item.name]
        ) {

            resultText +=
                `🟢 ${item.name}\n`;

        } else {

            resultText +=
                `🔴 ${item.name}\n`;

        }

    }

    await bot.sendMessage(

        chatId,

        resultText,

        mainKeyboard()

    );
}

// ======================================================
// STOP STREAM
// ======================================================

async function stopStream(
    chatId,
    name
) {

    name =
        String(
            name || ""
        ).trim();

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

    } catch (error) {

        console.error(
            "Stop error:",
            error.message
        );

    }

    delete streams[name];

    await bot.sendMessage(

        chatId,

        `🛑 تم إيقاف البث "${name}".`,

        mainKeyboard()

    );
}

// ======================================================
// STOP ALL
// ======================================================

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

            "ℹ️ لا توجد بثوث تعمل حالياً.",

            mainKeyboard()

        );

        return;
    }

    for (
        const name of names
    ) {

        try {

            streams[name]
                .manualStop =
                true;

            streams[name]
                .process
                .kill(
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
// STATUS
// ======================================================

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

            `🎞️ FPS: ${VIDEO_FPS}\n` +

            `📊 Bitrate: ${VIDEO_BITRATE}\n` +

            `🖼️ صورة: ${IMAGE_WIDTH}px\n` +

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
// STREAM STATUS
// ======================================================

async function showStreamStatus(
    chatId,
    name
) {

    name =
        String(
            name || ""
        ).trim();

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

        `📛 الاسم: ${name}\n\n` +

        `🔑 المفتاح: ` +
        `${maskKey(stream.key)}\n\n` +

        `🟢 الحالة: ` +
        `${stream.status}\n\n` +

        `⏱ المدة: ` +
        `${seconds} ثانية\n\n` +

        `📡 النوع: ` +
        `${stream.type}\n\n` +

        `🎥 الفيديو: ` +
        `${stream.probe?.video || "غير معروف"}\n\n` +

        `🔊 الصوت: ` +
        `${stream.probe?.audio || "غير معروف"}\n\n` +

        `🔄 MP4 Loop: ` +
        `${stream.isMp4 ? "نعم" : "لا"}\n\n` +

        `🖼️ الصورة: ` +
        `${IMAGE_WIDTH}px\n\n` +

        `⚙️ Threads: ` +
        `${FFMPEG_THREADS}\n\n` +

        `🎞️ FPS: ` +
        `${VIDEO_FPS}\n\n` +

        `📊 Bitrate: ` +
        `${VIDEO_BITRATE}\n\n` +

        `🔗 المصدر:\n` +
        `${stream.url}`,

        mainKeyboard()

    );
}

// ======================================================
// MENU
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
// MESSAGE
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

            // ==================================================
            // GROUP
            // ==================================================

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

            // ==================================================
            // STOP
            // ==================================================

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

            // ==================================================
            // STOP ALL
            // ==================================================

            if (
                text ===
                "⛔ إيقاف جميع البثوث" ||
                text === "/stopall"
            ) {

                return stopAll(
                    chatId
                );
            }

            // ==================================================
            // STATUS
            // ==================================================

            if (
                text === "📊 الحالة" ||
                text === "/status"
            ) {

                return showStatus(
                    chatId
                );
            }

            // ==================================================
            // CHECK
            // ==================================================

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

            // ==================================================
            // STREAM STATUS
            // ==================================================

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

            // ==================================================
            // STOP MENU
            // ==================================================

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

            // ==================================================
            // BACK
            // ==================================================

            if (
                text === "↩️ رجوع"
            ) {

                delete sessions[userId];

                return sendMenu(
                    chatId
                );
            }

            // ==================================================
            // لا توجد جلسة
            // ==================================================

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

            // ==================================================
            // GROUP
            // ==================================================

            if (
                session.type === "group"
            ) {

                // العدد
                if (
                    session.step === "count"
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

                // الاسم
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

                // المفتاح
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

                // الرابط
                if (
                    session.step === "url"
                ) {

                    session.streams.push({

                        name:
                            session.currentName,

                        key:
                            session.currentKey,

                        url:
                            text

                    });

                    if (
                        session.current <
                        session.count
                    ) {

                        session.current++;

                        session.step =
                            "name";

                        return bot.sendMessage(

                            chatId,

                            `📡 البث ${session.current} من ${session.count}\n\n` +

                            `أرسل اسم البث:`

                        );
                    }

                    const groupStreams =
                        [...session.streams];

                    delete sessions[userId];

                    await startGroupStreams(

                        chatId,

                        groupStreams

                    );

                    return;
                }
            }

            // ==================================================
            // STOP
            // ==================================================

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

            // ==================================================
            // CHECK
            // ==================================================

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

            // ==================================================
            // STREAM STATUS
            // ==================================================

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
// Telegram polling error
// ======================================================

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

// ======================================================
// التحقق من FFmpeg عند بدء البرنامج
// ======================================================

(async () => {

    const result =
        await checkFFmpeg();

    if (!result.ok) {

        console.error(
            "\n❌ FFmpeg غير موجود أو لا يمكن تشغيله."
        );

        console.error(
            "🔴 الخطأ:",
            result.error
        );

        console.error(
            "\nقم بتثبيت FFmpeg على السيرفر ثم أعد التشغيل.\n"
        );

    } else {

        console.log(
            "✅ FFmpeg جاهز:"
        );

        console.log(
            result.version
        );

    }

})();

// ======================================================
// Shutdown
// ======================================================

function shutdown() {

    console.log(
        "🛑 إيقاف البوت..."
    );

    for (
        const name of Object.keys(
            streams
        )
    ) {

        try {

            streams[name]
                .manualStop =
                true;

            streams[name]
                .process
                .kill(
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
