import os
import time
import threading
import subprocess
import telebot
from telebot import types

# ============================================================
# SETTINGS
# ============================================================

TOKEN = os.getenv("8806164669:AAGwNJQDSvHOcoCzycF7zTNlSgKBfAuv81o")

if not TOKEN:
    raise RuntimeError("BOT_TOKEN غير موجود في Railway Variables")

MAX_STREAMS = int(os.getenv("MAX_STREAMS", "10"))
RESTART_DELAY = 5
MONITOR_INTERVAL = 5

bot = telebot.TeleBot(
    TOKEN,
    parse_mode="Markdown"
)

# ============================================================
# DATA
# ============================================================

solo_streams = {}
groups = {}
user_setup = {}

lock = threading.RLock()


# ============================================================
# HELPERS
# ============================================================

def log(text):
    print(
        time.strftime("[%Y-%m-%d %H:%M:%S]"),
        text,
        flush=True
    )


def duration(seconds):
    seconds = int(seconds)

    days = seconds // 86400
    seconds %= 86400

    hours = seconds // 3600
    seconds %= 3600

    minutes = seconds // 60
    seconds %= 60

    if days:
        return f"{days} يوم {hours} ساعة"

    if hours:
        return f"{hours} ساعة {minutes} دقيقة"

    return f"{minutes} دقيقة {seconds} ثانية"


def total_streams():
    with lock:
        total = len(solo_streams)

        for streams in groups.values():
            total += len(streams)

        return total


def is_mp4(url):
    return url.lower().split("?")[0].endswith(".mp4")


# ============================================================
# FFMPEG
# ============================================================

def check_ffmpeg():

    try:
        result = subprocess.run(
            ["ffmpeg", "-version"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=10
        )

        return result.returncode == 0

    except Exception:
        return False


def start_ffmpeg(data):

    source = data["source"]
    fb_url = data["fb_url"].rstrip("/")
    fb_key = data["fb_key"]

    destination = f"{fb_url}/{fb_key}"

    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel", "warning",
        "-re"
    ]

    # MP4 = Loop
    if is_mp4(source):
        command += [
            "-stream_loop", "-1"
        ]

    command += [
        "-i", source,

        # Video
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-tune", "zerolatency",
        "-pix_fmt", "yuv420p",

        # Bitrate
        "-b:v", "2500k",
        "-maxrate", "3000k",
        "-bufsize", "6000k",

        # Audio
        "-c:a", "aac",
        "-b:a", "128k",
        "-ar", "44100",

        # Facebook
        "-f", "flv",
        destination
    ]

    try:

        log(f"تشغيل: {data['name']}")

        process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE
        )

        return process

    except Exception as e:

        log(f"FFmpeg ERROR: {e}")

        return None


def stop_ffmpeg(data):

    data["stopped"] = True

    process = data.get("process")

    if not process:
        return

    try:

        if process.poll() is None:

            try:
                process.stdin.write(b"q\n")
                process.stdin.flush()
                process.wait(timeout=5)

            except Exception:

                try:
                    process.terminate()
                    process.wait(timeout=3)

                except Exception:

                    try:
                        process.kill()
                    except Exception:
                        pass

    except Exception as e:

        log(f"STOP ERROR: {e}")


# ============================================================
# MONITOR
# ============================================================

def monitor_stream(data):

    while True:

        time.sleep(MONITOR_INTERVAL)

        if data.get("stopped"):
            break

        process = data.get("process")

        if process is None:
            continue

        # يعمل
        if process.poll() is None:
            continue

        log(
            f"البث توقف: {data['name']}"
        )

        # إعادة التشغيل
        while not data.get("stopped"):

            time.sleep(RESTART_DELAY)

            if data.get("stopped"):
                break

            new_process = start_ffmpeg(data)

            if new_process:

                data["process"] = new_process
                data["start_time"] = time.time()

                log(
                    f"تمت إعادة تشغيل: {data['name']}"
                )

                break

            log(
                f"فشل إعادة تشغيل: {data['name']}"
            )


# ============================================================
# CREATE STREAM
# ============================================================

def create_stream(
    name,
    source,
    fb_url,
    fb_key
):

    data = {
        "name": name,
        "source": source,
        "fb_url": fb_url,
        "fb_key": fb_key,
        "process": None,
        "start_time": time.time(),
        "stopped": False
    }

    process = start_ffmpeg(data)

    if not process:
        return None

    data["process"] = process
    data["start_time"] = time.time()

    thread = threading.Thread(
        target=monitor_stream,
        args=(data,),
        daemon=True
    )

    thread.start()

    return data


# ============================================================
# START
# ============================================================

@bot.message_handler(commands=["start"])
def start(message):

    keyboard = types.ReplyKeyboardMarkup(
        resize_keyboard=True
    )

    keyboard.row(
        "🔥 SOLO بث واحد",
        "🔥 GROUP بث مجموعة"
    )

    keyboard.row(
        "⛔ STOP إيقاف بث",
        "📡 البثوث النشطة"
    )

    keyboard.row(
        "🛑 إيقاف الكل"
    )

    bot.send_message(
        message.chat.id,
        "👋 *Facebook Live Bot*\n\n"
        "اختر العملية:",
        reply_markup=keyboard
    )


# ============================================================
# SOLO
# ============================================================

@bot.message_handler(
    func=lambda m: m.text == "🔥 SOLO بث واحد"
)
def solo_start(message):

    uid = message.from_user.id

    user_setup[uid] = {}

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

    user_setup[uid]["fb_key"] = message.text.strip()

    bot.send_message(
        message.chat.id,
        "🌐 أرسل Facebook Stream URL:"
    )

    bot.register_next_step_handler(
        message,
        solo_fb_url
    )


def solo_fb_url(message):

    uid = message.from_user.id

    user_setup[uid]["fb_url"] = message.text.strip()

    bot.send_message(
        message.chat.id,
        "🎥 أرسل رابط المصدر:\n\n"
        "m3u8\n"
        "ts\n"
        "mp4"
    )

    bot.register_next_step_handler(
        message,
        solo_source
    )


def solo_source(message):

    uid = message.from_user.id

    setup = user_setup.get(uid)

    if not setup:
        return

    name = setup["name"]
    source = message.text.strip()

    if total_streams() >= MAX_STREAMS:

        bot.send_message(
            message.chat.id,
            f"❌ وصلت للحد الأقصى: {MAX_STREAMS}"
        )

        return

    with lock:

        if name in solo_streams:

            bot.send_message(
                message.chat.id,
                "❌ يوجد بث بهذا الاسم بالفعل."
            )

            return

    bot.send_message(
        message.chat.id,
        "⏳ جاري تشغيل البث..."
    )

    data = create_stream(
        name,
        source,
        setup["fb_url"],
        setup["fb_key"]
    )

    if not data:

        bot.send_message(
            message.chat.id,
            "❌ فشل تشغيل FFmpeg.\n"
            "تأكد من الرابط."
        )

        return

    with lock:
        solo_streams[name] = data

    user_setup.pop(uid, None)

    bot.send_message(
        message.chat.id,
        f"✅ تم تشغيل *{name}* 🔥"
    )


# ============================================================
# GROUP
# ============================================================

@bot.message_handler(
    func=lambda m: m.text == "🔥 GROUP بث مجموعة"
)
def group_start(message):

    uid = message.from_user.id

    user_setup[uid] = {}

    bot.send_message(
        message.chat.id,
        "🔢 كم عدد البثوث؟"
    )

    bot.register_next_step_handler(
        message,
        group_count
    )


def group_count(message):

    uid = message.from_user.id

    try:

        count = int(message.text)

        if count < 1 or count > MAX_STREAMS:
            raise ValueError

    except:

        bot.send_message(
            message.chat.id,
            f"❌ أدخل رقمًا من 1 إلى {MAX_STREAMS}."
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
        group_name
    )


def group_name(message):

    uid = message.from_user.id

    user_setup[uid]["group_name"] = message.text.strip()

    bot.send_message(
        message.chat.id,
        "📝 أرسل اسم البث الأول:"
    )

    bot.register_next_step_handler(
        message,
        group_stream_name
    )


def group_stream_name(message):

    uid = message.from_user.id

    user_setup[uid]["streams"].append({
        "name": message.text.strip()
    })

    bot.send_message(
        message.chat.id,
        "🔑 أرسل Stream Key:"
    )

    bot.register_next_step_handler(
        message,
        group_key
    )


def group_key(message):

    uid = message.from_user.id

    user_setup[uid]["streams"][-1]["fb_key"] = (
        message.text.strip()
    )

    bot.send_message(
        message.chat.id,
        "🌐 أرسل Facebook Stream URL:"
    )

    bot.register_next_step_handler(
        message,
        group_fb_url
    )


def group_fb_url(message):

    uid = message.from_user.id

    user_setup[uid]["streams"][-1]["fb_url"] = (
        message.text.strip()
    )

    bot.send_message(
        message.chat.id,
        "🎥 أرسل رابط المصدر m3u8 / ts / mp4:"
    )

    bot.register_next_step_handler(
        message,
        group_source
    )


def group_source(message):

    uid = message.from_user.id

    user_setup[uid]["streams"][-1]["source"] = (
        message.text.strip()
    )

    setup = user_setup[uid]

    current = len(setup["streams"])

    if current < setup["count"]:

        bot.send_message(
            message.chat.id,
            f"📝 أرسل اسم البث رقم {current + 1}:"
        )

        bot.register_next_step_handler(
            message,
            group_stream_name
        )

    else:

        start_group(message)


def start_group(message):

    uid = message.from_user.id

    setup = user_setup[uid]

    group_name = setup["group_name"]

    if group_name in groups:

        bot.send_message(
            message.chat.id,
            "❌ توجد مجموعة بهذا الاسم."
        )

        return

    if total_streams() + len(setup["streams"]) > MAX_STREAMS:

        bot.send_message(
            message.chat.id,
            "❌ عدد البثوث يتجاوز الحد المسموح."
        )

        return

    groups[group_name] = {}

    success = 0

    for item in setup["streams"]:

        data = create_stream(
            item["name"],
            item["source"],
            item["fb_url"],
            item["fb_key"]
        )

        if data:

            groups[group_name][item["name"]] = data
            success += 1

    bot.send_message(
        message.chat.id,
        f"🔥 *{group_name}*\n\n"
        f"✅ تم تشغيل: {success}\n"
        f"❌ فشل: {len(setup['streams']) - success}"
    )

    user_setup.pop(uid, None)


# ============================================================
# REMOVE STREAM
# ============================================================

def remove_stream(name):

    with lock:

        if name in solo_streams:

            data = solo_streams.pop(name)

            stop_ffmpeg(data)

            return True

        for group_name in list(groups.keys()):

            streams = groups[group_name]

            if name in streams:

                data = streams.pop(name)

                stop_ffmpeg(data)

                if not streams:
                    del groups[group_name]

                return True

    return False


# ============================================================
# STOP BUTTON
# ============================================================

@bot.message_handler(
    func=lambda m: m.text == "⛔ STOP إيقاف بث"
)
def stop_button(message):

    bot.send_message(
        message.chat.id,
        "🛑 أرسل اسم البث:"
    )

    bot.register_next_step_handler(
        message,
        stop_by_name
    )


def stop_by_name(message):

    name = message.text.strip()

    if remove_stream(name):

        bot.send_message(
            message.chat.id,
            f"🛑 تم إيقاف *{name}*"
        )

    else:

        bot.send_message(
            message.chat.id,
            "❌ البث غير موجود."
        )


# ============================================================
# /STOP
# ============================================================

@bot.message_handler(commands=["stop"])
def stop_command(message):

    parts = message.text.split(maxsplit=1)

    if len(parts) != 2:

        bot.send_message(
            message.chat.id,
            "الاستخدام:\n"
            "`/stop اسم_البث`"
        )

        return

    if remove_stream(parts[1].strip()):

        bot.send_message(
            message.chat.id,
            "🛑 تم إيقاف البث."
        )

    else:

        bot.send_message(
            message.chat.id,
            "❌ البث غير موجود."
        )


# ============================================================
# STOP GROUP
# ============================================================

@bot.message_handler(commands=["stopgroup"])
def stop_group(message):

    parts = message.text.split(maxsplit=1)

    if len(parts) != 2:

        bot.send_message(
            message.chat.id,
            "`/stopgroup اسم_المجموعة`"
        )

        return

    group_name = parts[1].strip()

    with lock:

        streams = groups.pop(
            group_name,
            None
        )

    if streams is None:

        bot.send_message(
            message.chat.id,
            "❌ المجموعة غير موجودة."
        )

        return

    for data in streams.values():
        stop_ffmpeg(data)

    bot.send_message(
        message.chat.id,
        f"🛑 تم إيقاف *{group_name}* بالكامل."
    )


# ============================================================
# STOP ALL
# ============================================================

def stop_everything():

    with lock:

        solo = list(solo_streams.values())

        grouped = []

        for streams in groups.values():
            grouped.extend(
                streams.values()
            )

        solo_streams.clear()
        groups.clear()

    for data in solo:
        stop_ffmpeg(data)

    for data in grouped:
        stop_ffmpeg(data)

    return len(solo) + len(grouped)


@bot.message_handler(commands=["stopall"])
def stop_all_command(message):

    count = stop_everything()

    bot.send_message(
        message.chat.id,
        f"🛑 تم إيقاف جميع البثوث.\n"
        f"📊 العدد: {count}"
    )


@bot.message_handler(
    func=lambda m: m.text == "🛑 إيقاف الكل"
)
def stop_all_button(message):

    count = stop_everything()

    bot.send_message(
        message.chat.id,
        f"🛑 تم إيقاف {count} بث."
    )


# ============================================================
# STATUS
# ============================================================

def send_status(message):

    lines = [
        "📡 *حالة البثوث*",
        ""
    ]

    active = 0

    with lock:

        for name, data in solo_streams.items():

            process = data["process"]

            if process and process.poll() is None:

                lines.append(
                    f"🟢 SOLO: *{name}*"
                )

                lines.append(
                    f"⏱ {duration(time.time() - data['start_time'])}"
                )

                active += 1

            else:

                lines.append(
                    f"🟠 SOLO: *{name}* — إعادة التشغيل"
                )

            lines.append("")

        for group_name, streams in groups.items():

            lines.append(
                f"🎛 *GROUP: {group_name}*"
            )

            for name, data in streams.items():

                process = data["process"]

                if process and process.poll() is None:

                    lines.append(
                        f"🟢 {name} | "
                        f"{duration(time.time() - data['start_time'])}"
                    )

                    active += 1

                else:

                    lines.append(
                        f"🟠 {name} | إعادة التشغيل"
                    )

            lines.append("")

    if active == 0:

        lines.append(
            "❌ لا توجد بثوث نشطة."
        )

    lines.append(
        f"\n📊 البثوث النشطة: *{active}*"
    )

    bot.send_message(
        message.chat.id,
        "\n".join(lines)
    )


@bot.message_handler(commands=["status"])
def status_command(message):

    send_status(message)


@bot.message_handler(
    func=lambda m: m.text == "📡 البثوث النشطة"
)
def status_button(message):

    send_status(message)


# ============================================================
# UNKNOWN
# ============================================================

@bot.message_handler(
    func=lambda m: True
)
def unknown(message):

    if not message.text.startswith("/"):
        bot.send_message(
            message.chat.id,
            "❓ استخدم /start"
        )


# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":

    print("=" * 50)
    print("FACEBOOK STREAM BOT - RAILWAY")
    print("=" * 50)

    if not check_ffmpeg():

        print("❌ FFmpeg غير موجود")

        raise SystemExit(1)

    print("✅ FFmpeg موجود")
    print(f"📊 الحد الأقصى للبثوث: {MAX_STREAMS}")
    print("🚀 Bot started")

    while True:

        try:

            bot.infinity_polling(
                timeout=60,
                long_polling_timeout=60,
                skip_pending=True
            )

        except Exception as e:

            print(
                "Telegram error:",
                e
            )

            time.sleep(10)
