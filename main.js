import TelegramBot from 'node-telegram-bot-api';
import { spawn } from 'child_process';
import fs from 'fs';

const TOKEN = '8826608464:AAGJC_p_0uLvnMFfD-dR5HVKlY04bABOOmU' @BotFather
const bot = new TelegramBot(TOKEN, { polling: true });

const activeStreams = {};
const userPermissions = {};

// إخفاء المفتاح
function maskKey(key) {
    if (!key || key.length <= 6) return 'fb-******';
    const cleanKey = key.trim();
    return `${cleanKey.slice(0, 5)}***${cleanKey.slice(-4)}`;
}

// القائمة الرئيسية
const menuText =
`╔═══════════════════╗
║ ⚡ *DARK BOT // TELEGRAM* ⚡ ║
╚═══════════════════════════╝

┏ 📂 *لوحة التحكم:*
┃ 👑 *المطور:* ismail
┃ 🌐 *الحالة:* متصل
┗━━━━━━━━━━━━━━━━━━━┛

*✨ قائمة الأوامر:*
🚀 *1. تشغيل بث:*
\`/بث مفتاح_البث|رابط_البث\`

🔄 *2. تعديل بث:*
\`/بث تعديل مفتاح|رابط_جديد\`

🔍 *3. فحص الرابط:*
\`/بث فحص الرابط\`

⛔ *4. إيقاف بث:*
\`/بث ايقاف مفتاح\`

📊 *5. حالة البثوث:*
\`/بث حالة\`

📊 *6. حالة مفتاح:*
\`/بث حالة|مفتاح\`

👑 *7. معلومات:*
\`/بث معرفة\`

🛑 *8. إيقاف الكل:*
\`stop\`

*الصيغ المدعومة:* \`m3u8\` | \`mp4\` | \`ts\` | \`mpd\``;

// الاستماع للأوامر
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;

    if (!text) return;

    if (!userPermissions[userId]) {
        userPermissions[userId] = { canStream: true, maxDuration: 86400 };
    }

    if (text === '/start') {
        return bot.sendMessage(chatId, menuText, { parse_mode: 'Markdown' });
    }

    if (text.trim() === 'stop') {
        const keys = Object.keys(activeStreams);
        if (keys.length === 0) return bot.sendMessage(chatId, '⚠️ *Dark Bot* ┃ لا توجد أي بثوث نشطة', { parse_mode: 'Markdown' });
        keys.forEach(key => { activeStreams[key].process.kill('SIGTERM'); delete activeStreams[key]; });
        return bot.sendMessage(chatId, '🛑 *Dark Bot* ┃ تم إيقاف جميع البثوث', { parse_mode: 'Markdown' });
    }

    if (!text.startsWith('/بث')) return;

    const args = text.replace('/بث', '').trim();

    try {
        if (args === 'حالة') return showAllStreamsStatus(chatId);
        if (args === 'معرفة') return showBotInfo(chatId);
        if (args.startsWith('فحص ')) return checkStreamUrl(chatId, args.replace('فحص ', ''));
        if (args.startsWith('ايقاف ')) return stopStreamByKey(chatId, userId, args.replace('ايقاف ', ''));
        if (args.startsWith('حالة|')) return checkStreamStatusByKey(chatId, args.replace('حالة|', ''));
        if (args.startsWith('تعديل ')) return updateActiveStream(chatId, userId, args.replace('تعديل ', ''));
        if (args.includes('|')) {
            const [facebookKey, streamUrl] = args.split('|').map(i => i.trim());
            const result = await startFastStream(chatId, userId, facebookKey, streamUrl);
            return bot.sendMessage(chatId, result, { parse_mode: 'Markdown' });
        }
        if (args === '') return bot.sendMessage(chatId, menuText, { parse_mode: 'Markdown' });

    } catch (e) {
        bot.sendMessage(chatId, `❌ *Dark Bot* ┃ خطأ: ${e.message}`, { parse_mode: 'Markdown' });
    }
});

// باقي الدوال نفس المنطق ديال الواتساب
async function startFastStream(chatId, userId, facebookKey, streamUrl) {
    const cleanKey = facebookKey.trim();
    if (activeStreams[cleanKey]) return `⚠️ البث [${maskKey(cleanKey)}] يعمل بالفعل.`;

    const rtmpTarget = `rtmps://live-api-s.facebook.com:443/rtmp/${cleanKey}`;
    const isMp4 = streamUrl.toLowerCase().includes('.mp4');
    const ffmpegArgs = isMp4? ['-stream_loop', '-1'] : [];
    ffmpegArgs.push("-re", "-nostdin", "-i", streamUrl, "-c:v", "copy", "-c:a", "copy", "-f", "flv", rtmpTarget);

    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, { detached: true });
    ffmpegProcess.stderr.on('data', (data) => fs.appendFileSync('stream.log', data.toString()));
    ffmpegProcess.on('close', () => delete activeStreams[cleanKey]);

    activeStreams[cleanKey] = { process: ffmpegProcess, startTime: Date.now(), userId };
    return `✅ تم تشغيل البث بالمفتاح: \`${maskKey(cleanKey)}\`${isMp4? ' (تكرار ∞)' : ''}`;
}

//... باقي الدوال: stopStreamByKey, checkStreamUrl, showAllStreamsStatus...
// نفسهم بالضبط غير بدل conn.sendMessage بـ bot.sendMessage

function showBotInfo(chatId) {
    const info = `👑 *المطور:* ismail \n⚡ *الإصدار:* 1.0 Telegram\n🌟 *مميزات:* بث مباشر + فحص روابط + تكرار mp4`;
    bot.sendMessage(chatId, info, { parse_mode: 'Markdown' });
}

console.log('🤖 Dark Bot Telegram شغال...');
