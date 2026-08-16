import os
import time
import threading
import subprocess
import signal

import telebot
from telebot import types


# =========================================================
# CONFIG
# =========================================================

TOKEN = os.getenv("8806164669:AAGwNJQDSvHOcoCzycF7zTNlSgKBfAuv81o")

if not TOKEN:
    print("ERROR: BOT_TOKEN غير موجود")
    raise SystemExit(1)

try:
    MAX_STREAMS = int(os.getenv("MAX_STREAMS", "2"))
except ValueError:
    MAX_STREAMS = 2

RESTART_DELAY = 5
CHECK_INTERVAL = 5

bot = telebot.TeleBot(
    TOKEN,
    parse_mode="Markdown"
)

# =========================================================
# STORAGE
# =========================================================

solo_streams = {}
groups = {}
setups = {}

lock = threading.RLock()


# =========================================================
# LOG
# =========================================================

def log(message):
    print(
        time.strftime("[%Y-%m-%d %H:%M:%S]"),
        message,
        flush=True
    )


# =========================================================
# COUNT
# =========================================================

def count_streams():

    with lock:

        total = len(solo_streams)

        for group in groups.values():
            total += len(group)

        return total


# =========================================================
# DURATION
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
        return f"{days}d {hours}h"

    if hours:
        return f"{hours}h {minutes}m"

    return f"{minutes}m {seconds}s"


# =========================================================
# SOURCE TYPE
# =========================================================

def source_type(url):

    url = url.lower().split("?")[0]

    if url.endswith(".mp4"):
        return "mp4"

    if ".m3u8" in url:
        return "m3u8"

    if ".ts" in url:
        return "ts"

    return "other"


# =========================================================
# FFMPEG CHECK
# =========================================================

def check_ffmpeg():

    try:

        result = subprocess.run(
            ["ffmpeg", "-version"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=10
        )

        return result.returncode == 0

    except Exception as e:

        log(f"FFmpeg check error: {e}")

        return False


# =========================================================
# BUILD FFMPEG COMMAND
# =========================================================

def build_command(data):

    source = data["source"]
    fb_url = data["fb_url"].rstrip("/")
    fb_key = data["fb_key"].strip()

    destination = f"{fb_url}/{fb_key}"

    stype = source_type(source)

    command = [
        "ffmpeg",

        "-hide_banner",
        "-loglevel", "warning",

        "-nostdin",

        "-re"
    ]

    # -----------------------------------------------------
    # MP4
    # -----------------------------------------------------

    if stype == "mp4":

        command += [
            "-stream_loop", "-1"
        ]

    # -----------------------------------------------------
    # M3U8 / TS
    # -----------------------------------------------------

    elif stype in ("m3u8", "ts"):

        command += [

            "-reconnect", "1",
            "-reconnect_streamed", "1",
            "-reconnect_delay_max", "10"

        ]

    # -----------------------------------------------------
    # INPUT
    # -----------------------------------------------------

    command += [
        "-i", source
    ]

    # -----------------------------------------------------
    # VIDEO
    # -----------------------------------------------------

    command += [

        "-map", "0:v:0",

        "-c:v", "libx264",

        "-preset", "veryfast",

        "-tune", "zerolatency",

        "-pix_fmt", "yuv420p",

        "-r", "30",

        "-b:v", "2500k",

        "-maxrate", "3000k",

        "-bufsize", "6000k"
    ]

    # -----------------------------------------------------
    # AUDIO
    # -----------------------------------------------------

    command += [

        "-map", "0:a:0?",

        "-c:a", "aac",

        "-b:a", "128k",

        "-ar", "44100",

        "-ac", "2"
    ]

    # -----------------------------------------------------
    # OUTPUT
    # -----------------------------------------------------

    command += [

        "-flvflags", "no_duration_filesize",

        "-f", "flv",

        destination
    ]

    return command


# =========================================================
# START FFMPEG
# =========================================================

def start_ffmpeg(data):

    command = build_command(data)

    log(
        f"Starting stream: {data['name']}"
    )

    try:

        process = subprocess.Popen(

            command,

            stdin=subprocess.PIPE,

            stdout=subprocess.DEVNULL,

            stderr=subprocess.STDOUT,

            start_new_session=True
        )

        return process

    except Exception as e:

        log(
            f"FFmpeg start error: {e}"
        )

        return None


# =========================================================
# STOP FFMPEG
# =========================================================

def stop_ffmpeg(data):

    data["stopped"] = True

    process = data.get("process")

    if not process:
        return

    try:

        if process.poll() is None:

            log(
                f"Stopping: {data['name']}"
            )

            # إرسال SIGTERM
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
# MONITOR
# =========================================================

def monitor_stream(data):

    while True:

        if data.get("stopped"):
            break

        time.sleep(CHECK_INTERVAL)

        if data.get("stopped"):
            break

        process = data.get("process")

        if process is None:
            continue

        # -------------------------------------------------
        # FFmpeg still running
        # -------------------------------------------------

        if process.poll() is None:
            continue

        # -------------------------------------------------
        # FFmpeg stopped
        # -------------------------------------------------

        log(
            f"Stream stopped: {data['name']}"
        )

        # -------------------------------------------------
        # Restart
        # -------------------------------------------------

        while not data.get("stopped"):

            time.sleep(RESTART_DELAY)

            if data.get("stopped"):
                break

            new_process = start_ffmpeg(data)

            if new_process:

                data["process"] = new_process

                data["start_time"] = time.time()

                log(
                    f"Stream restarted: {data['name']}"
                )

                break

            log(
                f"Restart failed: {data['name']}"
            )


# =========================================================
# CREATE STREAM
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
# START MENU
# =========================================================

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


# =========================================================
# SOLO
# =========================================================

@bot.message_handler(
    func=lambda m:
    m.text == "🔥 SOLO بث واحد"
)
def solo_start(message):

    uid = message.from_user.id

    setups[uid] = {}

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

    setups[uid]["name"] = (
        message.text.strip()
    )

    bot.send_message(
        message.chat.id,
        "🔑 أرسل Stream Key:"
    )

    bot.register_next_step_handler(
        message,
        solo_key
    )


def solo_key(message):

    uid = message.from_user.id

    setups[uid]["fb_key"] = (
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

    uid = message.from_user.id

    setups[uid]["fb_url"] = (
        message.text.strip()
    )

    bot.send_message(
        message.chat.id,
        "🎥 أرسل رابط الفيديو/البث:\n\n"
        "m3u8 أو ts أو mp4"
    )

    bot.register_next_step_handler(
        message,
        solo_source
    )


def solo_source(message):

    uid = message.from_user.id

    setup = setups.get(uid)

    if not setup:
        return

    name = setup["name"]

    source = message.text.strip()

    # -----------------------------------------------------
    # Check limit
    # -----------------------------------------------------

    if count_streams() >= MAX_STREAMS:

        bot.send_message(
            message.chat.id,
            f"❌ وصلت إلى الحد الأقصى: "
            f"{MAX_STREAMS}"
        )

        setups.pop(uid, None)

        return

    # -----------------------------------------------------
    # Check duplicate
    # -----------------------------------------------------

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
            "❌ فشل تشغيل FFmpeg."
        )

        setups.pop(uid, None)

        return

    with lock:

        solo_streams[name] = data

    setups.pop(uid, None)

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

    uid = message.from_user.id

    setups[uid] = {}

    bot.send_message(
        message.chat.id,
        f"🔢 كم عدد البثوث؟\n"
        f"الحد الأقصى: {MAX_STREAMS}"
    )

    bot.register_next_step_handler(
        message,
        group_count
    )


def group_count(message):

    uid = message.from_user.id

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
            f"❌ أدخل رقمًا بين "
            f"1 و {MAX_STREAMS}"
        )

        return

    setups[uid]["count"] = count

    setups[uid]["streams"] = []

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

    setups[uid]["group_name"] = (
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

    uid = message.from_user.id

    setups[uid]["streams"].append({

        "name":
        message.text.strip()

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

    setups[uid]["streams"][-1][
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

    uid = message.from_user.id

    setups[uid]["streams"][-1][
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

    uid = message.from_user.id

    setups[uid]["streams"][-1][
        "source"
    ] = message.text.strip()

    setup = setups[uid]

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
# LAUNCH GROUP
# =========================================================

def launch_group(message):

    uid = message.from_user.id

    setup = setups.get(uid)

    if not setup:
        return

    group_name = setup["group_name"]

    streams = setup["streams"]

    # -----------------------------------------------------
    # Check total
    # -----------------------------------------------------

    if (
        count_streams()
        + len(streams)
        > MAX_STREAMS
    ):

        bot.send_message(
            message.chat.id,
            "❌ عدد البثوث يتجاوز "
            "الحد المسموح."
        )

        setups.pop(uid, None)

        return

    # -----------------------------------------------------
    # Create group
    # -----------------------------------------------------

    with lock:

        if group_name in groups:

            bot.send_message(
                message.chat.id,
                "❌ توجد مجموعة بهذا الاسم."
            )

            return

        groups[group_name] = {}

    success = 0

    for stream in streams:

        name = stream["name"]

        data = create_stream(

            name,

            stream["source"],

            stream["fb_url"],

            stream["fb_key"]
        )

        if data:

            with lock:

                groups[group_name][
                    name
                ] = data

            success += 1

    failed = len(streams) - success

    # إذا فشل كل شيء
    if success == 0:

        with lock:
            groups.pop(group_name, None)

    setups.pop(uid, None)

    bot.send_message(

        message.chat.id,

        f"🔥 *GROUP {group_name}*\n\n"
        f"✅ نجح: {success}\n"
        f"❌ فشل: {failed}"
    )


# =========================================================
# REMOVE STREAM
# =========================================================

def remove_stream(name):

    with lock:

        # SOLO
        if name in solo_streams:

            data = solo_streams.pop(name)

            stop_ffmpeg(data)

            return True

        # GROUP
        for group_name in list(groups.keys()):

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
# /STOP
# =========================================================

@bot.message_handler(commands=["stop"])
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
            "🛑 تم إيقاف البث."
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
def stop_group(message):

    parts = message.text.split(
        maxsplit=1
    )

    if len(parts) < 2:

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
        f"🛑 تم إيقاف المجموعة "
        f"*{group_name}*."
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

    count = stop_all()

    bot.send_message(
        message.chat.id,
        f"🛑 تم إيقاف {count} بث."
    )


@bot.message_handler(
    func=lambda m:
    m.text == "🛑 إيقاف الكل"
)
def stop_all_button(message):

    count = stop_all()

    bot.send_message(
        message.chat.id,
        f"🛑 تم إيقاف {count} بث."
    )


# =========================================================
# STATUS
# =========================================================

@bot.message_handler(
    commands=["status"]
)
def status(message):

    send_status(message)


@bot.message_handler(
    func=lambda m:
    m.text == "📡 البثوث النشطة"
)
def status_button(message):

    send_status(message)


def send_status(message):

    text = "📡 *البثوث الحالية*\n\n"

    active = 0

    with lock:

        # SOLO
        for name, data in solo_streams.items():

            process = data["process"]

            if (
                process
                and process.poll() is None
            ):

                text += (
                    f"🟢 SOLO: *{name}*\n"
                    f"⏱ {format_duration("
                    f"time.time() - "
                    f"data['start_time']"
                    f")}\n\n"
                )

                active += 1

            else:

                text += (
                    f"🟠 SOLO: *{name}* "
                    f"— إعادة التشغيل\n\n"
                )

        # GROUP
        for group_name, streams in groups.items():

            text += (
                f"🎛 *GROUP: "
                f"{group_name}*\n"
            )

            for name, data in streams.items():

                process = data["process"]

                if (
                    process
                    and process.poll() is None
                ):

                    text += (
                        f"🟢 {name} — "
                        f"{format_duration("
                        f"time.time() - "
                        f"data['start_time']"
                        f")}\n"
                    )

                    active += 1

                else:

                    text += (
                        f"🟠 {name} "
                        f"— إعادة التشغيل\n"
                    )

            text += "\n"

    if active == 0:

        text += "❌ لا توجد بثوث تعمل.\n"

    text += (
        f"\n📊 النشط الآن: *{active}*"
    )

    bot.send_message(
        message.chat.id,
        text
    )


# =========================================================
# UNKNOWN COMMANDS
# =========================================================

@bot.message_handler(
    func=lambda m:
    m.text.startswith("/")
)
def unknown(message):

    bot.send_message(
        message.chat.id,
        "❓ أمر غير معروف.\n"
        "استخدم /start"
    )


# =========================================================
# MAIN
# =========================================================

def main():

    print("=" * 55)
    print("FACEBOOK STREAM BOT - RAILWAY")
    print("=" * 55)

    if not check_ffmpeg():

        print(
            "❌ FFmpeg غير موجود"
        )

        raise SystemExit(1)

    print("✅ FFmpeg OK")

    print(
        f"📊 MAX_STREAMS = "
        f"{MAX_STREAMS}"
    )

    print("🚀 Telegram Bot Started")

    while True:

        try:

            bot.infinity_polling(

                timeout=60,

                long_polling_timeout=60,

                skip_pending=True

            )

        except Exception as e:

            log(
                f"Telegram connection error: {e}"
            )

            time.sleep(10)


if __name__ == "__main__":
    main()
