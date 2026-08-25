import asyncio
import json
import random
import re
import string
import subprocess
import threading
import time
from datetime import datetime
from typing import Any, Dict, Optional

from telegram import ReplyKeyboardMarkup, Update
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

# =====================================================
# ضع توكن Telegram Bot هنا
# =====================================================
BOT_TOKEN = "8938418856:AAHmkAy9CWRzuHmZc4b5bUmqSSZUGSbwUN4"

# Facebook RTMP
FACEBOOK_RTMP = "rtmps://live-api-s.facebook.com:443/rtmp/"

# =====================================================
# تخزين البثوث وحالات المستخدمين
# =====================================================
streams: Dict[str, Dict[str, Any]] = {}
users: Dict[int, Dict[str, Any]] = {}
lock = threading.RLock()

# =====================================================
# القوائم
# =====================================================
def main_keyboard():
    return ReplyKeyboardMarkup(
        [
            ["🎯 SOLO"],
            ["🔥 GROUP"],
            ["🛑 STOP"],
            ["📊 الحالة"],
            ["🔍 فحص الرابط"],
        ],
        resize_keyboard=True,
    )


def stop_keyboard():
    return ReplyKeyboardMarkup(
        [
            ["🛑 إيقاف بث معين"],
            ["⛔ إيقاف جميع البثوث"],
            ["↩️ رجوع"],
        ],
        resize_keyboard=True,
    )


# =====================================================
# أدوات مساعدة
# =====================================================
def make_id() -> str:
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
    return f"{int(time.time() * 1000)}_{suffix}"


def mask_key(key: str) -> str:
    if not key:
        return "غير معروف"
    if len(key) <= 8:
        return "********"
    return key[:3] + "***" + key[-4:]


def get_streams_for_user(chat_id: int):
    with lock:
        return [
            stream
            for stream in streams.values()
            if str(stream["chat_id"]) == str(chat_id)
        ]


# =====================================================
# إرسال رسالة من أي Thread
# =====================================================
def send_message_sync(application: Application, chat_id: int, text: str):
    """
    يرسل رسالة من Thread خاص بـ FFmpeg إلى حلقة asyncio الرئيسية.
    """
    try:
        future = asyncio.run_coroutine_threadsafe(
            application.bot.send_message(chat_id=chat_id, text=text),
            application.bot_data["_loop"],
        )
        future.result(timeout=30)
    except Exception as exc:
        print(f"Telegram send error: {exc}")


# =====================================================
# فحص الرابط بواسطة FFprobe
# =====================================================
def probe_url(url: str) -> Dict[str, Any]:
    command = [
        "ffprobe",
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
        url,
    ]

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=20,
            errors="replace",
        )
    except FileNotFoundError:
        return {
            "ok": False,
            "error": "FFprobe غير مثبت على السيرفر. ثبّت FFmpeg/FFprobe أولاً.",
        }
    except subprocess.TimeoutExpired:
        return {
            "ok": False,
            "error": "انتهت مهلة فحص الرابط.",
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}

    if result.returncode != 0:
        error = (result.stderr or "").strip()[:1000]
        return {
            "ok": False,
            "error": error or "الرابط غير صالح أو غير قابل للوصول.",
        }

    try:
        data = json.loads(result.stdout)
        streams_found = data.get("streams", [])

        video = next(
            (x for x in streams_found if x.get("codec_type") == "video"),
            None,
        )
        audio = next(
            (x for x in streams_found if x.get("codec_type") == "audio"),
            None,
        )

        fmt = data.get("format", {})
        format_name = fmt.get("format_name")

        duration = fmt.get("duration")
        if duration:
            try:
                seconds = int(float(duration))
                h = seconds // 3600
                m = (seconds % 3600) // 60
                s = seconds % 60
                duration = f"{h:02d}:{m:02d}:{s:02d}"
            except Exception:
                duration = "مباشر"
        else:
            duration = "مباشر"

        return {
            "ok": True,
            "video": (video or {}).get("codec_name", "غير معروف"),
            "audio": (audio or {}).get("codec_name", "غير موجود"),
            "format": format_name or "غير معروف",
            "duration": duration,
        }

    except Exception:
        return {
            "ok": False,
            "error": "تعذر قراءة نتيجة FFprobe.",
        }


# =====================================================
# بناء أمر FFmpeg
# =====================================================
def build_ffmpeg_args(url: str, output: str):
    is_mp4 = bool(re.search(r"\.mp4(\?|$)", url, re.IGNORECASE))

    if is_mp4:
        args = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "warning",
            "-re",
            "-stream_loop",
            "-1",
            "-i",
            url,
        ]
    else:
        args = [
            "ffmpeg",
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
            url,
        ]

    args += [
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
        output,
    ]

    return args, is_mp4


# =====================================================
# مراقبة FFmpeg
# =====================================================
def monitor_ffmpeg(application: Application, stream_id: str):
    with lock:
        stream = streams.get(stream_id)

    if not stream:
        return

    process = stream["process"]
    name = stream["name"]

    try:
        while True:
            line = process.stderr.readline()

            if not line:
                break

            line = line.strip()
            if line:
                print(f"[{name}] {line}")

    except Exception as exc:
        print(f"[{name}] FFmpeg monitor error: {exc}")

    code = process.wait()

    with lock:
        stream = streams.get(stream_id)
        if not stream:
            return

        manual_stop = bool(stream.get("manual_stop"))
        stream["status"] = "متوقف"

        streams.pop(stream_id, None)

    print(f"[{name}] FFmpeg stopped: {code}")

    if not manual_stop:
        send_message_sync(
            application,
            stream["chat_id"],
            f"🔴 توقف البث:\n\n"
            f"📺 {name}\n\n"
            f"رمز FFmpeg: {code}",
        )


# =====================================================
# تشغيل بث
# =====================================================
async def start_stream_from_data(
    application: Application,
    chat_id: int,
    name: str,
    key: str,
    url: str,
    stream_type: str,
) -> bool:

    if not name or not key or not url:
        await application.bot.send_message(
            chat_id=chat_id,
            text="❌ البيانات ناقصة.",
        )
        return False

    await application.bot.send_message(
        chat_id=chat_id,
        text=f"🔍 جاري فحص الرابط بواسطة FFprobe...\n\n📺 {name}",
    )

    probe = await asyncio.to_thread(probe_url, url)

    if not probe["ok"]:
        await application.bot.send_message(
            chat_id=chat_id,
            text=(
                f"❌ فشل فحص البث:\n\n"
                f"📺 {name}\n\n"
                f"{probe.get('error') or 'الرابط غير صالح.'}"
            ),
        )
        return False

    stream_id = make_id()
    output = FACEBOOK_RTMP + key

    args, is_mp4 = build_ffmpeg_args(url, output)

    print(f"🚀 Starting stream: {name}")
    print("FFmpeg command started.")

    try:
        process = subprocess.Popen(
            args,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
    except FileNotFoundError:
        await application.bot.send_message(
            chat_id=chat_id,
            text="❌ FFmpeg غير مثبت على السيرفر.",
        )
        return False
    except Exception as exc:
        await application.bot.send_message(
            chat_id=chat_id,
            text=f"❌ تعذر تشغيل FFmpeg:\n\n{exc}",
        )
        return False

    stream = {
        "id": stream_id,
        "chat_id": chat_id,
        "name": name,
        "key": key,
        "url": url,
        "type": stream_type,
        "process": process,
        "started_at": datetime.now(),
        "status": "يعمل",
        "is_mp4": is_mp4,
        "manual_stop": False,
    }

    with lock:
        streams[stream_id] = stream

    thread = threading.Thread(
        target=monitor_ffmpeg,
        args=(application, stream_id),
        daemon=True,
    )
    thread.start()

    await application.bot.send_message(
        chat_id=chat_id,
        text=(
            f"✅ تم تشغيل البث\n\n"
            f"📺 الاسم:\n{name}\n\n"
            f"🔑 المفتاح:\n{mask_key(key)}\n\n"
            f"🔗 الرابط:\n{url}\n\n"
            f"📡 النوع:\n{stream_type}\n\n"
            f"🔄 تكرار MP4:\n{'مفعّل ✅' if is_mp4 else 'غير مطلوب'}\n\n"
            f"🟢 الحالة:\nيعمل"
        ),
        reply_markup=main_keyboard(),
    )

    return True


# =====================================================
# إيقاف بث
# =====================================================
def stop_stream(stream_id: str) -> bool:
    with lock:
        stream = streams.get(stream_id)

    if not stream:
        return False

    stream["manual_stop"] = True
    stream["status"] = "متوقف"

    process = stream["process"]

    try:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
    except Exception:
        pass

    with lock:
        streams.pop(stream_id, None)

    return True


# =====================================================
# الحالة
# =====================================================
async def send_status(application: Application, chat_id: int):
    list_streams = get_streams_for_user(chat_id)

    if not list_streams:
        await application.bot.send_message(
            chat_id=chat_id,
            text="📺 البثوث:\n\nلا توجد بثوث نشطة.",
            reply_markup=main_keyboard(),
        )
        return

    text = "📺 البثوث النشطة:\n\n"

    for index, stream in enumerate(list_streams):
        text += (
            f"{index + 1}️⃣ {stream['name']}\n"
            f"   🔑 {mask_key(stream['key'])}\n"
            f"   📡 {stream['type']}\n"
            f"   🟢 {stream['status']}\n"
            f"   🔄 MP4: {'نعم' if stream['is_mp4'] else 'لا'}\n\n"
        )

    await application.bot.send_message(
        chat_id=chat_id,
        text=text,
        reply_markup=main_keyboard(),
    )


# =====================================================
# /start
# =====================================================
async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id

    with lock:
        users.pop(chat_id, None)

    await update.message.reply_text(
        "👋 مرحباً\n\n"
        "🎯 SOLO\n"
        "تشغيل بث واحد.\n\n"
        "🔥 GROUP\n"
        "تشغيل عدة بثوث في نفس الوقت.\n\n"
        "🛑 STOP\n"
        "إيقاف بث معين أو جميع البثوث.\n\n"
        "📊 الحالة\n"
        "عرض حالة جميع البثوث.\n\n"
        "🔍 فحص الرابط\n"
        "فحص رابط البث بواسطة FFprobe.",
        reply_markup=main_keyboard(),
    )


# =====================================================
# معالجة الرسائل
# =====================================================
async def message_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.message or not update.message.text:
        return

    chat_id = update.effective_chat.id
    text = update.message.text.strip()

    if text == "/start":
        return

    # =================================================
    # SOLO
    # =================================================
    if text == "🎯 SOLO":
        users[chat_id] = {
            "action": "solo",
            "step": "name",
        }
        await update.message.reply_text("🎯 SOLO\n\n📺 اسم البث؟")
        return

    # =================================================
    # GROUP
    # =================================================
    if text == "🔥 GROUP":
        users[chat_id] = {
            "action": "group",
            "step": "count",
        }
        await update.message.reply_text(
            "🔥 GROUP\n\n🔢 كم عدد البثوث التي تريد تشغيلها؟"
        )
        return

    # =================================================
    # STOP
    # =================================================
    if text == "🛑 STOP":
        await update.message.reply_text(
            "🛑 اختر:",
            reply_markup=stop_keyboard(),
        )
        return

    # =================================================
    # إيقاف بث معين
    # =================================================
    if text == "🛑 إيقاف بث معين":
        list_streams = get_streams_for_user(chat_id)

        if not list_streams:
            await update.message.reply_text("📊 لا توجد بثوث نشطة.")
            return

        message = "🛑 اختر رقم البث لإيقافه:\n\n"

        for index, stream in enumerate(list_streams):
            message += f"{index + 1}️⃣ {stream['name']}\n"

        users[chat_id] = {
            "action": "stop",
            "step": "number",
            "list": list_streams,
        }

        await update.message.reply_text(message)
        return

    # =================================================
    # إيقاف الكل
    # =================================================
    if text == "⛔ إيقاف جميع البثوث":
        list_streams = get_streams_for_user(chat_id)

        if not list_streams:
            await update.message.reply_text("📊 لا توجد بثوث نشطة.")
            return

        for stream in list_streams:
            stop_stream(stream["id"])

        await update.message.reply_text(
            f"⛔ تم إيقاف جميع البثوث.\n\nعدد البثوث: {len(list_streams)}",
            reply_markup=main_keyboard(),
        )
        return

    # =================================================
    # الحالة
    # =================================================
    if text == "📊 الحالة":
        await send_status(context.application, chat_id)
        return

    # =================================================
    # فحص الرابط
    # =================================================
    if text == "🔍 فحص الرابط":
        users[chat_id] = {
            "action": "check",
            "step": "url",
        }
        await update.message.reply_text("🔍 أرسل رابط البث لفحصه:")
        return

    # =================================================
    # رجوع
    # =================================================
    if text == "↩️ رجوع":
        users.pop(chat_id, None)
        await update.message.reply_text(
            "🏠 القائمة الرئيسية",
            reply_markup=main_keyboard(),
        )
        return

    # =================================================
    # معالجة الحالة
    # =================================================
    state = users.get(chat_id)

    if not state:
        return

    # =================================================
    # SOLO
    # =================================================
    if state["action"] == "solo":

        if state["step"] == "name":
            state["name"] = text
            state["step"] = "key"

            await update.message.reply_text(
                f"📺 الاسم: {state['name']}\n\n"
                "🔑 أرسل مفتاح Facebook:"
            )
            return

        if state["step"] == "key":
            state["key"] = text
            state["step"] = "url"

            await update.message.reply_text("🔗 أرسل رابط البث:")
            return

        if state["step"] == "url":
            state["url"] = text

            users.pop(chat_id, None)

            await start_stream_from_data(
                context.application,
                chat_id,
                state["name"],
                state["key"],
                state["url"],
                "SOLO",
            )
            return

    # =================================================
    # GROUP
    # =================================================
    if state["action"] == "group":

        if state["step"] == "count":
            try:
                count = int(text)
            except ValueError:
                count = 0

            if count < 1 or count > 50:
                await update.message.reply_text(
                    "❌ أرسل عددًا بين 1 و50."
                )
                return

            state["count"] = count
            state["current"] = 1
            state["items"] = []
            state["step"] = "name"

            await update.message.reply_text(
                f"🔥 GROUP\n\n"
                f"📺 البث 1 من {count}\n\n"
                "📛 اسم البث؟"
            )
            return

        if state["step"] == "name":
            state["name"] = text
            state["step"] = "key"

            await update.message.reply_text(
                "🔑 أرسل مفتاح Facebook:"
            )
            return

        if state["step"] == "key":
            state["key"] = text
            state["step"] = "url"

            await update.message.reply_text("🔗 أرسل رابط البث:")
            return

        if state["step"] == "url":
            state["items"].append(
                {
                    "name": state["name"],
                    "key": state["key"],
                    "url": text,
                }
            )

            if state["current"] < state["count"]:
                state["current"] += 1
                state["step"] = "name"

                await update.message.reply_text(
                    f"🔥 GROUP\n\n"
                    f"📺 البث {state['current']} من {state['count']}\n\n"
                    "📛 اسم البث؟"
                )
                return

            items = state["items"]
            users.pop(chat_id, None)

            await update.message.reply_text(
                f"🔥 تم إدخال {len(items)} بثوث.\n\n"
                "🔍 جاري فحص الروابط..."
            )

            started = 0

            for item in items:
                result = await start_stream_from_data(
                    context.application,
                    chat_id,
                    item["name"],
                    item["key"],
                    item["url"],
                    "GROUP",
                )
                if result:
                    started += 1

            return

    # =================================================
    # STOP
    # =================================================
    if state["action"] == "stop":

        if state["step"] == "number":
            try:
                number = int(text)
            except ValueError:
                number = 0

            if number < 1 or number > len(state["list"]):
                await update.message.reply_text("❌ رقم غير صحيح.")
                return

            stream = state["list"][number - 1]

            stop_stream(stream["id"])
            users.pop(chat_id, None)

            await update.message.reply_text(
                f"🛑 تم إيقاف البث:\n\n"
                f"📺 {stream['name']}\n\n"
                f"🔑 {mask_key(stream['key'])}",
                reply_markup=main_keyboard(),
            )
            return

    # =================================================
    # CHECK
    # =================================================
    if state["action"] == "check":

        if state["step"] == "url":
            users.pop(chat_id, None)

            await update.message.reply_text(
                "🔍 جاري فحص الرابط بواسطة FFprobe..."
            )

            result = await asyncio.to_thread(probe_url, text)

            if not result["ok"]:
                await update.message.reply_text(
                    f"❌ فشل فحص الرابط.\n\n"
                    f"{result.get('error') or 'الرابط غير صالح أو غير قابل للوصول.'}",
                    reply_markup=main_keyboard(),
                )
                return

            await update.message.reply_text(
                f"✅ الرابط يعمل\n\n"
                f"🌐 الرابط:\n{text}\n\n"
                f"🎥 الفيديو:\n{result.get('video', 'غير معروف')}\n\n"
                f"🔊 الصوت:\n{result.get('audio', 'غير موجود')}\n\n"
                f"⏱ المدة:\n{result.get('duration', 'مباشر')}\n\n"
                f"📡 المصدر:\n{result.get('format', 'غير معروف')}",
                reply_markup=main_keyboard(),
            )
            return


# =====================================================
# أخطاء Telegram
# =====================================================
async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE):
    print(f"Telegram error: {context.error}")


# =====================================================
# تشغيل البوت
# =====================================================
def main():
    if not BOT_TOKEN or BOT_TOKEN == "ضع_توكن_البوت_هنا":
        print("❌ ضع توكن Telegram في BOT_TOKEN داخل app.py")
        raise SystemExit(1)

    application = Application.builder().token(BOT_TOKEN).build()

    # حفظ حلقة asyncio لاستخدامها مع Threads الخاصة بـ FFmpeg
    application.bot_data["_loop"] = asyncio.get_event_loop()

    application.add_handler(CommandHandler("start", start_command))
    application.add_handler(
        MessageHandler(filters.TEXT & ~filters.COMMAND, message_handler)
    )
    application.add_error_handler(error_handler)

    print("=================================")
    print("🤖 Telegram Stream Bot Started")
    print("🎯 SOLO")
    print("🔥 GROUP")
    print("🛑 STOP")
    print("📊 STATUS")
    print("🔍 FFprobe")
    print("🔄 MP4 LOOP")
    print("=================================")

    application.run_polling(
        allowed_updates=Update.ALL_TYPES,
        drop_pending_updates=True,
    )


if __name__ == "__main__":
    main()
