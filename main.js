import TelegramBot from 'node-telegram-bot-api';
import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import https from 'https';

const TOKEN = '8826608464:AAGJC_p_0uLvnMFfD-dR5HVKlY04bABOOmU';

if (TOKEN === 'ضع_توكن_البوت_هنا') {
    console.error('❌ ضع توكن Telegram داخل TOKEN');
    process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

const activeStreams = {};
const sessions = {};
const LOG_FILE = 'stream.log';

// =====================================================
// الأدوات
// =====================================================

function log(text) {
    try {
        fs.appendFileSync(
            LOG_FILE,
            `[${new Date().toISOString()}] ${text}\n`
        );
    } catch {}
}

function maskKey(key) {
    if (!key || key.length <= 8) return '******';

    return (
        key.slice(0, 4) +
        '***' +
        key.slice(-4)
    );
}

function duration(startTime) {
    const seconds = Math.floor(
        (Date.now() - startTime) / 1000
    );

    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    return `${h}س ${m}د ${s}ث`;
}

// =====================================================
// القائمة الرئيسية
// =====================================================

function mainMenu() {
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
                    text: '⛔ إيقاف بث',
                    callback_data: 'stop_stream'
                },
                {
                    text: '🔑 إيقاف بالمفتاح',
                    callback_data: 'stop_key'
                }
            ],
            [
                {
                    text: '📊 حالة البثوث',
                    callback_data: 'status_all'
                },
                {
                    text: '🔎 حالة بث',
                    callback_data: 'status_key'
                }
            ],
            [
                {
                    text: '🌐 فحص الرابط',
                    callback_data: 'check_url'
                }
            ],
            [
                {
                    text: '🛑 إيقاف الكل',
                    callback_data: 'stop_all'
                },
                {
                    text: 'ℹ️ معلومات',
                    callback_data: 'info'
                }
            ]
        ]
    };
}

// =====================================================
// START
// =====================================================

bot.onText(/^\/start$/, async (msg) => {

    delete sessions[msg.from.id];

    await bot.sendMessage(
        msg.chat.id,
        `
⚡ *DARK STREAM BOT*

مرحبًا 👋

اختر العملية:

🚀 *Solo*
تشغيل بث واحد.

👥 *Group*
تشغيل عدة بثوث معًا.

⛔ *إيقاف بث*
إيقاف بث معين.

🔑 *إيقاف بالمفتاح*
إيقاف باستخدام مفتاح Facebook.

📊 *حالة البثوث*
عرض جميع البثوث.

🔎 *حالة بث*
عرض حالة مفتاح معين.

🌐 *فحص الرابط*
فحص رابط البث.

🔁 *MP4*
تكرار تلقائي.
`,
        {
            parse_mode: 'Markdown',
            reply_markup: mainMenu()
        }
    );
});

// =====================================================
// الأزرار
// =====================================================

bot.on('callback_query', async (query) => {

    const chatId = query.message.chat.id;
    const userId = query.from.id;

    try {
        await bot.answerCallbackQuery(query.id);
    } catch {}

    // =================================================
    // SOLO
    // =================================================

    if (query.data === 'solo') {

        sessions[userId] = {
            type: 'solo',
            step: 'name',
            chatId
        };

        return bot.sendMessage(
            chatId,
            `
🚀 *SOLO*

📛 أرسل اسم البث:
`,
            {
                parse_mode: 'Markdown'
            }
        );
    }

    // =================================================
    // GROUP
    // =================================================

    if (query.data === 'group') {

        sessions[userId] = {
            type: 'group',
            step: 'count',
            chatId,
            count: 0,
            current: 1,
            streams: []
        };

        return bot.sendMessage(
            chatId,
            `
👥 *GROUP*

🔢 كم عدد البثوث التي تريد تشغيلها؟

مثال:

3
`,
            {
                parse_mode: 'Markdown'
            }
        );
    }

    // =================================================
    // إيقاف بث
    // =================================================

    if (query.data === 'stop_stream') {
        return showStopMenu(chatId);
    }

    // =================================================
    // إيقاف بالمفتاح
    // =================================================

    if (query.data === 'stop_key') {

        sessions[userId] = {
            type: 'stop_key',
            step: 'key',
            chatId
        };

        return bot.sendMessage(
            chatId,
            `
🔑 *إيقاف بالمفتاح*

أرسل مفتاح Facebook:
`,
            {
                parse_mode: 'Markdown'
            }
        );
    }

    // =================================================
    // حالة الكل
    // =================================================

    if (query.data === 'status_all') {
        return showAllStatus(chatId);
    }

    // =================================================
    // حالة مفتاح
    // =================================================

    if (query.data === 'status_key') {

        sessions[userId] = {
            type: 'status_key',
            step: 'key',
            chatId
        };

        return bot.sendMessage(
            chatId,
            `
🔎 *حالة بث*

أرسل مفتاح Facebook:
`,
            {
                parse_mode: 'Markdown'
            }
        );
    }

    // =================================================
    // فحص الرابط
    // =================================================

    if (query.data === 'check_url') {

        sessions[userId] = {
            type: 'check_url',
            step: 'url',
            chatId
        };

        return bot.sendMessage(
            chatId,
            `
🌐 *فحص الرابط*

أرسل رابط البث:
`,
            {
                parse_mode: 'Markdown'
            }
        );
    }

    // =================================================
    // إيقاف الكل
    // =================================================

    if (query.data === 'stop_all') {
        return stopAll(chatId);
    }

    // =================================================
    // معلومات
    // =================================================

    if (query.data === 'info') {
        return showInfo(chatId);
    }

    // =================================================
    // اختيار بث معين
    // =================================================

    if (
        query.data &&
        query.data.startsWith('stop:')
    ) {

        const id =
            query.data.substring(5);

        return stopById(chatId, id);
    }
});

// =====================================================
// الرسائل
// =====================================================

bot.on('message', async (msg) => {

    if (!msg.text) return;

    if (msg.text === '/start') return;

    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const text = msg.text.trim();

    const session = sessions[userId];

    if (!session) return;

    // =================================================
    // SOLO - الاسم
    // =================================================

    if (
        session.type === 'solo' &&
        session.step === 'name'
    ) {

        if (!text) {
            return bot.sendMessage(
                chatId,
                '❌ أرسل اسمًا صحيحًا.'
            );
        }

        session.name = text;
        session.step = 'key';

        return bot.sendMessage(
            chatId,
            `
📛 الاسم:
${text}

🔑 الآن أرسل مفتاح Facebook:
`
        );
    }

    // =================================================
    // SOLO - المفتاح
    // =================================================

    if (
        session.type === 'solo' &&
        session.step === 'key'
    ) {

        session.key = text;
        session.step = 'url';

        return bot.sendMessage(
            chatId,
            `
🔑 تم استلام المفتاح.

🔗 الآن أرسل رابط البث:
`
        );
    }

    // =================================================
    // SOLO - الرابط
    // =================================================

    if (
        session.type === 'solo' &&
        session.step === 'url'
    ) {

        const name = session.name;
        const key = session.key;
        const url = text;

        delete sessions[userId];

        const result = await startStream(
            chatId,
            userId,
            name,
            key,
            url
        );

        return bot.sendMessage(
            chatId,
            result
        );
    }

    // =================================================
    // GROUP - العدد
    // =================================================

    if (
        session.type === 'group' &&
        session.step === 'count'
    ) {

        const count = Number(text);

        if (
            !Number.isInteger(count) ||
            count < 1 ||
            count > 50
        ) {

            return bot.sendMessage(
                chatId,
                `
❌ عدد غير صحيح.

أرسل رقمًا بين 1 و50.
`
            );
        }

        session.count = count;
        session.current = 1;
        session.step = 'name';

        return bot.sendMessage(
            chatId,
            `
👥 *GROUP*

📊 عدد البثوث:
${count}

━━━━━━━━━━━━━━━━

📡 البث 1 من ${count}

📛 أرسل اسم البث:
`,
            {
                parse_mode: 'Markdown'
            }
        );
    }

    // =================================================
    // GROUP - الاسم
    // =================================================

    if (
        session.type === 'group' &&
        session.step === 'name'
    ) {

        if (!text) {
            return bot.sendMessage(
                chatId,
                '❌ أرسل اسمًا صحيحًا.'
            );
        }

        session.name = text;
        session.step = 'key';

        return bot.sendMessage(
            chatId,
            `
📡 البث ${session.current} من ${session.count}

📛 الاسم:
${text}

🔑 أرسل مفتاح Facebook:
`
        );
    }

    // =================================================
    // GROUP - المفتاح
    // =================================================

    if (
        session.type === 'group' &&
        session.step === 'key'
    ) {

        session.key = text;
        session.step = 'url';

        return bot.sendMessage(
            chatId,
            `
📡 البث ${session.current} من ${session.count}

🔑 المفتاح:
${maskKey(text)}

🔗 أرسل رابط البث:
`
        );
    }

    // =================================================
    // GROUP - الرابط
    // =================================================

    if (
        session.type === 'group' &&
        session.step === 'url'
    ) {

        const name = session.name;
        const key = session.key;
        const url = text;

        const result = await startStream(
            chatId,
            userId,
            name,
            key,
            url
        );

        session.streams.push({
            name,
            key,
            result
        });

        // إذا لم نصل للنهاية
        if (session.current < session.count) {

            session.current++;
            session.step = 'name';

            return bot.sendMessage(
                chatId,
                `
${result}

━━━━━━━━━━━━━━━━

📡 البث ${session.current} من ${session.count}

📛 أرسل اسم البث:
`
            );
        }

        // انتهى Group
        const total =
            session.streams.length;

        const successful =
            session.streams.filter(
                x => x.result.startsWith('✅')
            ).length;

        delete sessions[userId];

        return bot.sendMessage(
            chatId,
            `
👥 *GROUP اكتمل*

━━━━━━━━━━━━━━━━

📊 المطلوب:
${session.count}

✅ تم تشغيل:
${successful}

📡 مجموع العمليات:
${total}

━━━━━━━━━━━━━━━━

${session.streams
    .map((x, i) =>
        `${i + 1}. ${x.result}`
    )
    .join('\n\n')}
`,
            {
                parse_mode: 'Markdown',
                reply_markup: mainMenu()
            }
        );
    }

    // =================================================
    // إيقاف بالمفتاح
    // =================================================

    if (
        session.type === 'stop_key' &&
        session.step === 'key'
    ) {

        delete sessions[userId];

        return stopByKey(
            chatId,
            text
        );
    }

    // =================================================
    // حالة مفتاح
    // =================================================

    if (
        session.type === 'status_key' &&
        session.step === 'key'
    ) {

        delete sessions[userId];

        return statusByKey(
            chatId,
            text
        );
    }

    // =================================================
    // فحص الرابط
    // =================================================

    if (
        session.type === 'check_url' &&
        session.step === 'url'
    ) {

        delete sessions[userId];

        return checkUrl(
            chatId,
            text
        );
    }
});

// =====================================================
// تشغيل بث
// =====================================================

async function startStream(
    chatId,
    userId,
    name,
    key,
    url
) {

    name = name.trim();
    key = key.trim();
    url = url.trim();

    if (!name || !key || !url) {
        return '❌ البيانات ناقصة.';
    }

    // المفتاح مستخدم
    if (activeStreams[key]) {

        return `
⚠️ البث بهذا المفتاح يعمل بالفعل.

🔑 ${maskKey(key)}
`;
    }

    // الاسم مستخدم
    for (
        const stream of Object.values(activeStreams)
    ) {

        if (
            stream.name.toLowerCase() ===
            name.toLowerCase()
        ) {

            return `
⚠️ يوجد بث بنفس الاسم:

📛 ${name}
`;
        }
    }

    // التحقق من الرابط
    if (
        !url.startsWith('http://') &&
        !url.startsWith('https://')
    ) {

        return '❌ رابط البث يجب أن يبدأ بـ http أو https.';
    }

    const target =
        `rtmps://live-api-s.facebook.com:443/rtmp/${key}`;

    // اكتشاف MP4
    const cleanUrl =
        url.split('?')[0].toLowerCase();

    const isMp4 =
        cleanUrl.endsWith('.mp4');

    const args = [];

    // تكرار MP4
    if (isMp4) {

        args.push(
            '-stream_loop',
            '-1'
        );
    }

    args.push(
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

        target
    );

    const process =
        spawn(
            'ffmpeg',
            args,
            {
                stdio: [
                    'ignore',
                    'ignore',
                    'pipe'
                ]
            }
        );

    const id =
        `${Date.now()}_${Math.random()
            .toString(36)
            .substring(2, 8)}`;

    process.stderr.on(
        'data',
        data => {

            try {

                fs.appendFileSync(
                    LOG_FILE,
                    data.toString()
                );

            } catch {}
        }
    );

    process.on(
        'error',
        error => {

            log(
                `FFmpeg ERROR ${name}: ${error.message}`
            );
        }
    );

    process.on(
        'close',
        code => {

            log(
                `STREAM CLOSED ${name} code=${code}`
            );

            delete activeStreams[key];
        }
    );

    activeStreams[key] = {

        id,
        name,
        key,
        url,
        userId,
        chatId,
        process,
        startTime: Date.now(),
        isMp4
    };

    log(
        `STREAM STARTED ${name} ${maskKey(key)}`
    );

    return `
✅ *تم تشغيل البث*

📛 الاسم:
${name}

🔑 المفتاح:
${maskKey(key)}

🔴 الحالة:
يعمل

${
    isMp4
        ? '🔁 MP4: تكرار تلقائي ∞'
        : '🎬 المصدر: مباشر'
}
`;
}

// =====================================================
// حالة جميع البثوث
// =====================================================

function showAllStatus(chatId) {

    const streams =
        Object.values(activeStreams);

    if (streams.length === 0) {

        return bot.sendMessage(
            chatId,
            '📊 لا توجد بثوث نشطة حاليًا.'
        );
    }

    let text =
        `📊 *حالة جميع البثوث*\n\n`;

    streams.forEach(
        (stream, index) => {

            text += `
${index + 1}️⃣ 🔴 *${stream.name}*

🔑 ${maskKey(stream.key)}

⏱ ${duration(stream.startTime)}

${
    stream.isMp4
        ? '🔁 MP4 Loop: ON'
        : '🎬 Live'
}

`;
        }
    );

    return bot.sendMessage(
        chatId,
        text,
        {
            parse_mode: 'Markdown',
            reply_markup: mainMenu()
        }
    );
}

// =====================================================
// إيقاف بث من القائمة
// =====================================================

function showStopMenu(chatId) {

    const streams =
        Object.values(activeStreams);

    if (streams.length === 0) {

        return bot.sendMessage(
            chatId,
            '⛔ لا توجد بثوث نشطة.'
        );
    }

    const buttons =
        streams.map(
            stream => [
                {
                    text:
                        `⛔ ${stream.name}`,
                    callback_data:
                        `stop:${stream.id}`
                }
            ]
        );

    return bot.sendMessage(
        chatId,
        '⛔ اختر البث الذي تريد إيقافه:',
        {
            reply_markup: {
                inline_keyboard: buttons
            }
        }
    );
}

// =====================================================
// إيقاف بواسطة ID
// =====================================================

function stopById(chatId, id) {

    const stream =
        Object.values(activeStreams)
            .find(
                x => x.id === id
            );

    if (!stream) {

        return bot.sendMessage(
            chatId,
            '❌ البث غير موجود أو تم إيقافه.'
        );
    }

    try {
        stream.process.kill('SIGTERM');
    } catch {}

    delete activeStreams[stream.key];

    log(
        `STOP ${stream.name}`
    );

    return bot.sendMessage(
        chatId,
        `
🛑 *تم إيقاف البث*

📛 ${stream.name}

🔑 ${maskKey(stream.key)}
`,
        {
            parse_mode: 'Markdown',
            reply_markup: mainMenu()
        }
    );
}

// =====================================================
// إيقاف بالمفتاح
// =====================================================

function stopByKey(chatId, key) {

    const stream =
        activeStreams[key];

    if (!stream) {

        return bot.sendMessage(
            chatId,
            `
⚪ لا يوجد بث يعمل بهذا المفتاح.

🔑 ${maskKey(key)}
`
        );
    }

    try {
        stream.process.kill('SIGTERM');
    } catch {}

    delete activeStreams[key];

    log(
        `STOP BY KEY ${stream.name}`
    );

    return bot.sendMessage(
        chatId,
        `
🛑 *تم إيقاف البث*

📛 الاسم:
${stream.name}

🔑 المفتاح:
${maskKey(key)}
`,
        {
            parse_mode: 'Markdown',
            reply_markup: mainMenu()
        }
    );
}

// =====================================================
// حالة مفتاح
// =====================================================

function statusByKey(chatId, key) {

    const stream =
        activeStreams[key];

    if (!stream) {

        return bot.sendMessage(
            chatId,
            `
⚪ *البث غير نشط*

🔑 ${maskKey(key)}
`,
            {
                parse_mode: 'Markdown'
            }
        );
    }

    return bot.sendMessage(
        chatId,
        `
🔴 *البث يعمل*

📛 الاسم:
${stream.name}

🔑 المفتاح:
${maskKey(stream.key)}

⏱ المدة:
${duration(stream.startTime)}

${
    stream.isMp4
        ? '🔁 MP4 Loop: ON'
        : '🎬 Live'
}
`,
        {
            parse_mode: 'Markdown'
        }
    );
}

// =====================================================
// فحص الرابط
// =====================================================

function checkUrl(chatId, url) {

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
            response => {

                const code =
                    response.statusCode;

                response.destroy();

                if (
                    code >= 200 &&
                    code < 400
                ) {

                    return bot.sendMessage(
                        chatId,
                        `
✅ *الرابط متاح*

🌐 HTTP:
${code}

🔗 ${url}
`,
                        {
                            parse_mode: 'Markdown'
                        }
                    );
                }

                return bot.sendMessage(
                    chatId,
                    `
⚠️ الرابط ردّ بـ:

HTTP ${code}
`
                );
            }
        );

    request.on(
        'timeout',
        () => {

            request.destroy();

            bot.sendMessage(
                chatId,
                '❌ انتهت مهلة الفحص.'
            );
        }
    );

    request.on(
        'error',
        error => {

            bot.sendMessage(
                chatId,
                `
❌ فشل فحص الرابط:

${error.message}
`
            );
        }
    );

    request.end();
}

// =====================================================
// إيقاف جميع البثوث
// =====================================================

function stopAll(chatId) {

    const streams =
        Object.values(activeStreams);

    if (streams.length === 0) {

        return bot.sendMessage(
            chatId,
            '🛑 لا توجد بثوث نشطة.'
        );
    }

    let count = 0;

    for (const stream of streams) {

        try {

            stream.process.kill('SIGTERM');
            count++;

        } catch {}
    }

    for (
        const key of Object.keys(activeStreams)
    ) {

        delete activeStreams[key];
    }

    log(
        `STOP ALL ${count}`
    );

    return bot.sendMessage(
        chatId,
        `
🛑 *تم إيقاف جميع البثوث*

📊 العدد:
${count}
`,
        {
            parse_mode: 'Markdown',
            reply_markup: mainMenu()
        }
    );
}

// =====================================================
// معلومات
// =====================================================

function showInfo(chatId) {

    return bot.sendMessage(
        chatId,
        `
ℹ️ *DARK STREAM BOT*

🚀 Solo: ✅
👥 Group: ✅

⛔ إيقاف بث: ✅
🔑 إيقاف بالمفتاح: ✅

📊 حالة جميع البثوث: ✅
🔎 حالة بث معين: ✅

🌐 فحص الرابط: ✅

🔁 MP4 Loop: ✅

📡 Facebook Live
🎬 FFmpeg
`,
        {
            parse_mode: 'Markdown',
            reply_markup: mainMenu()
        }
    );
}

// =====================================================
// أخطاء Telegram
// =====================================================

bot.on(
    'polling_error',
    error => {
        console.error(
            'Telegram Error:',
            error.message
        );
    }
);

// =====================================================

console.log(
    '🤖 DARK STREAM BOT يعمل الآن...'
);
