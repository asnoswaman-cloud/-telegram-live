import TelegramBot from 'node-telegram-bot-api';
import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import https from 'https';

// ==================================================
// 🔑 ضع توكن Telegram هنا
// ==================================================

const TOKEN = '8826608464:AAGJC_p_0uLvnMFfD-dR5HVKlY04bABOOmU';

// مثال:
// const TOKEN = '123456789:AAxxxxxxxxxxxxxxxxxxxxxxxx';

// ==================================================

if (!TOKEN || TOKEN === 'ضع_توكن_البوت_هنا') {
    console.error('❌ ضع توكن Telegram داخل TOKEN أولاً');
    process.exit(1);
}

const bot = new TelegramBot(TOKEN, {
    polling: true
});

// ==================================================
// المتغيرات
// ==================================================

const activeStreams = {};
const userPermissions = {};

const LOG_FILE = 'stream.log';

// ==================================================
// إخفاء مفتاح Facebook
// ==================================================

function maskKey(key) {
    if (!key) return 'fb-******';

    const cleanKey = key.trim();

    if (cleanKey.length <= 8) {
        return 'fb-******';
    }

    return `${cleanKey.slice(0, 4)}***${cleanKey.slice(-4)}`;
}

// ==================================================
// حساب مدة البث
// ==================================================

function formatTime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    return `${hours}س ${minutes}د ${secs}ث`;
}

// ==================================================
// تسجيل الأحداث
// ==================================================

function log(message) {
    const line =
        `[${new Date().toISOString()}] ${message}\n`;

    try {
        fs.appendFileSync(LOG_FILE, line);
    } catch (error) {
        console.error('Log error:', error.message);
    }
}

// ==================================================
// صلاحيات المستخدم
// ==================================================

function getUserPermission(userId) {
    if (!userPermissions[userId]) {
        userPermissions[userId] = {
            canStream: true,
            maxDuration: 86400
        };
    }

    return userPermissions[userId];
}

// ==================================================
// أزرار القائمة
// ==================================================

function getKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text: '🚀 Solo',
                    callback_data: 'solo'
                },
                {
                    text: '👥 Group',
                    callback_data: 'group'
                }
            ],
            [
                {
                    text: '📊 حالة البثوث',
                    callback_data: 'status'
                },
                {
                    text: '🛑 إيقاف الكل',
                    callback_data: 'stop_all'
                }
            ],
            [
                {
                    text: 'ℹ️ معلومات البوت',
                    callback_data: 'info'
                }
            ]
        ]
    };
}

// ==================================================
// القائمة الرئيسية
// ==================================================

const menuText = `
╔══════════════════════════╗
║ ⚡ DARK BOT // TELEGRAM ⚡
╚══════════════════════════╝

┏ 📂 لوحة التحكم
┃ 👑 المطور: ismail
┃ 🌐 الحالة: متصل
┗━━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 SOLO
تشغيل بث واحد:

/بث مفتاح_الفيسبوك|رابط_البث

👥 GROUP
تشغيل عدة بثوث:

/group مفتاح1|رابط1;مفتاح2|رابط2

⛔ إيقاف بث معين:

/بث ايقاف مفتاح

🛑 إيقاف جميع البثوث:

stop

📊 حالة البثوث:

/بث حالة

🔎 حالة مفتاح:

/بث حالة|مفتاح

🔍 فحص الرابط:

/بث فحص رابط

🔄 تعديل بث:

/بث تعديل مفتاح|رابط_جديد

👑 معلومات:

/بث معرفة

الصيغ:
m3u8 | mp4 | ts | mpd
`;

// ==================================================
// /start
// ==================================================

bot.onText(/^\/start$/, async (msg) => {
    await bot.sendMessage(
        msg.chat.id,
        menuText,
        {
            reply_markup: getKeyboard()
        }
    );
});

// ==================================================
// أزرار Telegram
// ==================================================

bot.on('callback_query', async (query) => {

    const chatId = query.message.chat.id;

    try {
        await bot.answerCallbackQuery(query.id);
    } catch {}

    // Solo
    if (query.data === 'solo') {

        return bot.sendMessage(
            chatId,
            `🚀 SOLO

أرسل:

/بث مفتاح_الفيسبوك|رابط_البث

مثال:

/بث KEY|https://example.com/live.m3u8`
        );
    }

    // Group
    if (query.data === 'group') {

        return bot.sendMessage(
            chatId,
            `👥 GROUP

يمكنك تشغيل عدة بثوث في نفس الوقت.

الصيغة:

/group مفتاح1|رابط1;مفتاح2|رابط2

مثال:

/group KEY1|https://site.com/1.m3u8;KEY2|https://site.com/2.m3u8`
        );
    }

    // الحالة
    if (query.data === 'status') {
        return showAllStreamsStatus(chatId);
    }

    // إيقاف الكل
    if (query.data === 'stop_all') {
        return stopAllStreams(chatId);
    }

    // المعلومات
    if (query.data === 'info') {
        return showBotInfo(chatId);
    }
});

// ==================================================
// GROUP
// ==================================================

bot.onText(/^\/group(?:\s+([\s\S]+))?$/, async (msg, match) => {

    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const permission = getUserPermission(userId);

    if (!permission.canStream) {
        return bot.sendMessage(
            chatId,
            '❌ ليس لديك صلاحية تشغيل البث.'
        );
    }

    const input = match?.[1]?.trim();

    if (!input) {
        return bot.sendMessage(
            chatId,
            `👥 GROUP

الصيغة:

/group مفتاح1|رابط1;مفتاح2|رابط2`
        );
    }

    const streams = input
        .split(';')
        .map(item => item.trim())
        .filter(Boolean);

    if (streams.length === 0) {
        return bot.sendMessage(
            chatId,
            '❌ لم يتم العثور على بثوث.'
        );
    }

    let success = 0;
    let failed = 0;

    const results = [];

    for (const item of streams) {

        const separator = item.indexOf('|');

        if (separator === -1) {
            failed++;
            results.push(`❌ صيغة خاطئة: ${item}`);
            continue;
        }

        const key =
            item.slice(0, separator).trim();

        const url =
            item.slice(separator + 1).trim();

        if (!key || !url) {
            failed++;
            results.push('❌ المفتاح أو الرابط ناقص.');
            continue;
        }

        const result =
            await startStream(
                chatId,
                userId,
                key,
                url
            );

        if (result.startsWith('✅')) {
            success++;
        } else {
            failed++;
        }

        results.push(result);
    }

    let response = `
👥 GROUP RESULT

✅ تم التشغيل: ${success}
❌ فشل: ${failed}

`;

    response += results.join('\n');

    return bot.sendMessage(
        chatId,
        response
    );
});

// ==================================================
// جميع الرسائل
// ==================================================

bot.on('message', async (msg) => {

    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = msg.text;

    if (!text) return;

    getUserPermission(userId);

    // لا نعالج start مرة أخرى
    if (text === '/start') return;

    // ==================================================
    // STOP
    // ==================================================

    if (text.trim().toLowerCase() === 'stop') {
        return stopAllStreams(chatId);
    }

    // ==================================================
    // أوامر /بث
    // ==================================================

    if (!text.startsWith('/بث')) return;

    const args =
        text.replace('/بث', '').trim();

    try {

        // القائمة
        if (args === '') {

            return bot.sendMessage(
                chatId,
                menuText,
                {
                    reply_markup: getKeyboard()
                }
            );
        }

        // الحالة
        if (args === 'حالة') {
            return showAllStreamsStatus(chatId);
        }

        // المعلومات
        if (args === 'معرفة') {
            return showBotInfo(chatId);
        }

        // فحص الرابط
        if (args.startsWith('فحص ')) {

            const url =
                args.replace('فحص ', '').trim();

            return checkStreamUrl(
                chatId,
                url
            );
        }

        // إيقاف بث معين
        if (args.startsWith('ايقاف ')) {

            const key =
                args.replace('ايقاف ', '').trim();

            return stopStreamByKey(
                chatId,
                key
            );
        }

        // حالة مفتاح
        if (args.startsWith('حالة|')) {

            const key =
                args.replace('حالة|', '').trim();

            return checkStreamStatusByKey(
                chatId,
                key
            );
        }

        // تعديل بث
        if (args.startsWith('تعديل ')) {

            const data =
                args.replace('تعديل ', '').trim();

            return updateActiveStream(
                chatId,
                userId,
                data
            );
        }

        // ==================================================
        // تشغيل Solo
        // ==================================================

        if (args.includes('|')) {

            const separator =
                args.indexOf('|');

            const facebookKey =
                args.slice(0, separator).trim();

            const streamUrl =
                args.slice(separator + 1).trim();

            if (!facebookKey || !streamUrl) {

                return bot.sendMessage(
                    chatId,
                    '❌ المفتاح أو الرابط ناقص.'
                );
            }

            const result =
                await startStream(
                    chatId,
                    userId,
                    facebookKey,
                    streamUrl
                );

            return bot.sendMessage(
                chatId,
                result
            );
        }

    } catch (error) {

        console.error(error);

        return bot.sendMessage(
            chatId,
            `❌ حدث خطأ:\n${error.message}`
        );
    }
});

// ==================================================
// تشغيل بث
// ==================================================

async function startStream(
    chatId,
    userId,
    facebookKey,
    streamUrl
) {

    const key =
        facebookKey.trim();

    const url =
        streamUrl.trim();

    if (!key || !url) {
        return '❌ المفتاح أو الرابط غير صحيح.';
    }

    if (activeStreams[key]) {

        return `⚠️ البث ${maskKey(key)} يعمل بالفعل.`;
    }

    const permission =
        getUserPermission(userId);

    if (!permission.canStream) {
        return '❌ ليس لديك صلاحية تشغيل البث.';
    }

    // Facebook RTMPS
    const rtmpTarget =
        `rtmps://live-api-s.facebook.com:443/rtmp/${key}`;

    // معرفة MP4
    const isMp4 =
        url.toLowerCase().includes('.mp4');

    const ffmpegArgs = [];

    // تكرار MP4
    if (isMp4) {

        ffmpegArgs.push(
            '-stream_loop',
            '-1'
        );
    }

    ffmpegArgs.push(
        '-re',
        '-nostdin',

        '-i',
        url,

        '-c:v',
        'copy',

        '-c:a',
        'aac',

        '-b:a',
        '128k',

        '-f',
        'flv',

        rtmpTarget
    );

    log(
        `START ${maskKey(key)} ${url}`
    );

    console.log(
        `🚀 Starting stream ${maskKey(key)}`
    );

    const process =
        spawn(
            'ffmpeg',
            ffmpegArgs,
            {
                stdio: [
                    'ignore',
                    'ignore',
                    'pipe'
                ]
            }
        );

    process.stderr.on(
        'data',
        (data) => {

            const output =
                data.toString();

            try {
                fs.appendFileSync(
                    LOG_FILE,
                    output
                );
            } catch {}

            console.log(
                `[FFMPEG] ${output.trim()}`
            );
        }
    );

    process.on(
        'error',
        (error) => {

            console.error(
                'FFmpeg error:',
                error.message
            );

            log(
                `ERROR ${maskKey(key)} ${error.message}`
            );
        }
    );

    process.on(
        'close',
        (code) => {

            console.log(
                `FFmpeg stopped: ${maskKey(key)} code=${code}`
            );

            log(
                `STOP ${maskKey(key)} code=${code}`
            );

            if (activeStreams[key]) {
                delete activeStreams[key];
            }
        }
    );

    activeStreams[key] = {

        process,

        startTime: Date.now(),

        userId,

        chatId,

        streamUrl: url,

        isMp4
    };

    return `
✅ تم تشغيل البث

🔑 المفتاح:
${maskKey(key)}

🔗 الرابط:
${url}

${isMp4
    ? '🔄 MP4: تكرار تلقائي ∞'
    : '🔄 MP4: لا'}

📡 FFmpeg يعمل الآن.
`;
}

// ==================================================
// إيقاف بث معين
// ==================================================

function stopStreamByKey(
    chatId,
    key
) {

    const cleanKey =
        key.trim();

    const stream =
        activeStreams[cleanKey];

    if (!stream) {

        return bot.sendMessage(
            chatId,
            `❌ لا يوجد بث نشط بالمفتاح:

${maskKey(cleanKey)}`
        );
    }

    try {

        stream.process.kill(
            'SIGTERM'
        );

    } catch (error) {

        console.error(error);
    }

    delete activeStreams[cleanKey];

    log(
        `MANUAL STOP ${maskKey(cleanKey)}`
    );

    return bot.sendMessage(
        chatId,
        `🛑 تم إيقاف البث

🔑 ${maskKey(cleanKey)}`
    );
}

// ==================================================
// إيقاف كل البثوث
// ==================================================

function stopAllStreams(chatId) {

    const keys =
        Object.keys(activeStreams);

    if (keys.length === 0) {

        return bot.sendMessage(
            chatId,
            '⚠️ لا توجد أي بثوث نشطة.'
        );
    }

    let count = 0;

    for (const key of keys) {

        const stream =
            activeStreams[key];

        try {

            stream.process.kill(
                'SIGTERM'
            );

            count++;

        } catch (error) {

            console.error(error);
        }

        delete activeStreams[key];
    }

    log(
        `STOP ALL count=${count}`
    );

    return bot.sendMessage(
        chatId,
        `🛑 تم إيقاف جميع البثوث

📊 العدد: ${count}`
    );
}

// ==================================================
// حالة جميع البثوث
// ==================================================

function showAllStreamsStatus(chatId) {

    const keys =
        Object.keys(activeStreams);

    if (keys.length === 0) {

        return bot.sendMessage(
            chatId,
            '📊 لا توجد بثوث نشطة حالياً.'
        );
    }

    let text =
        `📊 البثوث النشطة: ${keys.length}\n\n`;

    keys.forEach((key, index) => {

        const stream =
            activeStreams[key];

        const duration =
            formatTime(
                Date.now() - stream.startTime
            );

        text += `
${index + 1}️⃣ 🔴 LIVE

🔑 ${maskKey(key)}

⏱ ${duration}

🔗 ${stream.streamUrl}

`;
    });

    return bot.sendMessage(
        chatId,
        text
    );
}

// ==================================================
// حالة بث معين
// ==================================================

function checkStreamStatusByKey(
    chatId,
    key
) {

    const cleanKey =
        key.trim();

    const stream =
        activeStreams[cleanKey];

    if (!stream) {

        return bot.sendMessage(
            chatId,
            `❌ البث ${maskKey(cleanKey)} غير نشط.`
        );
    }

    const duration =
        formatTime(
            Date.now() - stream.startTime
        );

    return bot.sendMessage(
        chatId,
        `🔴 البث يعمل

🔑 المفتاح:
${maskKey(cleanKey)}

⏱ المدة:
${duration}

🔗 الرابط:
${stream.streamUrl}`
    );
}

// ==================================================
// فحص الرابط
// ==================================================

function checkStreamUrl(
    chatId,
    url
) {

    if (!url) {

        return bot.sendMessage(
            chatId,
            '❌ أرسل رابط البث.'
        );
    }

    let parsed;

    try {

        parsed = new URL(url);

    } catch {

        return bot.sendMessage(
            chatId,
            '❌ الرابط غير صحيح.'
        );
    }

    if (
        parsed.protocol !== 'http:' &&
        parsed.protocol !== 'https:'
    ) {

        return bot.sendMessage(
            chatId,
            '❌ الرابط يجب أن يكون HTTP أو HTTPS.'
        );
    }

    const client =
        url.startsWith('https://')
            ? https
            : http;

    const request =
        client.request(
            url,
            {
                method: 'HEAD',
                timeout: 10000
            },
            (response) => {

                const status =
                    response.statusCode;

                response.destroy();

                if (
                    status >= 200 &&
                    status < 400
                ) {

                    return bot.sendMessage(
                        chatId,
                        `✅ الرابط يعمل

HTTP: ${status}

🔗 ${url}`
                    );
                }

                return bot.sendMessage(
                    chatId,
                    `⚠️ الرابط أعاد HTTP ${status}`
                );
            }
        );

    request.on(
        'timeout',
        () => {

            request.destroy();

            bot.sendMessage(
                chatId,
                '❌ انتهت مهلة فحص الرابط.'
            );
        }
    );

    request.on(
        'error',
        (error) => {

            bot.sendMessage(
                chatId,
                `❌ فشل فحص الرابط:

${error.message}`
            );
        }
    );

    request.end();
}

// ==================================================
// تعديل بث
// ==================================================

async function updateActiveStream(
    chatId,
    userId,
    data
) {

    const separator =
        data.indexOf('|');

    if (separator === -1) {

        return bot.sendMessage(
            chatId,
            `❌ الصيغة:

/بث تعديل مفتاح|رابط_جديد`
        );
    }

    const key =
        data.slice(0, separator).trim();

    const newUrl =
        data.slice(separator + 1).trim();

    if (!key || !newUrl) {

        return bot.sendMessage(
            chatId,
            '❌ المفتاح أو الرابط ناقص.'
        );
    }

    if (!activeStreams[key]) {

        return bot.sendMessage(
            chatId,
            `❌ البث ${maskKey(key)} غير موجود.`
        );
    }

    try {

        activeStreams[key].process.kill(
            'SIGTERM'
        );

    } catch {}

    delete activeStreams[key];

    await new Promise(
        resolve => setTimeout(resolve, 1000)
    );

    const result =
        await startStream(
            chatId,
            userId,
            key,
            newUrl
        );

    return bot.sendMessage(
        chatId,
        `🔄 تم تعديل البث

${result}`
    );
}

// ==================================================
// معلومات البوت
// ==================================================

function showBotInfo(chatId) {

    const count =
        Object.keys(activeStreams).length;

    const text = `
👑 DARK BOT

⚡ الإصدار: 2.0
🤖 Telegram: متصل
📡 Facebook Live: مدعوم
🎬 FFmpeg: مدعوم

🚀 Solo: ✅
👥 Group: ✅
🛑 إيقاف بث معين: ✅
⛔ إيقاف الكل: ✅
📊 حالة البثوث: ✅
🔍 فحص الروابط: ✅
🔄 تعديل البث: ✅
🔁 تكرار MP4: ✅

🔴 البثوث الحالية:
${count}
`;

    return bot.sendMessage(
        chatId,
        text,
        {
            reply_markup: getKeyboard()
        }
    );
}

// ==================================================
// أخطاء Telegram
// ==================================================

bot.on(
    'polling_error',
    (error) => {

        console.error(
            '❌ Telegram polling error:',
            error.message
        );
    }
);

// ==================================================
// تشغيل البوت
// ==================================================

console.log('🤖 DARK BOT Telegram شغال...');
