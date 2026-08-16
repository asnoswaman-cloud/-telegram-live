import telebot
import subprocess
import time
import threading
import os
import signal

# ============================================================
# إعدادات البوت
# ============================================================

TOKEN = "8806164669:AAGwNJQDSvHOcoCzycF7zTNlSgKBfAuv81o"

bot = telebot.TeleBot(TOKEN, parse_mode="Markdown")

# ============================================================
# تخزين البثوث
# ============================================================

solo_streams = {}
groups = {}

# إعدادات مؤقتة لكل مستخدم
user_setup = {}

# قفل لحماية البيانات من Threads
data_lock = threading.Lock()


# ============================================================
# تشغيل FFmpeg
# ============================================================

def start_ffmpeg(stream_url, fb_link, fb_key):
    """
    تشغيل FFmpeg وإرسال المصدر إلى Facebook Live
    """

    full_url = fb_link.rstrip("/") + "/" + fb_key.strip()

    # معرفة نوع المصدر
    is_mp4 = stream_url.lower().split("?")[0].endswith(".mp4")

    command = [
        "ffmpeg",

        # عدم إظهار شعار FFmpeg
        "-hide_banner",

        # تسجيل أخطاء فقط
        "-loglevel", "warning",

        # قراءة المصدر بسرعة حقيقية
        "-re",

        # إذا كان MP4 يتم تكراره
        "-stream_loop", "-1" if is_mp4 else "0",

        # المصدر
        "-i", stream_url,

        # الفيديو
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-tune", "zerolatency",

        # جودة مناسبة للبث
        "-pix_fmt", "yuv420p",

        # الصوت
        "-c:a", "aac",
        "-b:a", "128k",
        "-ar", "44100",

        # FLV
        "-f", "flv",

        # رابط Facebook
        full_url
    ]

    try:

        process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE
        )

        return process

    except FileNotFoundError:
        print("❌ FFmpeg غير مثبت أو غير موجود في PATH")
        return None

    except Exception as e:
        print("❌ خطأ في تشغيل FFmpeg:", e)
        return None


# ============================================================
# إيقاف FFmpeg بأمان
# ============================================================

def stop_process(process):

    if process is None:
        return

    try:

        if process.poll() is None:

            try:
                process.stdin.write(b"q\n")
                process.stdin.flush()
            except:
                pass

            try:
                process.wait(timeout=5)
            except:
                process.terminate()

                try:
                    process.wait(timeout=3)
                except:
                    process.kill()

    except Exception as e:
        print("خطأ أثناء إيقاف FFmpeg:", e)


# ============================================================
# مراقبة وإعادة تشغيل البث
# ============================================================

def monitor_stream(data):

    while True:

        time.sleep(3)

        # إذا تم طلب إيقاف البث
        if data.get("stopped", False):
            break

        process = data.get("process")

        if process is None:
            time.sleep(3)
            continue

        # FFmpeg ما زال يعمل
        if process.poll() is None:
            continue

        # FFmpeg توقف
        print("⚠️ FFmpeg توقف، سيتم إعادة التشغيل...")

        if data.get("stopped", False):
            break

        new_process = start_ffmpeg(
            data["stream_url"],
            data["fb_link"],
            data["fb_key"]
        )

        if new_process:

            data["process"] = new_process
            data["start_time"] = time.time()

            print("✅ تم إعادة تشغيل البث")

        else:

            print("❌ فشل إعادة تشغيل البث")
            time.sleep(5)


# ============================================================
# تشغيل بث جديد
# ============================================================

def create_stream(name, stream_url, fb_link, fb_key):

    process = start_ffmpeg(
        stream_url,
        fb_link,
        fb_key
    )

    if process is None:
        return None

    data = {
        "name": name,
        "stream_url": stream_url,
        "fb_link": fb_link,
        "fb_key": fb_key,
        "process": process,
        "start_time": time.time(),
        "stopped": False
    }

    thread = threading.Thread(
        target=monitor_stream,
        args=(data,),
        daemon=True
    )

    data["thread"] = thread

    thread.start()

    return data


# ============================================================
# فحص FFmpeg
# ============================================================

def check_ffmpeg():

    try:

        result = subprocess.run(
            ["ffmpeg", "-version"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )

        return result.returncode == 0

    except:
        return False


# ============================================================
# واجهة البداية
# ============================================================

@bot.message_handler(commands=["start"])
def start(message):

    markup = telebot.types.ReplyKeyboardMarkup(
        resize_keyboard=True
    )

    markup.row(
        "🔥 SOLO بث واحد",
        "🔥 GROUP بث مجموعة"
    )

    markup.row(
        "⛔ STOP إيقاف بث",
        "📡 البثوث النشطة"
    )

    bot.send_message(
        message.chat.id,
        "👋 أهلاً بك في نظام البث\n\n"
        "اختر العملية التي تريدها:",
        reply_markup=markup
    )


# ============================================================
# STATUS
# ============================================================

@bot.message_handler(commands=["status"])
def status_command(message):
    active_streams(message)


# ============================================================
# SOLO
# ============================================================

@bot.message_handler(
    func=lambda msg: msg.text == "🔥 SOLO بث واحد"
)
def solo_start(message):

    user_setup[message.from_user.id] = {}

    bot.send_message(
        message.chat.id,
        "📝 أرسل اسم البث:"
    )

    bot.register_next_step_handler(
        message,
        solo_name
    )


def solo_name(message):

    uid = message.from_user.id

    user_setup.setdefault(uid, {})
    user_setup[uid]["name"] = message.text.strip()

    bot.send_message(
        message.chat.id,
        "🔑 أرسل Facebook Stream Key:"
    )

    bot.register_next_step_handler(
        message,
        solo_key
    )


def solo_key(message):

    uid = message.from_user.id

    user_setup[uid]["key"] = message.text.strip()

    bot.send_message(
        message.chat.id,
        "🌐 أرسل Facebook Stream URL:\n"
        "مثال:\n"
        "rtmps://live-api-s.facebook.com:443/rtmp/"
    )

    bot.register_next_step_handler(
        message,
        solo_fb_link
    )


def solo_fb_link(message):

    uid = message.from_user.id

    user_setup[uid]["fb_link"] = message.text.strip()

    bot.send_message(
        message.chat.id,
        "🎥 أرسل رابط البث الحقيقي:\n\n"
        "يمكن أن يكون:\n"
        "• m3u8\n"
        "• ts\n"
        "• mp4"
    )

    bot.register_next_step_handler(
        message,
        solo_stream_url
    )


def solo_stream_url(message):

    uid = message.from_user.id

    stream_url = message.text.strip()

    setup = user_setup.get(uid, {})

    name = setup.get("name")
    fb_key = setup.get("key")
    fb_link = setup.get("fb_link")

    if not name or not fb_key or not fb_link:

        bot.send_message(
            message.chat.id,
            "❌ البيانات غير مكتملة."
        )

        return

    # منع تكرار اسم البث
    if name in solo_streams:

        bot.send_message(
            message.chat.id,
            "❌ يوجد بث بنفس الاسم بالفعل."
        )

        return

    bot.send_message(
        message.chat.id,
        "⏳ جاري تشغيل البث..."
    )

    data = create_stream(
        name,
        stream_url,
        fb_link,
        fb_key
    )

    if data is None:

        bot.send_message(
            message.chat.id,
            "❌ فشل تشغيل FFmpeg.\n"
            "تأكد من تثبيت FFmpeg وصحة الرابط."
        )

        return

    with data_lock:
        solo_streams[name] = data

    bot.send_message(
        message.chat.id,
        f"✅ تم تشغيل بث *{name}* بنجاح 🔥"
    )

    user_setup.pop(uid, None)


# ============================================================
# GROUP
# ============================================================

@bot.message_handler(
    func=lambda msg: msg.text == "🔥 GROUP بث مجموعة"
)
def group_start(message):

    uid = message.from_user.id

    user_setup[uid] = {}

    bot.send_message(
        message.chat.id,
        "🔢 كم عدد البثوث في المجموعة؟"
    )

    bot.register_next_step_handler(
        message,
        ask_count
    )


def ask_count(message):

    uid = message.from_user.id

    try:

        count = int(message.text)

        if count < 1:
            raise ValueError

        if count > 20:

            bot.send_message(
                message.chat.id,
                "❌ الحد الأقصى 20 بثًا في المجموعة."
            )

            return

        user_setup[uid]["count"] = count
        user_setup[uid]["streams"] = []

        bot.send_message(
            message.chat.id,
            "📝 أرسل اسم المجموعة:"
        )

        bot.register_next_step_handler(
            message,
            ask_group_name
        )

    except:

        bot.send_message(
            message.chat.id,
            "❌ أرسل رقم صحيح."
        )


def ask_group_name(message):

    uid = message.from_user.id

    user_setup[uid]["group_name"] = message.text.strip()

    bot.send_message(
        message.chat.id,
        "📝 أرسل اسم البث الأول:"
    )

    bot.register_next_step_handler(
        message,
        ask_stream_name
    )


def ask_stream_name(message):

    uid = message.from_user.id

    stream = {
        "name": message.text.strip()
    }

    user_setup[uid]["streams"].append(stream)

    bot.send_message(
        message.chat.id,
        "🔑 أرسل Stream Key:"
    )

    bot.register_next_step_handler(
        message,
        ask_key
    )


def ask_key(message):

    uid = message.from_user.id

    user_setup[uid]["streams"][-1]["key"] = message.text.strip()

    bot.send_message(
        message.chat.id,
        "🌐 أرسل Facebook Stream URL:"
    )

    bot.register_next_step_handler(
        message,
        ask_fb_link
    )


def ask_fb_link(message):

    uid = message.from_user.id

    user_setup[uid]["streams"][-1]["fb_link"] = message.text.strip()

    bot.send_message(
        message.chat.id,
        "🎥 أرسل رابط البث الحقيقي:\n"
        "m3u8 / ts / mp4"
    )

    bot.register_next_step_handler(
        message,
        ask_stream_url
    )


def ask_stream_url(message):

    uid = message.from_user.id

    user_setup[uid]["streams"][-1]["stream_url"] = message.text.strip()

    setup = user_setup[uid]

    if len(setup["streams"]) == setup["count"]:

        bot.send_message(
            message.chat.id,
            "🔥 جاري تشغيل جميع بثوث المجموعة..."
        )

        start_group_streams(message)

    else:

        number = len(setup["streams"]) + 1

        bot.send_message(
            message.chat.id,
            f"📝 أرسل اسم البث رقم {number}:"
        )

        bot.register_next_step_handler(
            message,
            ask_stream_name
        )


def start_group_streams(message):

    uid = message.from_user.id
    setup = user_setup[uid]

    group_name = setup["group_name"]

    if group_name in groups:

        bot.send_message(
            message.chat.id,
            "❌ توجد مجموعة بنفس الاسم."
        )

        return

    groups[group_name] = {}

    success = 0

    for stream in setup["streams"]:

        name = stream["name"]

        data = create_stream(
            name,
            stream["stream_url"],
            stream["fb_link"],
            stream["key"]
        )

        if data:

            groups[group_name][name] = data
            success += 1

    bot.send_message(
        message.chat.id,
        f"✅ تم تشغيل {success}/{setup['count']} بث في المجموعة "
        f"*{group_name}* 🔥"
    )

    user_setup.pop(uid, None)


# ============================================================
# STOP
# ============================================================

@bot.message_handler(
    func=lambda msg: msg.text == "⛔ STOP إيقاف بث"
)
def stop_request(message):

    bot.send_message(
        message.chat.id,
        "🛑 أرسل اسم البث الذي تريد إيقافه:"
    )

    bot.register_next_step_handler(
        message,
        stop_stream
    )


def stop_stream(message):

    stream_name = message.text.strip()

    # =========================
    # SOLO
    # =========================

    if stream_name in solo_streams:

        data = solo_streams[stream_name]

        data["stopped"] = True

        stop_process(data["process"])

        del solo_streams[stream_name]

        bot.send_message(
            message.chat.id,
            f"🛑 تم إيقاف بث *{stream_name}*"
        )

        return

    # =========================
    # GROUP
    # =========================

    for group_name in list(groups.keys()):

        streams = groups[group_name]

        if stream_name in streams:

            data = streams[stream_name]

            data["stopped"] = True

            stop_process(data["process"])

            del streams[stream_name]

            # حذف المجموعة إذا لم يبق فيها بث
            if len(streams) == 0:
                del groups[group_name]

            bot.send_message(
                message.chat.id,
                f"🛑 تم إيقاف بث *{stream_name}* "
                f"من مجموعة *{group_name}*"
            )

            return

    bot.send_message(
        message.chat.id,
        "❌ لم يتم العثور على بث بهذا الاسم."
    )


# ============================================================
# إيقاف مجموعة كاملة
# ============================================================

@bot.message_handler(commands=["stopgroup"])
def stop_group_command(message):

    parts = message.text.split(maxsplit=1)

    if len(parts) < 2:

        bot.send_message(
            message.chat.id,
            "استخدم:\n"
            "`/stopgroup اسم_المجموعة`"
        )

        return

    group_name = parts[1].strip()

    if group_name not in groups:

        bot.send_message(
            message.chat.id,
            "❌ المجموعة غير موجودة."
        )

        return

    streams = groups[group_name]

    for data in streams.values():

        data["stopped"] = True
        stop_process(data["process"])

    del groups[group_name]

    bot.send_message(
        message.chat.id,
        f"🛑 تم إيقاف المجموعة *{group_name}* بالكامل."
    )


# ============================================================
# البثوث النشطة
# ============================================================

@bot.message_handler(
    func=lambda msg: msg.text == "📡 البثوث النشطة"
)
def active_streams(message):

    text = "📡 *البثوث النشطة الآن:*\n\n"

    total = 0

    # SOLO
    for nam e, data in solo_streams.items():

        process = data["process"]

        if process.poll() is None:

            duration = int(
                time.time() - data["start_time"]
            )

            minutes = duration // 60
            seconds = duration % 60

            text += (
                f"🔥 SOLO: *{name}*\n"
                f"⏱ {minutes} دقيقة و {seconds} ثانية\n\n"
            )

            total += 1

    # GROUP
    for group_name, streams in groups.items():

        text += f"🎛 *GROUP: {group_name}*\n"

        for name, data in streams.items():

            process = data["process"]

            if process.poll() is None:

                duration = int(
                    time.time() - data["start_time"]
                )

                minutes = duration // 60
                seconds = duration % 60

                text += (
                    f"   🔥 {name}\n"
                    f"   ⏱ {minutes}د {seconds}ث\n"
                )

                total += 1

        text += "\n"

    if total == 0:

        text += "❌ لا توجد بثوث تعمل حاليًا."

    else:

        text += f"\n📊 إجمالي البثوث: *{total}*"

    bot.send_message(
        message.chat.id,
        text
    )


# ============================================================
# أمر STOP
# ============================================================

@bot.message_handler(commands=["stop"])
def stop_command(message):

    parts = message.text.split(maxsplit=1)

    if len(parts) < 2:

        bot.send_message(
            message.chat.id,
            "استخدم:\n"
            "`/stop اسم_البث`"
        )

        return

    stream_name = parts[1].strip()

    # نفس وظيفة STOP
    fake_message = message
    fake_message.text = stream_name

    stop_stream(fake_message)


# ============================================================
# بدء البوت
# ============================================================

if __name__ == "__main__":

    print("===================================")
    print("      FACEBOOK STREAM BOT")
    print("===================================")

    if not check_ffmpeg():

        print("❌ FFmpeg غير مثبت!")
        print("ثبت FFmpeg ثم شغل البرنامج مرة أخرى.")
        exit()

    print("✅ FFmpeg موجود")
    print("✅ Telegram Bot يعمل")
    print("===================================")

    while True:

        try:

            bot.infinity_polling(
                timeout=60,
                long_polling_timeout=60
            )

        except Exception as e:

            print("❌ Telegram error:", e)

            time.sleep(5)
