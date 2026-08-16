import os
import time
import signal
import threading
import subprocess
import telebot
from telebot import types


# =========================================================
# CONFIG
# =========================================================

TOKEN = "8806164669:AAGwNJQDSvHOcoCzycF7zTNlSgKBfAuv81o"

MAX_STREAMS = 2
RESTART_DELAY = 5
CHECK_INTERVAL = 3


if TOKEN == "YOUR_BOT_TOKEN_HERE":
    raise RuntimeError("ضع توكن البوت في TOKEN داخل الكود")


# =========================================================
# TELEGRAM
# =========================================================

bot = telebot.TeleBot(
    TOKEN,
    parse_mode="Markdown"
)


# =========================================================
# STORAGE
# =========================================================

solo = {}
groups = {}
sessions = {}

lock = threading.RLock()


# =========================================================
# HELPERS
# =========================================================

def duration(seconds):

    seconds = int(seconds)

    hours, remainder = divmod(seconds, 3600)
    minutes, seconds = divmod(remainder, 60)

    if hours:
        return f"{hours} ساعة {minutes} دقيقة"

    if minutes:
        return f"{minutes} دقيقة {seconds} ثانية"

    return f"{seconds} ثانية"


def total_streams():

    with lock:

        return (
            len(solo)
            + sum(
                len(group)
                for group in groups.values()
            )
        )


# =========================================================
# FFMPEG COMMAND
# =========================================================

def ffmpeg_command(data):

    source = data["source"]

    destination = (
        data["fb_url"].rstrip("/")
        + "/"
        + data["key"]
    )

    source_type = (
        source.lower()
        .split("?")[0]
    )

    command = [
        "ffmpeg",

        "-hide_banner",
        "-loglevel", "warning",
        "-nostdin",

        "-re"
    ]

    # -----------------------------------------------------
    # MP4 LOOP
    # -----------------------------------------------------

    if source_type.endswith(".mp4"):

        command += [
            "-stream_loop",
            "-1"
        ]

    # -----------------------------------------------------
    # M3U8 / TS RECONNECT
    # -----------------------------------------------------

    elif (
        ".m3u8" in source_type
        or source_type.endswith(".ts")
    ):

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

    # -----------------------------------------------------
    # INPUT
    # -----------------------------------------------------

    command += [
        "-i",
        source
    ]

    # -----------------------------------------------------
    # VIDEO
    # -----------------------------------------------------

    command += [

        "-map",
        "0:v:0",

        "-c:v",
        "libx264",

        "-preset",
        "veryfast",

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

    # -----------------------------------------------------
    # AUDIO
    # -----------------------------------------------------

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

    # -----------------------------------------------------
    # OUTPUT
    # -----------------------------------------------------

    command += [

        "-f",
        "flv",

        destination
    ]

    return command


# =========================================================
# START FFMPEG
# =========================================================

def start_process(data):

    try:

        command = ffmpeg_command(data)

        print(
            "▶️ Starting:",
            data["name"],
            flush=True
        )

        process = subprocess.Popen(

            command,

            stdin=subprocess.DEVNULL,

            stdout=subprocess.DEVNULL,

            stderr=subprocess.DEVNULL,

            start_new_session=True
        )

        return process

    except Exception as error:

        print(
            "❌ FFmpeg Error:",
            error,
            flush=True
        )

        return None


# =========================================================
# STOP FFMPEG
# =========================================================

def stop_process(data):

    data["stopped"] = True

    process = data.get("process")

    if process is None:
        return

    if process.poll() is not None:
        return

    try:

        os.killpg(
            os.getpgid(process.pid),
            signal.SIGTERM
        )

        process.wait(timeout=8)

    except Exception:

        try:
            process.kill()
        except Exception:
            pass


# =========================================================
# AUTO RESTART
# =========================================================

def monitor(data):

    while not data["stopped"]:

        time.sleep(CHECK_INTERVAL)

        if data["stopped"]:
            break

        process = data.get("process")

        if process is None:
            continue

        if process.poll() is None:
            continue

        print(
            "⚠️ Stream stopped:",
            data["name"],
            flush=True
        )

        time.sleep(RESTART_DELAY)

        if data["stopped"]:
            break

        new_process = start_process(data)

        if new_process:

            data["process"] = new_process

            data["started"] = time.time()

            print(
                "🔄 Stream restarted:",
                data["name"],
                flush=True
            )


# =========================================================
# CREATE STREAM
# =========================================================

def create_stream(
    name,
    source,
    fb_url,
    key
):

    data = {

        "name": name,

        "source": source,

        "fb_url": fb_url,

        "key": key,

        "process": None,

        "started": time.time(),

        "stopped": False
    }

    process = start_process(data)

    if process is None:
        return None

    data["process"] = process

    data["started"] = time.time()

    thread = threading.Thread(
        target=monitor,
        args=(data,),
        daemon=True
    )

    thread.start()

    return data


# =========================================================
# KEYBOARD
# =========================================================

def main_keyboard():

    keyboard = types.ReplyKeyboardMarkup(
        resize_keyboard=True
    )

    keyboard.row(
        "🔥 SOLO",
        "🔥 GROUP"
    )

    keyboard.row(
        "📡 STATUS",
        "⛔ STOP"
    )

    keyboard.row(
        "🛑 STOP ALL"
    )

    return keyboard


# =========================================================
# START
# =========================================================

@bot.message_handler(commands=["start"])
def start(message):

    bot.send_message(

        message.chat.id,

        "👋 *Facebook Live Bot*\n\n"
        "اختر العملية:",

        reply_markup=main_keyboard()
    )


# =========================================================
# SOLO
# =========================================================

@bot.message_handler(
    func=lambda m: m.text == "🔥 SOLO"
)
def solo_start(message):

    user_id = message.from_user.id

    sessions[user_id] = {
        "type": "solo"
    }

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

    sessions[user_id]["name"] = (
        message.text.strip()
    )

    bot.send_message(
        message.chat.id,
        "🔑 أرسل Facebook Stream Key:"
    )

    bot.register_next_step_handler(
        message,
        solo_key
    )


def solo_key(message):

    user_id = message.from_user.id

    sessions[user_id]["key"] = (
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

    sessions[user_id]["fb_url"] = (
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

    setup = sessions.pop(
        user_id,
        None
    )

    if setup is None:
        return

    source = message.text.strip()

    name = setup["name"]

    if total_streams() >= MAX_STREAMS:

        bot.send_message(
            message.chat.id,
            f"❌ الحد الأقصى "
            f"{MAX_STREAMS} بث."
        )

        return

    with lock:

        if name in solo:

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

        setup["key"]
    )

    if data is None:

        bot.send_message(
            message.chat.id,
            "❌ فشل تشغيل FFmpeg."
        )

        return

    with lock:
        solo[name] = data

    bot.send_message(
        message.chat.id,
        f"✅ تم تشغيل *{name}* 🔥"
    )


# =========================================================
# GROUP
# =========================================================

@bot.message_handler(
    func=lambda m: m.text == "🔥 GROUP"
)
def group_start(message):

    user_id = message.from_user.id

    sessions[user_id] = {
        "type": "group",
        "streams": []
    }

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

    user_id = message.from_user.id

    try:

        count = int(
            message.text.strip()
        )

    except ValueError:

        bot.send_message(
            message.chat.id,
            "❌ أرسل رقمًا صحيحًا."
        )

        return

    if count < 1 or count > MAX_STREAMS:

        bot.send_message(
            message.chat.id,
            f"❌ اختر رقمًا من 1 إلى "
            f"{MAX_STREAMS}."
        )

        return

    sessions[user_id]["count"] = count

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

    name = message.text.strip()

    sessions[user_id]["group_name"] = name

    bot.send_message(
        message.chat.id,
        "📝 أرسل اسم البث الأول:"
    )

    bot.register_next_step_handler(
        message,
        group_stream_name
    )


def group_stream_name(message):

    user_id = message.from_user.id

    sessions[user_id]["streams"].append({

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

    user_id = message.from_user.id

    sessions[user_id]["streams"][-1][
        "key"
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

    sessions[user_id]["streams"][-1][
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

    sessions[user_id]["streams"][-1][
        "source"
    ] = message.text.strip()

    setup = sessions[user_id]

    current = len(
        setup["streams"]
    )

    total = setup["count"]

    if current < total:

        bot.send_message(
            message.chat.id,
            f"📝 أرسل اسم البث "
            f"رقم {current + 1}:"
        )

        bot.register_next_step_handler(
            message,
            group_stream_name
        )

        return

    launch_group(
        message,
        setup
    )

    sessions.pop(
        user_id,
        None
    )


def launch_group(
    message,
    setup
):

    if (
        total_streams()
        + len(setup["streams"])
        > MAX_STREAMS
    ):

        bot.send_message(
            message.chat.id,
            "❌ تجاوزت الحد الأقصى."
        )

        return

    group_name = setup["group_name"]

    created = {}

    for item in setup["streams"]:

        name = item["name"]

        if not name:
            continue

        if name in created:
            continue

        data = create_stream(

            name,

            item["source"],

            item["fb_url"],

            item["key"]
        )

        if data:
            created[name] = data

    if not created:

        bot.send_message(
            message.chat.id,
            "❌ لم يتم تشغيل أي بث."
        )

        return

    with lock:
        groups[group_name] = created

    bot.send_message(

        message.chat.id,

        f"✅ *GROUP: {group_name}*\n\n"
        f"🟢 تم تشغيل "
        f"{len(created)} بث."
    )


# =========================================================
# REMOVE STREAM
# =========================================================

def remove_stream(name):

    with lock:

        if name in solo:

            data = solo.pop(name)

            stop_process(data)

            return True

        for group_name in list(
            groups.keys()
        ):

            streams = groups[group_name]

            if name in streams:

                data = streams.pop(name)

                stop_process(data)

                if not streams:
                    del groups[group_name]

                return True

    return False


# =========================================================
# STOP
# =========================================================

@bot.message_handler(
    func=lambda m: m.text == "⛔ STOP"
)
def stop_button(message):

    bot.send_message(
        message.chat.id,
        "🛑 أرسل اسم البث:"
    )

    bot.register_next_step_handler(
        message,
        stop_name
    )


def stop_name(message):

    name = message.text.strip()

    if remove_stream(name):

        bot.send_message(
            message.chat.id,
            f"🛑 تم إيقاف *{name}*."
        )

    else:

        bot.send_message(
            message.chat.id,
            "❌ البث غير موجود."
        )


# =========================================================
# STOP ALL
# =========================================================

def stop_all():

    with lock:

        streams = list(
            solo.values()
        )

        for group in groups.values():

            streams.extend(
                group.values()
            )

        solo.clear()
        groups.clear()

    for data in streams:
        stop_process(data)

    return len(streams)


@bot.message_handler(
    func=lambda m: m.text == "🛑 STOP ALL"
)
def stop_all_button(message):

    number = stop_all()

    bot.send_message(
        message.chat.id,
        f"🛑 تم إيقاف {number} بث."
    )


@bot.message_handler(
    commands=["stopall"]
)
def stop_all_command(message):

    number = stop_all()

    bot.send_message(
        message.chat.id,
        f"🛑 تم إيقاف {number} بث."
    )


# =========================================================
# STATUS
# =========================================================

def get_status():

    lines = [
        "📡 *حالة البثوث*",
        ""
    ]

    active = 0
    total = 0

    with lock:

        for name, data in solo.items():

            total += 1

            process = data["process"]

            if process and process.poll() is None:

                active += 1

                elapsed = (
                    time.time()
                    - data["started"]
                )

                lines.append(
                    f"🟢 SOLO: *{name}*"
                )

                lines.append(
                    f"⏱ {duration(elapsed)}"
                )

            else:

                lines.append(
                    f"🟠 SOLO: *{name}* "
                    f"— إعادة التشغيل"
                )

        for group_name, streams in groups.items():

            lines.append("")

            lines.append(
                f"🎛 *GROUP: {group_name}*"
            )

            for name, data in streams.items():

                total += 1

                process = data["process"]

                if (
                    process
                    and process.poll() is None
                ):

                    active += 1

                    elapsed = (
                        time.time()
                        - data["started"]
                    )

                    lines.append(
                        f"🟢 {name} "
                        f"— {duration(elapsed)}"
                    )

                else:

                    lines.append(
                        f"🟠 {name} "
                        f"— إعادة التشغيل"
                    )

    if total == 0:

        lines.append(
            "❌ لا توجد بثوث."
        )

    lines.append("")

    lines.append(
        f"📊 يعمل: *{active}/{total}*"
    )

    lines.append(
        f"⚙️ الحد الأقصى: *{MAX_STREAMS}*"
    )

    return "\n".join(lines)


@bot.message_handler(
    func=lambda m: m.text == "📡 STATUS"
)
def status_button(message):

    bot.send_message(
        message.chat.id,
        get_status()
    )


@bot.message_handler(
    commands=["status"]
)
def status_command(message):

    bot.send_message(
        message.chat.id,
        get_status()
    )


# =========================================================
# HELP
# =========================================================

@bot.message_handler(
    commands=["help"]
)
def help_command(message):

    bot.send_message(

        message.chat.id,

        "🤖 *الأوامر*\n\n"
        "/start\n"
        "/status\n"
        "/stop اسم_البث\n"
        "/stopall\n"
        "/help"
    )


# =========================================================
# MAIN
# =========================================================

def main():

    print("=" * 55)
    print("FACEBOOK LIVE TELEGRAM BOT")
    print("RAILWAY VERSION")
    print("=" * 55)

    # -----------------------------------------------------
    # Check FFmpeg
    # -----------------------------------------------------

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

        if result.returncode != 0:
            raise RuntimeError(
                "FFmpeg is not working"
            )

    except Exception as error:

        print(
            "❌ FFmpeg Error:",
            error,
            flush=True
        )

        raise SystemExit(1)

    print("✅ FFmpeg OK")

    print(
        f"📊 MAX_STREAMS = "
        f"{MAX_STREAMS}"
    )

    print("🚀 Telegram Bot Started")

    # -----------------------------------------------------
    # Polling
    # -----------------------------------------------------

    while True:

        try:

            bot.infinity_polling(
                timeout=60,
                long_polling_timeout=60,
                skip_pending=True
            )

        except Exception as error:

            print(
                "⚠️ Telegram Error:",
                error,
                flush=True
            )

            time.sleep(10)


# =========================================================
# RUN
# =========================================================

if __name__ == "__main__":
    main()
