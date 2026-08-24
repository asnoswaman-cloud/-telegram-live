// ======================================================
// DARK TELEGRAM STREAM BOT
// Solo + Group + Stop + Status + FFprobe + MP4 Loop
// ======================================================

import TelegramBot from "node-telegram-bot-api";
import { spawn, execFile } from "child_process";
import fs from "fs";

// ======================================================
// 👇👇👇 ضع توكن Telegram هنا 👇👇👇
// ======================================================

const TOKEN = "8826608464:AAGJC_p_0uLvnMFfD-dR5HVKlY04bABOOmU";

// مثال:
// const TOKEN = "123456789:AAxxxxxxxxxxxxxxxxxxxxxxxx";

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
// التحقق من الرابط بواسطة FFprobe
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
                    const data = JSON.parse(stdout);

                    resolve({
                        ok: true,
                        format: data?.format?.format_name || "unknown",
                        duration: data?.format?.duration || null
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
// فحص الرابط من البوت
// ======================================================

async function checkUrl(chatId, url) {

    await bot.sendMessage(
        chatId,
        "🔎 جاري فحص الرابط بواسطة FFprobe...\n\n" +
        url
    );

    const result = await probeUrl(url);

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

    await bot.sendMessage(chatId, message);
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

    // فحص الرابط قبل تشغيل البث
    await bot.sendMessage(
        chatId,
        `🔎 فحص رابط البث "${name}"...`
    );

    const probe = await probeUrl(sourceUrl);

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
        sourceUrl.toLowerCase().split("?")[0].endsWith(".mp4");

    let args = [];

    // تكرار MP4 تلقائياً
    if (isMp4) {
        args.push(
            "-stream_loop",
            "-1"
        );
    }

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

    streams[name] = {
        name,
        key: facebookKey,
        url: sourceUrl,
        process,
        startedAt: Date.now(),
        status: "starting"
    };

    // حفظ سجل FFmpeg
    const logFile =
        `stream-${name.replace(/[^a-zA-Z0-9_-]/g, "_")}.log`;

    const logStream =
        fs.createWriteStream(
            logFile,
            {
                flags: "a"
            }
        );

    process.stderr.pipe(logStream);

    // FFmpeg بدأ
    process.on("spawn", async () => {

        if (streams[name]) {
            streams[name].status = "running";
        }

        await bot.sendMessage(
            chatId,
            `✅ تم تشغيل البث\n\n` +
            `📛 الاسم: ${name}\n` +
            `🔑 المفتاح: ${maskKey(facebookKey)}\n` +
            `📡 المصدر: ${isMp4 ? "MP4 🔁 تكرار تلقائي" : "مباشر"}\n` +
            `🟢 الحالة: يعمل`
        );
    });

    // خطأ
    process.on("error", async (error) => {

        console.error(
            `FFmpeg error ${name}:`,
            error
        );

        delete streams[name];

        await bot.sendMessage(
            chatId,
            `❌ حدث خطأ في بث "${name}"\n\n` +
            error.message
        );
    });

    // توقف FFmpeg
    process.on("close", async (code) => {

        console.log(
            `FFmpeg stopped: ${name}, code=${code}`
        );

        delete streams[name];

        try {

            await bot.sendMessage(
                chatId,
                `🛑 توقف البث "${name}"\n\n` +
                `كود FFmpeg: ${code ?? "غير معروف"}`
            );

        } catch {}
    });

    return true;
}

// ======================================================
// إيقاف بث معين
// ======================================================

async function stopStream(chatId, name) {

    name = name.trim();

    const stream = streams[name];

    if (!stream) {

        await bot.sendMessage(
            chatId,
            `❌ لا يوجد بث باسم "${name}".`
        );

        return;
    }

    try {

        stream.process.kill("SIGTERM");

    } catch {}

    delete streams[name];

    await bot.sendMessage(
        chatId,
        `🛑 تم إيقاف البث "${name}".`
    );
}

// ======================================================
// إيقاف جميع البثوث
// ======================================================

async function stopAll(chatId) {

    const names = Object.keys(streams);

    if (names.length === 0) {

        await bot.sendMessage(
            chatId,
            "ℹ️ لا توجد بثوث تعمل حالياً."
        );

        return;
    }

    for (const name of names) {

        try {
            streams[name].process.kill("SIGTERM");
        } catch {}

        delete streams[name];
    }

    await bot.sendMessage(
        chatId,
        `🛑 تم إيقاف جميع البثوث.\n\n` +
        `📊 العدد: ${names.length}`
    );
}

// ======================================================
// حالة جميع البثوث
// ======================================================

async function showStatus(chatId) {

    const names = Object.keys(streams);

    if (names.length === 0) {

        await bot.sendMessage(
            chatId,
            "📊 لا توجد بثوث نشطة."
        );

        return;
    }

    let text =
        `📊 البثوث النشطة: ${names.length}\n\n`;

    for (const name of names) {

        const stream = streams[name];

        const seconds =
            Math.floor(
                (Date.now() - stream.startedAt) / 1000
            );

        const minutes =
            Math.floor(seconds / 60);

        const hours =
            Math.floor(minutes / 60);

        const time =
            hours > 0
                ? `${hours}س ${minutes % 60}د`
                : `${minutes}د ${seconds % 60}ث`;

        text +=
            `📛 ${name}\n` +
            `🔑 ${maskKey(stream.key)}\n` +
            `🟢 ${stream.status}\n` +
            `⏱ ${time}\n\n`;
    }

    await bot.sendMessage(
        chatId,
        text
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

    const stream = streams[name];

    if (!stream) {

        await bot.sendMessage(
            chatId,
            `❌ البث "${name}" غير موجود أو متوقف.`
        );

        return;
    }

    const seconds =
        Math.floor(
            (Date.now() - stream.startedAt) / 1000
        );

    await bot.sendMessage(
        chatId,
        `📊 حالة البث\n\n` +
        `📛 الاسم: ${name}\n` +
        `🔑 المفتاح: ${maskKey(stream.key)}\n` +
        `🟢 الحالة: ${stream.status}\n` +
        `⏱ المدة: ${seconds} ثانية\n` +
        `📡 المصدر: ${stream.url}`
    );
}

// ======================================================
// القائمة الرئيسية
// ======================================================

function sendMenu(chatId) {

    const text =
`🤖 DARK STREAM BOT

اختر الأمر:

▶️ /solo
تشغيل بث واحد

👥 /group
تشغيل عدة بثوث

🛑 /stop
إيقاف بث معين

⛔ /stopall
إيقاف جميع البثوث

📊 /status
حالة جميع البثوث

🔎 /check
فحص رابط

📊 /streamstatus
حالة بث معين`;

    return bot.sendMessage(
        chatId,
        text
    );
}

// ======================================================
// استقبال الرسائل
// ======================================================

bot.on("message", async (msg) => {

    try {

        if (!msg.text) return;

        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const text = msg.text.trim();

        // ==============================================
        // /start
        // ==============================================

        if (text === "/start") {

            delete sessions[userId];

            return sendMenu(chatId);
        }

        // ==============================================
        // /solo
        // ==============================================

        if (text === "/solo") {

            sessions[userId] = {
                type: "solo",
                step: "name"
            };

            return bot.sendMessage(
                chatId,
                "1️⃣ أرسل اسم البث:"
            );
        }

        // ==============================================
        // /group
        // ==============================================

        if (text === "/group") {

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

        // ==============================================
        // /stop
        // ==============================================

        if (text === "/stop") {

            sessions[userId] = {
                type: "stop",
                step: "name"
            };

            return bot.sendMessage(
                chatId,
                "🛑 أرسل اسم البث الذي تريد إيقافه:"
            );
        }

        // ==============================================
        // /stopall
        // ==============================================

        if (text === "/stopall") {

            return stopAll(chatId);
        }

        // ==============================================
        // /status
        // ==============================================

        if (text === "/status") {

            return showStatus(chatId);
        }

        // ==============================================
        // /check
        // ==============================================

        if (text === "/check") {

            sessions[userId] = {
                type: "check",
                step: "url"
            };

            return bot.sendMessage(
                chatId,
                "🌐 أرسل رابط البث لفحصه:"
            );
        }

        // ==============================================
        // /streamstatus
        // ==============================================

        if (text === "/streamstatus") {

            sessions[userId] = {
                type: "streamstatus",
                step: "name"
            };

            return bot.sendMessage(
                chatId,
                "📊 أرسل اسم البث:"
            );
        }

        // ==============================================
        // لا توجد جلسة
        // ==============================================

        if (!sessions[userId]) {

            return bot.sendMessage(
                chatId,
                "❓ استخدم /start لعرض القائمة."
            );
        }

        const session = sessions[userId];

        // ==================================================
        // SOLO
        // ==================================================

        if (session.type === "solo") {

            // الاسم
            if (session.step === "name") {

                session.name = text;
                session.step = "key";

                return bot.sendMessage(
                    chatId,
                    "2️⃣ أرسل مفتاح Facebook:"
                );
            }

            // المفتاح
            if (session.step === "key") {

                session.key = text;
                session.step = "url";

                return bot.sendMessage(
                    chatId,
                    "3️⃣ أرسل رابط البث:"
                );
            }

            // الرابط
            if (session.step === "url") {

                const {
                    name,
                    key
                } = session;

                delete sessions[userId];

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

        if (session.type === "group") {

            // العدد
            if (session.step === "count") {

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

                session.count = count;
                session.current = 1;
                session.step = "name";

                return bot.sendMessage(
                    chatId,
                    `👥 تم تحديد ${count} بثوث.\n\n` +
                    `📡 البث 1 من ${count}\n\n` +
                    `أرسل اسم البث:`
                );
            }

            // الاسم
            if (session.step === "name") {

                session.currentName = text;
                session.step = "key";

                return bot.sendMessage(
                    chatId,
                    `🔑 البث ${session.current} من ${session.count}\n\n` +
                    `أرسل مفتاح Facebook:`
                );
            }

            // المفتاح
            if (session.step === "key") {

                session.currentKey = text;
                session.step = "url";

                return bot.sendMessage(
                    chatId,
                    `🌐 البث ${session.current} من ${session.count}\n\n` +
                    `أرسل رابط البث:`
                );
            }

            // الرابط
            if (session.step === "url") {

                const name =
                    session.currentName;

                const key =
                    session.currentKey;

                await startStream(
                    chatId,
                    name,
                    key,
                    text
                );

                if (
                    session.current >=
                    session.count
                ) {

                    delete sessions[userId];

                    return bot.sendMessage(
                        chatId,
                        `✅ انتهى إعداد Group.\n\n` +
                        `📊 العدد المطلوب: ${session.count}`
                    );
                }

                session.current++;
                session.step = "name";

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

        if (session.type === "stop") {

            delete sessions[userId];

            return stopStream(
                chatId,
                text
            );
        }

        // ==================================================
        // CHECK
        // ==================================================

        if (session.type === "check") {

            delete sessions[userId];

            return checkUrl(
                chatId,
                text
            );
        }

        // ==================================================
        // STREAM STATUS
        // ==================================================

        if (session.type === "streamstatus") {

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
                error.message
            );

        } catch {}
    }
});

// ======================================================
// أخطاء Telegram
// ======================================================

bot.on("polling_error", (error) => {

    console.error(
        "Telegram polling error:",
        error.message
    );
});

// ======================================================
// إيقاف آمن
// ======================================================

process.on("SIGTERM", () => {

    console.log(
        "🛑 SIGTERM received"
    );

    for (const name of Object.keys(streams)) {

        try {
            streams[name].process.kill("SIGTERM");
        } catch {}
    }

    process.exit(0);
});

process.on("SIGINT", () => {

    for (const name of Object.keys(streams)) {

        try {
            streams[name].process.kill("SIGTERM");
        } catch {}
    }

    process.exit(0);
});
