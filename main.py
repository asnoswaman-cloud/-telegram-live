import os
import time
import signal
import threading
import subprocess

import telebot
from telebot import types


# =========================================================
# إعدادات Railway
# =========================================================

BOT_TOKEN = os.getenv("8806164669:AAGwNJQDSvHOcoCzycF7zTNlSgKBfAuv81o")

if not BOT_TOKEN:
    print("❌ BOT_TOKEN غير موجود في Railway Variables")
    raise SystemExit(1)

try:
    MAX_STREAMS = int(os.getenv("MAX_STREAMS", "2"))
except ValueError:
    MAX_STREAMS = 2

RESTART_DELAY = 5
CHECK_INTERVAL = 5


# =========================================================
# Telegram
# =========================================================

bot = telebot.TeleBot(
    BOT_TOKEN,
    parse_mode="Markdown"
)


# =========================================================
# التخزين
# =========================================================

solo_streams = {}
groups = {}

# إعداد منفصل لكل مستخدم
setups = {}

lock = threading.RLock()


# =========================================================
# LOG
# =========================================================

def log(text):
    print(
        time.strftime("[%Y-%m-%d %H:%M:%S]"),
        text,
        flush=True
    )


# =========================================================
# عدد البثوث
# =========================================================

def count_streams():

    with lock:

        total = len(solo_streams)

        for group in groups.values():
            total += len(group)

        return total


# =========================================================
# مدة البث
# =========================================================

def format_duration(seconds):

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

    if minutes:
        return f"{minutes} دقيقة {seconds} ثانية"

    return f"{seconds} ثانية"


# =========================================================
# نوع المصدر
# =========================================================

def get_source_type(url):

    clean = url.lower().split("?")[0]

    if clean.endswith(".mp4"):
        return "mp4"

    if ".m3u8" in clean:
        return "m3u8"

    if ".ts" in clean:
        return "ts"

    return "other"


# =========================================================
# التأكد من FFmpeg
# =========================================================

def check_ffmpeg():

    try:

        result = subprocess.run(
            [
                "ffmpeg",
                "-version"
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=10
        )

        return result.returncode == 0

    except Exception as e:

        log(f"FFmpeg check error: {e}")

        return False


# =========================================================
# بناء أمر FFmpeg
# =========================================================

def build_ffmpeg_command(data):

    source = data["source"]
    fb_url = data["fb_url"].rstrip("/")
    fb_key = data["fb_key"].strip()

    destination = f"{fb_url}/{fb_key}"

    source_type = get_source_type(source)

    command = [
        "ffmpeg",

        "-hide_banner",
        "-loglevel", "warning",

        "-nostdin",

        "-re"
    ]

    # =====================================================
    # MP4
    # =====================================================

    if source_type == "mp4":

        command += [
            "-stream_loop",
            "-1"
        ]

    # =====================================================
    # M3U8 / TS
    # =====================================================

    elif source_type in ("m3u8", "ts"):

        command += [
            "-reconnect",
            "1",

            "-reconnect_streamed",
            "1",

            "-reconnect_at_eof",
            "1",

            "-reconnect_delay_max",
            "10"
        ]

    # =====================================================
    # INPUT
    # =====================================================

    command += [
        "-i",
        source
    ]

    # =====================================================
    # VIDEO
    # =====================================================

    command += [

        "-map",
        "0:v:0",

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

        "-b:v",
        "2500k",

        "-maxrate",
        "3000k",

        "-bufsize",
        "6000k"
    ]

    # =====================================================
    # AUDIO
    # =====================================================

    command += [

        "-map",
        "0:a:0?",

        "-c:a",
        "aac",

        "-b:a",
        "128k",

        "-ar",
        "44100",

        "-ac",
        "2"
    ]

    # =====================================================
    # OUTPUT
    # =====================================================

    command += [

        "-flvflags",
        "no_duration_filesize",

        "-f",
        "flv",

        destination
    ]

    return command


# =========================================================
# تشغيل FFmpeg
# =========================================================

def start_ffmpeg(data):

    command = build_ffmpeg_command(data)

    log(
        f"▶️ تشغيل: {data['name']}"
    )

    try:

        process = subprocess.Popen(

            command,

            stdin=subprocess.PIPE,

            stdout=subprocess.DEVNULL,

            stderr=subprocess.DEVNULL,

            start_new_session=True
        )

        return process

    except Exception as e:

        log(
            f"❌ خطأ FFmpeg: {e}"
        )

        return None


# =========================================================
# إيقاف FFmpeg
# =========================================================

def stop_ffmpeg(data):

    data["stopped"] = True

    process = data.get("process")

    if process is None:
        return

    try:

        if process.poll() is None:

            log(
                f"⛔ إيقاف: {data['name']}"
            )

            try:

                os.killpg(
                    os.getpgid(process.pid),
                    signal.SIGTERM
                )

            except Exception:

                try:
                    process.terminate()
                except Exception:
                    pass

            try:

                process.wait(timeout=8)

            except subprocess.TimeoutExpired:

                try:

                    os.killpg(
                        os.getpgid(process.pid),
                        signal.SIGKILL
                    )

                except Exception:

                    try:
                        process.kill()
                    except Exception:
                        pass

    except Exception as e:

        log(
            f"Stop error: {e}"
        )


# =========================================================
# مراقبة البث وإعادة التشغيل
# =========================================================

def monitor_stream(data):

    while not data.get("stopped", False):

        time.sleep(CHECK_INTERVAL)

        if data.get("stopped", False):
            break

        process = data.get("process")

        if process is None:
            continue

        # FFmpeg ما زال يعمل
        if process.poll() is None:
            continue

        log(
            f"⚠️ توقف البث: {data['name']}"
        )

        # =================================================
        # إعادة التشغيل
        # =================================================

        while not data.get("stopped", False):

            time.sleep(RESTART_DELAY)

            if data.get("stopped", False):
                break

            new_process = start_ffmpeg(data)

            if new_process is not None:

                data["process"] = new_process
                data["start_time"] = time.time()

                log(
                    f"🔄 تمت إعادة تشغيل: "
                    f"{data['name']}"
                )

                break

            log(
                f"❌ فشلت إعادة تشغيل: "
                f"{data['name']}"
            )


# =========================================================
# إنشاء بث
# =========================================================

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

    if process is None:
        return None

    data["process"] = process
    data["start_time"] = time.time()

    thread = threading.Thread(
        target=monitor_stream,
        args=(data,),
        daemon=True
    )

    thread.start()

    data["monitor"] = thread

    return data


# =========================================================
# /start
# =========================================================

@bot.message_handler(commands=["start"])
def start_command(message):

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


# =========================================================
# SOLO
# =========================================================

@bot.message_handler(
    func=lambda m:
    m.text == "🔥 SOLO بث واحد"
)
def solo_start(message):

    user_id = message.from_user.id

    setups[user_id] = {}

    bot.send_message(
        message.chat.id,
        "📝 أرسل اسم البث:"
    )

    bot.register_next_step_handler(
        message,
        solo_name
    )


def solo_name(message):

    user_id = message.from_user.id

    setups[user_id] = {
        "name": message.text.strip()
    }

    bot.send_message(
        message.chat.id,
        "🔑 أرسل Stream Key:"
    )

    bot.register_next_step_handler(
        message,
        solo_key
    )


def solo_key(message):

    user_id = message.from_user.id

    setups[user_id]["fb_key"] = (
        message.text.strip()
    )

    bot.send_message(
        message.chat.id,
        "🌐 أرسل Facebook Stream URL:"
    )

    bot.register_next_step_handler(
        message,
        solo_fb_url
    )


def solo_fb_url(message):

    user_id = message.from_user.id

    setups[user_id]["fb_url"] = (
        message.text.strip()
    )

    bot.send_message(
        message.chat.id,
        "🎥 أرسل رابط المصدر:\n\n"
        "m3u8 أو ts أو mp4"
    )

    bot.register_next_step_handler(
        message,
        solo_source
    )


def solo_source(message):

    user_id = message.from_user.id

    setup = setups.get(user_id)

    if not setup:
        return

    name = setup["name"]
    source = message.text.strip()

    if not name or not source:

        bot.send_message(
            message.chat.id,
            "❌ البيانات غير صحيحة."
        )

        return

    if count_streams() >= MAX_STREAMS:

        bot.send_message(
            message.chat.id,
            f"❌ وصلت إلى الحد الأقصى "
            f"({MAX_STREAMS})"
        )

        setups.pop(user_id, None)

        return

    with lock:

        if name in solo_streams:

            bot.send_message(
                message.chat.id,
                "❌ يوجد بث بهذا الاسم."
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

    if data is None:

        bot.send_message(
            message.chat.id,
            "❌ فشل تشغيل FFmpeg.\n"
            "تأكد من الرابط والمفتاح."
        )

        setups.pop(user_id, None)

        return

    with lock:

        solo_streams[name] = data

    setups.pop(user_id, None)

    bot.send_message(
        message.chat.id,
        f"✅ تم تشغيل بث *{name}* 🔥"
    )


# =========================================================
# GROUP
# =========================================================

@bot.message_handler(
    func=lambda m:
    m.text == "🔥 GROUP بث مجموعة"
)
def group_start(message):

    user_id = message.from_user.id

    setups[user_id] = {}

    bot.send_message(
        message.chat.id,
        f"🔢 كم عدد البثوث؟\n\n"
        f"الحد الأقصى الحالي: {MAX_STREAMS}"
    )

    bot.register_next_step_handler(
        message,
        group_count
    )


def group_count(message):

    user_id = message.from_user.id

    try:

        count = int(
            message.text.strip()
        )

        if count < 1:
            raise ValueError

        if count > MAX_STREAMS:
            raise ValueError

    except ValueError:

        bot.send_message(
            message.chat.id,
            f"❌ أدخل رقمًا من 1 إلى "
            f"{MAX_STREAMS}"
        )

        return

    setups[user_id]["count"] = count
    setups[user_id]["streams"] = []

    bot.send_message(
        message.chat.id,
        "📝 أرسل اسم المجموعة:"
    )

    bot.register_next_step_handler(
        message,
        group_name
    )


def group_name(message):

    user_id = message.from_user.id

    setups[user_id]["group_name"] = (
        message.text.strip()
    )

    bot.send_message(
        message.chat.id,
        "📝 أرسل اسم البث رقم 1:"
    )

    bot.register_next_step_handler(
        message,
        group_stream_name
    )


def group_stream_name(message):

    user_id = message.from_user.id

    setups[user_id]["streams"].append(
        {
            "name": message.text.strip()
        }
    )

    bot.send_message(
        message.chat.id,
        "🔑 أرسل Stream Key:"
    )

    bot.register_next_step_handler(
        message,
        group_key
    )


def group_key(message):

    user_id = message.from_user.id

    setups[user_id]["streams"][-1][
        "fb_key"
    ] = message.text.strip()

    bot.send_message(
        message.chat.id,
        "🌐 أرسل Facebook Stream URL:"
    )

    bot.register_next_step_handler(
        message,
        group_fb_url
    )


def group_fb_url(message):

    user_id = message.from_user.id

    setups[user_id]["streams"][-1][
        "fb_url"
    ] = message.text.strip()

    bot.send_message(
        message.chat.id,
        "🎥 أرسل رابط المصدر:\n"
        "m3u8 / ts / mp4"
    )

    bot.register_next_step_handler(
        message,
        group_source
    )


def group_source(message):

    user_id = message.from_user.id

    setups[user_id]["streams"][-1][
        "source"
    ] = message.text.strip()

    setup = setups[user_id]

    current = len(
        setup["streams"]
    )

    total = setup["count"]

    if current < total:

        bot.send_message(
            message.chat.id,
            f"📝 أرسل اسم البث رقم "
            f"{current + 1}:"
        )

        bot.register_next_step_handler(
            message,
            group_stream_name
        )

    else:

        launch_group(message)


# =========================================================
# تشغيل GROUP
# =========================================================

def launch_group(message):

    user_id = message.from_user.id

    setup = setups.get(user_id)

    if not setup:
        return

    group_name = setup["group_name"]
    streams = setup["streams"]

    if (
        count_streams() + len(streams)
        > MAX_STREAMS
    ):

        bot.send_message(
            message.chat.id,
            "❌ عدد البثوث يتجاوز "
            "الحد المسموح."
        )

        setups.pop(user_id, None)

        return

    with lock:

        if group_name in groups:

            bot.send_message(
                message.chat.id,
                "❌ توجد مجموعة بهذا الاسم."
            )

            return

        groups[group_name] = {}

    success = 0
    failed = 0

    for stream in streams:

        data = create_stream(

            stream["name"],

            stream["source"],

            stream["fb_url"],

            stream["fb_key"]
        )

        if data is not None:

            with lock:

                groups[group_name][
                    stream["name"]
                ] = data

            success += 1

        else:

            failed += 1

    if success == 0:

        with lock:
            groups.pop(
                group_name,
                None
            )

    setups.pop(user_id, None)

    bot.send_message(

        message.chat.id,

        f"🔥 *GROUP: {group_name}*\n\n"
        f"✅ تم تشغيل: {success}\n"
        f"❌ فشل: {failed}"
    )


# =========================================================
# حذف بث
# =========================================================

def remove_stream(name):

    with lock:

        # SOLO
        if name in solo_streams:

            data = solo_streams.pop(name)

            stop_ffmpeg(data)

            return True

        # GROUP
        for group_name in list(
            groups.keys()
        ):

            streams = groups[group_name]

            if name in streams:

                data = streams.pop(name)

                stop_ffmpeg(data)

                if not streams:

                    del groups[group_name]

                return True

    return False


# =========================================================
# STOP BUTTON
# =========================================================

@bot.message_handler(
    func=lambda m:
    m.text == "⛔ STOP إيقاف بث"
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
            "❌ لم يتم العثور على البث."
        )


# =========================================================
# /stop
# =========================================================

@bot.message_handler(
    commands=["stop"]
)
def stop_command(message):

    parts = message.text.split(
        maxsplit=1
    )

    if len(parts) < 2:

        bot.send_message(
            message.chat.id,
            "الاستخدام:\n"
            "`/stop اسم_البث`"
        )

        return

    name = parts[1].strip()

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


# =========================================================
# STOP GROUP
# =========================================================

@bot.message_handler(
    commands=["stopgroup"]
)
def stop_group_command(message):

    parts = message.text.split(
        maxsplit=1
    )

    if len(parts) < 2:

        bot.send_message(
            message.chat.id,
            "الاستخدام:\n"
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
        f"🛑 تم إيقاف المجموعة "
        f"*{group_name}*"
    )


# =========================================================
# STOP ALL
# =========================================================

def stop_all():

    with lock:

        all_streams = []

        all_streams.extend(
            solo_streams.values()
        )

        for group in groups.values():

            all_streams.extend(
                group.values()
            )

        solo_streams.clear()
        groups.clear()

    for data in all_streams:

        stop_ffmpeg(data)

    return len(all_streams)


@bot.message_handler(
    commands=["stopall"]
)
def stop_all_command(message):

    total = stop_all()

    bot.send_message(
        message.chat.id,
        f"🛑 تم إيقاف {total} بث."
    )


@bot.message_handler(
    func=lambda m:
    m.text == "🛑 إيقاف الكل"
)
def stop_all_button(message):

    total = stop_all()

    bot.send_message(
        message.chat.id,
        f"🛑 تم إيقاف {total} بث."
    )


# =========================================================
# STATUS
# =========================================================

@bot.message_handler(
    commands=["status"]
)
def status_command(message):

    send_status(message)


@bot.message_handler(
    func=lambda m:
    m.text == "📡 البثوث النشطة"
)
def status_button(message):

    send_status(message)


def send_status(message):

    lines = []

    lines.append("📡 *البثوث الحالية*")
    lines.append("")

    active = 0
    total = 0

    with lock:

        # =================================================
        # SOLO
        # =================================================

        for name, data in solo_streams.items():

            total += 1

            process = data.get("process")

            if (
                process is not None
                and process.poll() is None
            ):

                elapsed = (
                    time.time()
                    - data["start_time"]
                )

                duration = format_duration(
                    elapsed
                )

                lines.append(
                    f"🟢 SOLO: *{name}*"
                )

                lines.append(
                    f"⏱ {duration}"
                )

                lines.append("")

                active += 1

            else:

                lines.append(
                    f"🟠 SOLO: *{name}* "
                    f"— إعادة التشغيل"
                )

                lines.append("")

        # =================================================
        # GROUP
        # =================================================

        for group_name, streams in groups.items():

            lines.append(
                f"🎛 *GROUP: {group_name}*"
            )

            for name, data in streams.items():

                total += 1

                process = data.get("process")

                if (
                    process is not None
                    and process.poll() is None
                ):

                    elapsed = (
                        time.time()
                        - data["start_time"]
                    )

                    duration = format_duration(
                        elapsed
                    )

                    lines.append(
                        f"🟢 {name} — {duration}"
                    )

                    active += 1

                else:

                    lines.append(
                        f"🟠 {name} "
                        f"— إعادة التشغيل"
                    )

            lines.append("")

    if total == 0:

        lines.append(
            "❌ لا توجد بثوث."
        )

    lines.append(
        f"📊 الإجمالي: *{total}*"
    )

    lines.append(
        f"🟢 يعمل الآن: *{active}*"
    )

    lines.append(
        f"⚙️ الحد الأقصى: *{MAX_STREAMS}*"
    )

    bot.send_message(
        message.chat.id,
        "\n".join(lines)
    )


# =========================================================
# أوامر المساعدة
# =========================================================

@bot.message_handler(
    commands=["help"]
)
def help_command(message):

    text = (
        "🤖 *الأوامر المتاحة*\n\n"

        "/start — القائمة الرئيسية\n"
        "/status — حالة البثوث\n"
        "/stop اسم_البث — إيقاف بث\n"
        "/stopgroup اسم_المجموعة — "
        "إيقاف مجموعة\n"
        "/stopall — إيقاف كل البثوث\n"
        "/help — المساعدة"
    )

    bot.send_message(
        message.chat.id,
        text
    )


# =========================================================
# الأوامر غير المعروفة
# =========================================================

@bot.message_handler(
    func=lambda m:
    m.text and m.text.startswith("/")
)
def unknown_command(message):

    bot.send_message(
        message.chat.id,
        "❓ أمر غير معروف.\n"
        "استخدم /start أو /help"
    )


# =========================================================
# MAIN
# =========================================================

def main():

    print("=" * 60)
    print("FACEBOOK LIVE TELEGRAM BOT")
    print("RAILWAY VERSION")
    print("=" * 60)

    # -----------------------------------------------------
    # FFmpeg
    # -----------------------------------------------------

    if not check_ffmpeg():

        print(
            "❌ FFmpeg غير موجود."
        )

        raise SystemExit(1)

    print("✅ FFmpeg موجود")

    # -----------------------------------------------------
    # Config
    # -----------------------------------------------------

    print(
        f"📊 الحد الأقصى للبثوث: "
        f"{MAX_STREAMS}"
    )

    print(
        f"🔄 إعادة التشغيل بعد: "
        f"{RESTART_DELAY} ثانية"
    )

    print(
        "🚀 Telegram Bot يعمل..."
    )

    # -----------------------------------------------------
    # Telegram polling
    # -----------------------------------------------------

    while True:

        try:

            bot.infinity_polling(
                timeout=60,
                long_polling_timeout=60,
                skip_pending=True
            )

        except Exception as e:

            log(
                f"⚠️ Telegram error: {e}"
            )

            time.sleep(10)


# =========================================================
# RUN
# =========================================================

if __name__ == "__main__":
    main()
