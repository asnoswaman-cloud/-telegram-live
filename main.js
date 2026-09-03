// ======================================================
// DARK TELEGRAM STREAM BOT
// SOLO + GROUP + STOP + STATUS + FFprobe + MP4 LOOP
// JavaScript ES MODULE
// ======================================================

import TelegramBot from "node-telegram-bot-api";
import { spawn, execFile } from "child_process";
import fs from "fs";

// ======================================================
// ضع توكن Telegram الجديد هنا
// ======================================================

const TOKEN = "8774499504:AAGn4dXL4d4wDdYxz8C8NvzkCvg_pYTFKAM";

// ======================================================
// Facebook RTMPS
// ======================================================

const FACEBOOK_RTMP =
    "rtmps://live-api-s.facebook.com:443/rtmp/";

// ======================================================
// [إضافة كمية] وضع التعديلات البصرية والصوتية
// ======================================================

const QUANTUM_MODE = true; // اجعلها false للعودة إلى Stream Copy

// ======================================================
// [إضافة كمية] أدوات التوليد العشوائي للبصمة
// ======================================================

function randomBetween(min, max) {
    return min + Math.random() * (max - min);
}

function getRandomCropFilter() {
    // القص والزوم: اقتطاع من 1% إلى 3% من الأطراف
    const cropX = randomBetween(0.01, 0.03);
    const cropY = randomBetween(0.01, 0.03);
    return `crop=in_w*(1-${cropX.toFixed(4)}):in_h*(1-${cropY.toFixed(4)}):(in_w*${cropX.toFixed(4)}/2):(in_h*${cropY.toFixed(4)}/2), scale=1280:720`;
}

function getVisualOverlayAndColor() {
    // الشفافيات الخفية وتعديل الألوان
    const opacity = "0.015";
    return `color=green@${opacity}[ov]; [0:v]eq=saturation=1.03:brightness=0.01, format=yuv420p [base]; [base][ov]overlay=0:0`;
}

function getAudioManipulation() {
    // تغيير النبرة + حقن ضوضاء وردية
    const pitchFactor = randomBetween(0.98, 1.02);
    const sampleRate = Math.round(44100 * pitchFactor);
    const noiseAmplitude = "0.002";
    return `asetrate=${sampleRate}, aresample=44100, anoisesrc=color=pink:amplitude=${noiseAmplitude}[a]`;
}

function getDynamicBorderFilter() {
    // الإطار الديناميكي لتغيير البصمة
    return `drawbox=x=0:y=0:w=10:h=ih:color=white@0.1:t=fill, drawbox=x=iw-10:y=0:w=10:h=ih:color=black@0.1:t=fill, gblur=sigma=0.5`;
}

function getMirrorAndPip() {
    // الانعكاس الأفقي + خلفية تفاعلية
    const useMirror = Math.random() > 0.5;
    const mirrorFilter = useMirror ? "hflip" : "null";
    return `[0:v]${mirrorFilter}, scale=1280:720 [main]; color=gray:s=1280x720, geq=r='random(0)*255':g='random(0)*255':b='random(0)*255' [bg]; [bg][main]overlay=0:0`;
}

function getVfrAndSpeed() {
    // تعديل السرعة ومعدل الإطارات المتغير
    const speed = randomBetween(1.005, 1.02);
    const vfr = Math.random() > 0.5 ? 58.5 : 59.94;
    return { speed, vfr };
}

// ======================================================
// التحقق من التوكن
// ======================================================

if (!TOKEN || TOKEN === "YOUR_NEW_BOT_TOKEN_HERE") {
    console.error("❌ ضع توكن Telegram داخل TOKEN");
    process.exit(1);
}

// ======================================================
// تشغيل Telegram
// ======================================================

const bot = new TelegramBot(TOKEN, {
    polling: true
});

console.log("🤖 DARK STREAM BOT Started");
console.log(`⚡ Quantum Mode: ${QUANTUM_MODE ? "مفعّل" : "معطّل"}`);

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
    key = String(key).trim();
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
                [{ text: "🎯 SOLO" }],
                [{ text: "🔥 GROUP" }],
                [{ text: "🛑 STOP" }],
                [{ text: "📊 الحالة" }],
                [{ text: "🔍 فحص الرابط" }],
                [{ text: "📊 حالة بث معين" }]
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
                [{ text: "🛑 إيقاف بث معين" }],
                [{ text: "⛔ إيقاف جميع البثوث" }],
                [{ text: "↩️ رجوع" }]
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
    return new Promise((resolve) => {
        url = String(url || "").trim();
        if (!url) {
            resolve({ ok: false, error: "الرابط فارغ." });
            return;
        }
        execFile(
            "ffprobe",
            [
                "-v", "error",
                "-show_entries", "format=format_name,duration",
                "-show_entries", "stream=codec_type,codec_name",
                "-of", "json",
                "-timeout", "10000000",
                url
            ],
            { timeout: 30000, maxBuffer: 1024 * 1024 },
            (error, stdout, stderr) => {
                if (error) {
                    resolve({
                        ok: false,
                        error: String(stderr || "").trim() || error.message || "تعذر فحص الرابط."
                    });
                    return;
                }
                try {
                    const data = JSON.parse(stdout || "{}");
                    const foundStreams = Array.isArray(data.streams) ? data.streams : [];
                    const video = foundStreams.find(x => x && x.codec_type === "video");
                    const audio = foundStreams.find(x => x && x.codec_type === "audio");
                    const format = data?.format?.format_name || "unknown";
                    const duration = data?.format?.duration || null;
                    resolve({
                        ok: true,
                        format,
                        duration,
                        video: video?.codec_name || "غير معروف",
                        audio: audio?.codec_name || "غير موجود"
                    });
                } catch {
                    resolve({ ok: false, error: "تعذر قراءة نتيجة FFprobe." });
                }
            }
        );
    });
}

// ======================================================
// فحص الرابط من البوت
// ======================================================

async function checkUrl(chatId, url) {
    await bot.sendMessage(chatId, "🔎 جاري فحص الرابط بواسطة FFprobe...\n\n" + url);
    const result = await probeUrl(url);
    if (!result.ok) {
        await bot.sendMessage(chatId, "❌ فشل فحص الرابط.\n\n" + "تأكد أن الرابط يمكن الوصول إليه وأن FFmpeg/FFprobe يستطيع قراءته.", mainKeyboard());
        return;
    }
    let message = "✅ الرابط قابل للقراءة\n\n" + "🌐 الرابط:\n" + url + "\n\n📡 الصيغة: " + result.format + "\n🎥 الفيديو: " + result.video + "\n🔊 الصوت: " + result.audio;
    if (result.duration) {
        const durationNumber = Number(result.duration);
        if (Number.isFinite(durationNumber)) {
            message += "\n⏱ المدة: " + durationNumber.toFixed(1) + " ثانية";
        } else {
            message += "\n⏱ المدة: مباشر / غير محددة";
        }
    } else {
        message += "\n⏱ المدة: مباشر / غير محددة";
    }
    await bot.sendMessage(chatId, message, mainKeyboard());
}

// ======================================================
// معرفة إذا كان الرابط MP4
// ======================================================

function isMp4Url(sourceUrl) {
    try {
        const withoutHash = String(sourceUrl).split("#")[0];
        const withoutQuery = withoutHash.split("?")[0];
        return /\.mp4$/i.test(withoutQuery);
    } catch {
        return false;
    }
}

// ======================================================
// بناء FFmpeg
//
// الأولوية: STREAM COPY (أقل استهلاك CPU)
// لكن إذا كان QUANTUM_MODE مفعلاً، نستخدم Transcode مع التعديلات
// ======================================================

function buildFFmpegArgs(sourceUrl, target) {
    const isMp4 = isMp4Url(sourceUrl);
    
    // [إضافة كمية] إذا كان الوضع الكمي مفعلاً، نستخدم الترميز مع التعديلات
    if (QUANTUM_MODE) {
        return buildQuantumArgs(sourceUrl, target);
    }

    let args = [];
    if (isMp4) {
        args.push("-stream_loop", "-1");
    }
    args.push(
        "-nostdin",
        "-reconnect", "1",
        "-reconnect_at_eof", "1",
        "-reconnect_streamed", "1",
        "-reconnect_delay_max", "10",
        "-rw_timeout", "15000000",
        "-i", sourceUrl,
        "-map", "0:v:0?",
        "-map", "0:a:0?",
        "-c:v", "copy",
        "-c:a", "copy",
        "-flvflags", "no_duration_filesize",
        "-f", "flv",
        target
    );
    return { args, isMp4 };
}

// ======================================================
// [إضافة كمية] بناء FFmpeg مع التعديلات الكمية
// ======================================================

function buildQuantumArgs(sourceUrl, target) {
    const isMp4 = isMp4Url(sourceUrl);
    const cropFilter = getRandomCropFilter();
    const overlayFilter = getVisualOverlayAndColor();
    const borderFilter = getDynamicBorderFilter();
    const mirrorFilter = getMirrorAndPip();
    const audioFilter = getAudioManipulation();
    const { speed, vfr } = getVfrAndSpeed();

    let args = [];
    if (isMp4) {
        args.push("-stream_loop", "-1");
    }
    args.push(
        "-nostdin",
        "-reconnect", "1",
        "-reconnect_at_eof", "1",
        "-reconnect_streamed", "1",
        "-reconnect_delay_max", "10",
        "-rw_timeout", "15000000",
        "-i", sourceUrl,
        // [إضافة كمية] الفلاتر البصرية
        "-vf", `${cropFilter}, ${overlayFilter}, ${borderFilter}`,
        // [إضافة كمية] الفلاتر الصوتية
        "-af", audioFilter,
        // [إضافة كمية] تعديل السرعة
        "-filter:v", `setpts=${speed}*PTS`,
        // [إضافة كمية] معدل الإطارات المتغير
        "-r", String(vfr),
        "-map", "0:v:0?",
        "-map", "0:a:0?",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-tune", "zerolatency",
        "-pix_fmt", "yuv420p",
        "-g", "60",
        "-keyint_min", "60",
        "-b:v", "2500k",
        "-maxrate", "3000k",
        "-bufsize", "6000k",
        "-c:a", "aac",
        "-b:a", "128k",
        "-ar", "44100",
        "-f", "flv",
        target
    );
    return { args, isMp4, quantumMode: true };
}

// ======================================================
// بناء إعادة الترميز الاحتياطية
// ======================================================

function buildTranscodeArgs(sourceUrl, target) {
    const isMp4 = isMp4Url(sourceUrl);
    let args = [];
    if (isMp4) {
        args.push("-stream_loop", "-1");
    }
    args.push(
        "-nostdin",
        "-reconnect", "1",
        "-reconnect_at_eof", "1",
        "-reconnect_streamed", "1",
        "-reconnect_delay_max", "10",
        "-rw_timeout", "15000000",
        "-i", sourceUrl,
        "-map", "0:v:0?",
        "-map", "0:a:0?",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-tune", "zerolatency",
        "-pix_fmt", "yuv420p",
        "-r", "30",
        "-g", "60",
        "-keyint_min", "60",
        "-b:v", "2500k",
        "-maxrate", "3000k",
        "-bufsize", "6000k",
        "-c:a", "aac",
        "-b:a", "128k",
        "-ar", "44100",
        "-f", "flv",
        target
    );
    return { args, isMp4 };
}

// ======================================================
// تشغيل بث واحد
// ======================================================

async function startStream(chatId, name, facebookKey, sourceUrl, streamType, existingProbe = null, retryCount = 0) {
    name = String(name || "").trim();
    facebookKey = String(facebookKey || "").trim();
    sourceUrl = String(sourceUrl || "").trim();
    if (!name || !facebookKey || !sourceUrl) {
        await bot.sendMessage(chatId, "❌ البيانات ناقصة.", mainKeyboard());
        return false;
    }
    if (streams[name] && !retryCount) {
        await bot.sendMessage(chatId, `⚠️ البث "${name}" يعمل بالفعل.`, mainKeyboard());
        return false;
    }
    let probe = existingProbe;
    if (!probe) {
        await bot.sendMessage(chatId, `🔎 جاري فحص الرابط...\n\n📛 ${name}`);
        probe = await probeUrl(sourceUrl);
        if (!probe.ok) {
            await bot.sendMessage(chatId, `❌ فشل فحص الرابط.\n\n📛 ${name}\n\n${probe.error || "الرابط غير صالح."}`, mainKeyboard());
            return false;
        }
    }
    const target = FACEBOOK_RTMP + facebookKey;
    const ff = buildFFmpegArgs(sourceUrl, target);
    const args = ff.args;
    const isMp4 = ff.isMp4;
    if (streams[name] && streams[name].process) {
        try { streams[name].process.kill("SIGKILL"); } catch {}
    }
    console.log(`▶️ Starting stream: ${name}${QUANTUM_MODE ? " [QUANTUM]" : ""}`);
    let process;
    try {
        process = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    } catch (error) {
        await bot.sendMessage(chatId, `❌ تعذر تشغيل FFmpeg:\n\n${error.message}`, mainKeyboard());
        return false;
    }
    streams[name] = {
        name, key: facebookKey, url: sourceUrl, type: streamType,
        process, startedAt: Date.now(),
        status: retryCount > 0 ? "reconnecting" : "starting",
        manualStop: false, isMp4, probe, retryCount,
        quantumMode: QUANTUM_MODE
    };
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
    const logFile = `stream-${safeName}.log`;
    let logStream;
    try {
        logStream = fs.createWriteStream(logFile, { flags: "a" });
        process.stderr.pipe(logStream);
    } catch (error) {
        console.error("Log error:", error.message);
    }
    process.on("spawn", async () => {
        if (streams[name]) {
            streams[name].status = "running";
        }
        if (retryCount > 0) return;
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
                `🔄 MP4 Loop:\n${isMp4 ? "مفعّل ✅" : "غير مطلوب"}\n\n` +
                `⚡ الوضع:\n${QUANTUM_MODE ? "Quantum (تعديلات كمية)" : "Stream Copy"}\n\n` +
                `🟢 الحالة:\nيعمل`,
                mainKeyboard()
            );
        } catch {}
    });
    process.on("error", async error => {
        console.error(`FFmpeg error ${name}:`, error);
        const stream = streams[name];
        if (stream && !stream.manualStop) {
            stream.status = "error";
            try {
                await bot.sendMessage(chatId, `⚠️ خطأ في FFmpeg للبث "${name}"\n\n${error.message}`, mainKeyboard());
            } catch {}
        }
    });
    process.on("close", async code => {
        console.log(`FFmpeg stopped: ${name}, code=${code}`);
        if (logStream) { try { logStream.end(); } catch {} }
        const stream = streams[name];
        if (!stream) return;
        const manualStop = Boolean(stream.manualStop);
        if (manualStop) {
            delete streams[name];
            return;
        }
        stream.status = "reconnecting";
        const nextRetry = (stream.retryCount || 0) + 1;
        console.log(`🔄 Reconnecting ${name}, attempt ${nextRetry}`);
        setTimeout(async () => {
            if (!streams[name] || streams[name].manualStop) return;
            await startStream(chatId, name, facebookKey, sourceUrl, streamType, probe, nextRetry);
        }, 5000);
    });
    return true;
}

// ======================================================
// GROUP
// ======================================================

async function startGroupStreams(chatId, groupStreams) {
    if (!Array.isArray(groupStreams) || groupStreams.length === 0) {
        await bot.sendMessage(chatId, "❌ لا توجد بثوث في GROUP.", mainKeyboard());
        return;
    }
    await bot.sendMessage(chatId, `⏳ تم جمع جميع معلومات GROUP.\n\n📊 العدد: ${groupStreams.length}\n\n🔎 جاري فحص جميع الروابط...`);
    const checkedStreams = [];
    for (let i = 0; i < groupStreams.length; i++) {
        const item = groupStreams[i];
        await bot.sendMessage(chatId, `🔎 فحص البث ${i + 1} من ${groupStreams.length}\n\n📛 ${item.name}`);
        const probe = await probeUrl(item.url);
        if (!probe.ok) {
            await bot.sendMessage(chatId, `❌ فشل فحص GROUP.\n\n📛 البث: ${item.name}\n\n${probe.error || "الرابط غير صالح."}\n\n🛑 لم يتم تشغيل أي بث من GROUP.`, mainKeyboard());
            return;
        }
        checkedStreams.push({ ...item, probe });
    }
    const names = checkedStreams.map(x => x.name);
    const uniqueNames = new Set(names);
    if (uniqueNames.size !== names.length) {
        await bot.sendMessage(chatId, "❌ يوجد اسم بث مكرر داخل GROUP.\n\nيجب أن يكون لكل بث اسم مختلف.\n\n🛑 لم يتم تشغيل أي بث.", mainKeyboard());
        return;
    }
    for (const item of checkedStreams) {
        if (streams[item.name]) {
            await bot.sendMessage(chatId, `❌ البث "${item.name}" يعمل بالفعل.\n\n🛑 لم يتم تشغيل GROUP.`, mainKeyboard());
            return;
        }
    }
    await bot.sendMessage(chatId, `✅ تم فحص جميع الروابط بنجاح.\n\n📊 عدد البثوث: ${checkedStreams.length}\n\n⚡ الوضع: ${QUANTUM_MODE ? "Quantum" : "Stream Copy"}\n\n🚀 سيتم الآن تشغيل جميع البثوث...`);
    const startPromises = checkedStreams.map(item => startStream(chatId, item.name, item.key, item.url, "GROUP", item.probe));
    const results = await Promise.all(startPromises);
    const started = results.filter(x => x === true).length;
    let resultText = `🚀 GROUP انتهى\n\n📊 المطلوب: ${checkedStreams.length}\n🟢 تم تشغيل: ${started}\n🔴 فشل التشغيل: ${checkedStreams.length - started}\n\n`;
    for (const item of checkedStreams) {
        if (streams[item.name]) {
            resultText += `🟢 ${item.name}\n`;
        } else {
            resultText += `🔴 ${item.name}\n`;
        }
    }
    await bot.sendMessage(chatId, resultText, mainKeyboard());
}

// ======================================================
// إيقاف بث معين
// ======================================================

async function stopStream(chatId, name) {
    name = String(name || "").trim();
    const stream = streams[name];
    if (!stream) {
        await bot.sendMessage(chatId, `❌ لا يوجد بث باسم "${name}".`, mainKeyboard());
        return;
    }
    stream.manualStop = true;
    try { stream.process.kill("SIGTERM"); } catch {}
    delete streams[name];
    await bot.sendMessage(chatId, `🛑 تم إيقاف البث "${name}".`, mainKeyboard());
}

// ======================================================
// إيقاف جميع البثوث
// ======================================================

async function stopAll(chatId) {
    const names = Object.keys(streams);
    if (names.length === 0) {
        await bot.sendMessage(chatId, "ℹ️ لا توجد بثوث تعمل حالياً.", mainKeyboard());
        return;
    }
    for (const name of names) {
        try {
            streams[name].manualStop = true;
            streams[name].process.kill("SIGTERM");
        } catch {}
        delete streams[name];
    }
    await bot.sendMessage(chatId, `🛑 تم إيقاف جميع البثوث.\n\n📊 العدد: ${names.length}`, mainKeyboard());
}

// ======================================================
// حالة جميع البثوث
// ======================================================

async function showStatus(chatId) {
    const names = Object.keys(streams);
    if (names.length === 0) {
        await bot.sendMessage(chatId, "📊 لا توجد بثوث نشطة.", mainKeyboard());
        return;
    }
    let text = `📊 البثوث النشطة: ${names.length}\n\n`;
    for (const name of names) {
        const stream = streams[name];
        const seconds = Math.floor((Date.now() - stream.startedAt) / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const time = hours > 0 ? `${hours}س ${minutes % 60}د` : `${minutes}د ${seconds % 60}ث`;
        text += `📛 ${name}\n🔑 ${maskKey(stream.key)}\n🟢 ${stream.status}\n⏱ ${time}\n📡 ${stream.type}\n⚡ ${QUANTUM_MODE ? "Quantum" : "Stream Copy"}\n🔄 MP4 Loop: ${stream.isMp4 ? "نعم" : "لا"}\n\n`;
    }
    await bot.sendMessage(chatId, text, mainKeyboard());
}

// ======================================================
// حالة بث معين
// ======================================================

async function showStreamStatus(chatId, name) {
    name = String(name || "").trim();
    const stream = streams[name];
    if (!stream) {
        await bot.sendMessage(chatId, `❌ البث "${name}" غير موجود أو متوقف.`, mainKeyboard());
        return;
    }
    const seconds = Math.floor((Date.now() - stream.startedAt) / 1000);
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
        `⚡ الوضع: ${QUANTUM_MODE ? "Quantum" : "Stream Copy"}\n` +
        `🔄 MP4 Loop: ${stream.isMp4 ? "نعم" : "لا"}\n\n` +
        `🔗 المصدر:\n${stream.url}`,
        mainKeyboard()
    );
}

// ======================================================
// القائمة الرئيسية
// ======================================================

function sendMenu(chatId) {
    return bot.sendMessage(chatId, "🤖 DARK STREAM BOT\n\nاختر من الأزرار الموجودة أسفل الشاشة:", mainKeyboard());
}

// ======================================================
// استقبال الرسائل
// ======================================================

bot.on("message", async msg => {
    try {
        if (!msg.text) return;
        const chatId = msg.chat.id;
        const userId = msg.from?.id;
        if (!userId) return;
        const text = msg.text.trim();

        if (text === "/start") {
            delete sessions[userId];
            return sendMenu(chatId);
        }
        if (text === "🎯 SOLO" || text === "/solo") {
            sessions[userId] = { type: "solo", step: "name" };
            return bot.sendMessage(chatId, "1️⃣ أرسل اسم البث:");
        }
        if (text === "🔥 GROUP" || text === "/group") {
            sessions[userId] = { type: "group", step: "count", streams: [] };
            return bot.sendMessage(chatId, "👥 كم عدد البثوث التي تريد تشغيلها؟\n\nمثال: 3");
        }
        if (text === "🛑 STOP" || text === "/stop") {
            sessions[userId] = { type: "stop", step: "name" };
            return bot.sendMessage(chatId, "🛑 أرسل اسم البث الذي تريد إيقافه:", stopKeyboard());
        }
        if (text === "⛔ إيقاف جميع البثوث" || text === "/stopall") {
            return stopAll(chatId);
        }
        if (text === "📊 الحالة" || text === "/status") {
            return showStatus(chatId);
        }
        if (text === "🔍 فحص الرابط" || text === "/check") {
            sessions[userId] = { type: "check", step: "url" };
            return bot.sendMessage(chatId, "🌐 أرسل رابط المصدر لفحصه:");
        }
        if (text === "📊 حالة بث معين" || text === "/streamstatus") {
            sessions[userId] = { type: "streamstatus", step: "name" };
            return bot.sendMessage(chatId, "📊 أرسل اسم البث:");
        }
        if (text === "🛑 إيقاف بث معين") {
            sessions[userId] = { type: "stop", step: "name" };
            return bot.sendMessage(chatId, "🛑 أرسل اسم البث:");
        }
        if (text === "↩️ رجوع") {
            delete sessions[userId];
            return sendMenu(chatId);
        }
        if (!sessions[userId]) {
            return bot.sendMessage(chatId, "❓ استخدم /start لعرض الأزرار.", mainKeyboard());
        }

        const session = sessions[userId];

        if (session.type === "solo") {
            if (session.step === "name") {
                session.name = text;
                session.step = "key";
                return bot.sendMessage(chatId, "2️⃣ أرسل مفتاح Facebook:");
            }
            if (session.step === "key") {
                session.key = text;
                session.step = "url";
                return bot.sendMessage(chatId, "3️⃣ أرسل رابط المصدر:");
            }
            if (session.step === "url") {
                const name = session.name;
                const key = session.key;
                delete sessions[userId];
                await startStream(chatId, name, key, text, "SOLO");
                return;
            }
        }

        if (session.type === "group") {
            if (session.step === "count") {
                const count = Number(text);
                if (!Number.isInteger(count) || count < 1 || count > 50) {
                    return bot.sendMessage(chatId, "❌ أرسل رقماً من 1 إلى 50.");
                }
                session.count = count;
                session.current = 1;
                session.step = "name";
                return bot.sendMessage(chatId, `👥 تم تحديد ${count} بث.\n\n📡 البث 1 من ${count}\n\nأرسل اسم البث:`);
            }
            if (session.step === "name") {
                session.currentName = text;
                session.step = "key";
                return bot.sendMessage(chatId, `🔑 البث ${session.current} من ${session.count}\n\nأرسل مفتاح Facebook:`);
            }
            if (session.step === "key") {
                session.currentKey = text;
                session.step = "url";
                return bot.sendMessage(chatId, `🌐 البث ${session.current} من ${session.count}\n\nأرسل رابط المصدر:`);
            }
            if (session.step === "url") {
                session.streams.push({ name: session.currentName, key: session.currentKey, url: text });
                if (session.current < session.count) {
                    session.current++;
                    session.step = "name";
                    return bot.sendMessage(chatId, `📡 البث ${session.current} من ${session.count}\n\nأرسل اسم البث:`);
                }
                const groupStreams = [...session.streams];
                delete sessions[userId];
                await startGroupStreams(chatId, groupStreams);
                return;
            }
        }

        if (session.type === "stop") {
            if (session.step === "name") {
                delete sessions[userId];
                return stopStream(chatId, text);
            }
        }

        if (session.type === "check") {
            if (session.step === "url") {
                delete sessions[userId];
                return checkUrl(chatId, text);
            }
        }

        if (session.type === "streamstatus") {
            if (session.step === "name") {
                delete sessions[userId];
                return showStreamStatus(chatId, text);
            }
        }
    } catch (error) {
        console.error("BOT ERROR:", error);
        try {
            await bot.sendMessage(msg.chat.id, "❌ حدث خطأ:\n\n" + error.message, mainKeyboard());
        } catch {}
    }
});

// ======================================================
// أخطاء Telegram
// ======================================================

bot.on("polling_error", error => {
    console.error("Telegram polling error:", error?.message || error);
});

// ======================================================
// إيقاف آمن
// ======================================================

function shutdown() {
    console.log("🛑 إيقاف البوت...");
    for (const name of Object.keys(streams)) {
        try {
            streams[name].manualStop = true;
            streams[name].process.kill("SIGTERM");
        } catch {}
    }
    process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
