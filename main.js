// ======================================================
// DARK TELEGRAM STREAM BOT
// Solo + Group + Stop + Status + FFprobe + MP4 Loop
// ======================================================

const TelegramBot = require("node-telegram-bot-api");
const { spawn, execFile } = require("child_process");
const fs = require("fs");

// ======================================================
// 👇👇👇 ضع توكن Telegram هنا 👇👇👇
// ======================================================

const TOKEN = "8938418856:AAHmkAy9CWRzuHmZc4b5bUmqSSZUGSbwUN4";

// ======================================================
// Facebook RTMP
// ======================================================

const FACEBOOK_RTMP =
    "rtmps://live-api-s.facebook.com:443/rtmp/";

// ======================================================
// التحقق من التوكن
// ======================================================

if (!TOKEN || TOKEN === "ضع_توكن_البوت_هنا") {
    console.error("❌ ضع توكن Telegram داخل TOKEN");
    process.exit(1);
}

// ======================================================
// تشغيل البوت
// ======================================================

const bot = new TelegramBot(TOKEN, {
    polling: true
});

console.log("🤖 Telegram Stream Bot Started");

// ======================================================
// البيانات
// ======================================================

const streams = {};
const sessions = {};

// ======================================================
// لوحة الأزرار الخارجية
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
                ["🛑 إيقاف بث معين"],
                ["⛔ إيقاف جميع البثوث"],
                ["↩️ رجوع"]
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
    if (!key) return "غير معروف";

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

                "-timeout",
                "10000000",

                url
            ],
            {
                timeout: 20000
            },

            (error, stdout, stderr) => {

                if (error) {

                    resolve({
                        ok: false,
                        error:
                            stderr ||
                            error.message ||
                            "الرابط غير صالح"
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
                                    (seconds % 3600) / 60
                                );

                            const s =
                                seconds % 60;

                            duration =
                                String(h).padStart(2, "0") +
                                ":" +
                                String(m).padStart(2, "0") +
                                ":" +
                                String(s).padStart(2, "0");

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

    const isMp4 =
        /\.mp4(\?|$)/i.test(url);

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
// تشغيل بث
// ======================================================

async function startStream(
    chatId,
    name,
    key,
    url,
    type
) {

    name = name.trim();
    key = key.trim();
    url = url.trim();

    if (!name || !key || !url) {

        await bot.sendMessage(
            chatId,
            "❌ البيانات ناقصة."
        );

        return false;
    }

    // منع تكرار الاسم
    const alreadyExists =
        Object.values(streams).find(
            stream =>
                stream.chatId === chatId &&
                stream.name === name
        );

    if (alreadyExists) {

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
        `🔍 جاري فحص الرابط بواسطة FFprobe...\n\n📺 ${name}`
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

    // ==================================================
    // Facebook RTMPS
    // ==================================================

    const output =
        FACEBOOK_RTMP + key;

    // ==================================================
    // FFmpeg
    // ==================================================

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

        process = spawn(
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
            `❌ تعذر تشغيل FFmpeg:\n\n${error.message}`
        );

        return false;
    }

    const streamId =
        Date.now() +
        "_" +
        Math.random()
            .toString(36)
            .substring(2, 8);

    streams[streamId] = {

        id: streamId,

        chatId,

        name,

        key,

        url,

        type,

        process,

        startedAt: Date.now(),

        status: "يعمل",

        isMp4,

        manualStop: false
    };

    // ==================================================
    // سجل FFmpeg
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

            if (streams[streamId]) {

                streams[streamId].status =
                    "يعمل";
            }

            try {

                await bot.sendMessage(
                    chatId,

                    `✅ تم تشغيل البث\n\n` +

                    `📺 الاسم:\n${name}\n\n` +

                    `🔑 المفتاح:\n${maskKey(key)}\n\n` +

                    `🔗 الرابط:\n${url}\n\n` +

                    `📡 النوع:\n${type}\n\n` +

                    `🔄 تكرار MP4:\n` +

                    `${isMp4
                        ? "مفعّل ✅"
                        : "غير مطلوب"}\n\n` +

                    `🟢 الحالة:\nيعمل`,

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
        async error => {

            console.error(
                `FFmpeg error ${name}:`,
                error
            );

            delete streams[streamId];

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
    // FFmpeg Close
    // ==================================================

    process.on(
        "close",
        async code => {

            console.log(
                `FFmpeg stopped: ${name}, code=${code}`
            );

            const stream =
                streams[streamId];

            if (!stream) return;

            const manualStop =
                stream.manualStop;

            delete streams[streamId];

            if (!manualStop) {

                try {

                    await bot.sendMessage(
                        chatId,

                        `🔴 توقف البث:\n\n` +

                        `📺 ${name}\n\n` +

                        `رمز FFmpeg: ${code}`,

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

    name = name.trim();

    const stream =
        Object.values(streams).find(
            item =>
                item.chatId === chatId &&
                item.name === name
        );

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

    delete streams[stream.id];

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

    const list =
        Object.values(streams)
            .filter(
                stream =>
                    stream.chatId === chatId
            );

    if (list.length === 0) {

        await bot.sendMessage(
            chatId,
            "ℹ️ لا توجد بثوث تعمل حالياً.",
            mainKeyboard()
        );

        return;
    }

    for (const stream of list) {

        stream.manualStop = true;

        try {

            stream.process.kill(
                "SIGTERM"
            );

        } catch {}

        delete streams[stream.id];
    }

    await bot.sendMessage(
        chatId,

        `🛑 تم إيقاف جميع البثوث.\n\n` +
        `📊 العدد: ${list.length}`,

        mainKeyboard()
    );
}

// ======================================================
// حالة جميع البثوث
// ======================================================

async function showStatus(chatId) {

    const list =
        Object.values(streams)
            .filter(
                stream =>
                    stream.chatId === chatId
            );

    if (list.length === 0) {

        await bot.sendMessage(
            chatId,
            "📺 البثوث:\n\nلا توجد بثوث نشطة.",
            mainKeyboard()
        );

        return;
    }

    let text =
        `📺 البثوث النشطة: ${list.length}\n\n`;

    list.forEach(
        (stream, index) => {

            const seconds =
                Math.floor(
                    (Date.now() -
                        stream.startedAt) /
                    1000
                );

            const hours =
                Math.floor(
                    seconds / 3600
                );

            const minutes =
                Math.floor(
                    (seconds % 3600) /
                    60
                );

            const secs =
                seconds % 60;

            text +=

                `${index + 1}️⃣ ${stream.name}\n` +

                `🔑 ${maskKey(stream.key)}\n` +

                `📡 ${stream.type}\n` +

                `🟢 ${stream.status}\n` +

                `⏱ ${hours}س ` +
                `${minutes}د ` +
                `${secs}ث\n` +

                `🔄 MP4: ` +
                `${stream.isMp4 ? "نعم" : "لا"}\n\n`;
        }
    );

    await bot.sendMessage(
        chatId,
        text,
        mainKeyboard()
    );
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
        "🔍 جاري فحص الرابط بواسطة FFprobe..."
    );

    const result =
        await probeUrl(url);

    if (!result.ok) {

        await bot.sendMessage(
            chatId,

            `❌ فشل فحص الرابط.\n\n` +
            `${result.error || "الرابط غير صالح."}`,

            mainKeyboard()
        );

        return;
    }

    await bot.sendMessage(
        chatId,

        `✅ الرابط يعمل\n\n` +

        `🌐 الرابط:\n${url}\n\n` +

        `🎥 الفيديو:\n${result.video}\n\n` +

        `🔊 الصوت:\n${result.audio}\n\n` +

        `⏱ المدة:\n${result.duration}\n\n` +

        `📡 المصدر:\n${result.format}`,

        mainKeyboard()
    );
}

// ======================================================
// /start
// ======================================================

bot.onText(
    /^\/start$/,
    async msg => {

        const chatId =
            msg.chat.id;

        delete sessions[chatId];

        // =================================================
        // هنا فقط الأزرار الخارجية بدون رسالة الترحيب
        // =================================================

        await bot.sendMessage(
            chatId,
            " ",
            mainKeyboard()
        );
    }
);

// ======================================================
// استقبال الرسائل
// ======================================================

bot.on(
    "message",
    async msg => {

        try {

            if (!msg.text) return;

            const chatId =
                msg.chat.id;

            const text =
                msg.text.trim();

            // /start يعالجه الجزء السابق
            if (text === "/start") {
                return;
            }

            // ==================================================
            // SOLO
            // ==================================================

            if (text === "🎯 SOLO") {

                sessions[chatId] = {

                    type: "solo",

                    step: "name"
                };

                return bot.sendMessage(
                    chatId,
                    "🎯 SOLO\n\n📺 اسم البث؟"
                );
            }

            // ==================================================
            // GROUP
            // ==================================================

            if (text === "🔥 GROUP") {

                sessions[chatId] = {

                    type: "group",

                    step: "count",

                    count: 0,

                    current: 0,

                    items: []
                };

                return bot.sendMessage(
                    chatId,

                    "🔥 GROUP\n\n" +
                    "🔢 كم عدد البثوث التي تريد تشغيلها؟"
                );
            }

            // ==================================================
            // STOP
            // ==================================================

            if (text === "🛑 STOP") {

                return bot.sendMessage(
                    chatId,
                    "🛑 اختر:",
                    stopKeyboard()
                );
            }

            // ==================================================
            // إيقاف بث معين
            // ==================================================

            if (
                text ===
                "🛑 إيقاف بث معين"
            ) {

                const list =
                    Object.values(streams)
                        .filter(
                            stream =>
                                stream.chatId ===
                                chatId
                        );

                if (list.length === 0) {

                    return bot.sendMessage(
                        chatId,
                        "📊 لا توجد بثوث نشطة.",
                        mainKeyboard()
                    );
                }

                let message =
                    "🛑 أرسل رقم البث لإيقافه:\n\n";

                list.forEach(
                    (stream, index) => {

                        message +=
                            `${index + 1}️⃣ ${stream.name}\n`;
                    }
                );

                sessions[chatId] = {

                    type: "stop",

                    step: "number",

                    list: list
                };

                return bot.sendMessage(
                    chatId,
                    message
                );
            }

            // ==================================================
            // إيقاف جميع البثوث
            // ==================================================

            if (
                text ===
                "⛔ إيقاف جميع البثوث"
            ) {

                return stopAll(chatId);
            }

            // ==================================================
            // الحالة
            // ==================================================

            if (text === "📊 الحالة") {

                return showStatus(
                    chatId
                );
            }

            // ==================================================
            // فحص الرابط
            // ==================================================

            if (
                text ===
                "🔍 فحص الرابط"
            ) {

                sessions[chatId] = {

                    type: "check",

                    step: "url"
                };

                return bot.sendMessage(
                    chatId,
                    "🔍 أرسل رابط البث لفحصه:"
                );
            }

            // ==================================================
            // رجوع
            // ==================================================

            if (text === "↩️ رجوع") {

                delete sessions[chatId];

                return bot.sendMessage(
                    chatId,
                    "🏠 القائمة الرئيسية",
                    mainKeyboard()
                );
            }

            // ==================================================
            // لا توجد جلسة
            // ==================================================

            const session =
                sessions[chatId];

            if (!session) {

                return bot.sendMessage(
                    chatId,
                    "❓ استخدم /start لعرض القائمة."
                );
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

                    return bot.sendMessage(
                        chatId,

                        `📺 الاسم: ${text}\n\n` +
                        "🔑 أرسل مفتاح Facebook:"
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
                        "🔗 أرسل رابط البث:"
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

                    delete sessions[chatId];

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

                // العدد
                if (
                    session.step ===
                    "count"
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
                            "❌ أرسل عدداً من 1 إلى 50."
                        );
                    }

                    session.count =
                        count;

                    session.current =
                        1;

                    session.items =
                        [];

                    session.step =
                        "name";

                    return bot.sendMessage(
                        chatId,

                        `🔥 GROUP\n\n` +

                        `📺 البث 1 من ${count}\n\n` +

                        "📛 اسم البث؟"
                    );
                }

                // الاسم
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
                        "🔑 أرسل مفتاح Facebook:"
                    );
                }

                // المفتاح
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
                        "🔗 أرسل رابط البث:"
                    );
                }

                // الرابط
                if (
                    session.step ===
                    "url"
                ) {

                    session.items.push({

                        name:
                            session.name,

                        key:
                            session.key,

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

                            `🔥 GROUP\n\n` +

                            `📺 البث ` +
                            `${session.current} من ` +
                            `${session.count}\n\n` +

                            "📛 اسم البث؟"
                        );
                    }

                    const items =
                        session.items;

                    delete sessions[chatId];

                    await bot.sendMessage(
                        chatId,

                        `🔥 تم إدخال ${items.length} بثوث.\n\n` +
                        "🔍 جاري تشغيل البثوث..."
                    );

                    let started = 0;

                    for (
                        const item of items
                    ) {

                        const result =
                            await startStream(
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

                    return;
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
                    "number"
                ) {

                    const number =
                        Number(text);

                    if (
                        !Number.isInteger(number) ||
                        number < 1 ||
                        number >
                            session.list.length
                    ) {

                        return bot.sendMessage(
                            chatId,
                            "❌ رقم غير صحيح."
                        );
                    }

                    const stream =
                        session.list[
                            number - 1
                        ];

                    stream.manualStop =
                        true;

                    try {

                        stream.process.kill(
                            "SIGTERM"
                        );

                    } catch {}

                    delete streams[
                        stream.id
                    ];

                    delete sessions[
                        chatId
                    ];

                    return bot.sendMessage(
                        chatId,

                        `🛑 تم إيقاف البث:\n\n` +
                        `📺 ${stream.name}\n\n` +
                        `🔑 ${maskKey(stream.key)}`,

                        mainKeyboard()
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

                    delete sessions[
                        chatId
                    ];

                    return checkUrl(
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

                    `❌ حدث خطأ:\n\n${error.message}`,

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
        const stream of
        Object.values(streams)
    ) {

        try {

            stream.manualStop =
                true;

            stream.process.kill(
                "SIGTERM"
            );

        } catch {}
    }

    process.exit(0);
}

process.on(
    "SIGTERM",
    safeShutdown
);

process.on(
    "SIGINT",
    safeShutdown
);
