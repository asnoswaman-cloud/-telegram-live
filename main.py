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

# =========================================================
# TELEGRAM
# =========================================================

bot = telebot.TeleBot(TOKEN, parse_mode="Markdown")

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
        return len(solo) + sum(len(group) for group in groups.values())

# =========================================================
# FFMPEG COMMAND
# =========================================================

def ffmpeg_command(data):
    source = data["source"]
    destination = data["fb_url"].rstrip("/") + "/" + data["key"]
    source_type = source.lower().split("?")[0]

    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel", "warning",
        "-nostdin",
        "-re"
    ]

    if source_type.endswith(".mp4"):
        command += ["-stream_loop", "-1"]
    elif ".m3u8" in source_type or source_type.endswith(".ts"):
        command += [
            "-reconnect", "1",
            "-reconnect_streamed", "1",
            "-reconnect_at_eof", "1",
            "-reconnect_delay_max", "10"
        ]

    command += ["-i", source]

    command += [
        "-map", "0:v:0",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-pix_fmt", "yuv420p",
        "-r", "30",
        "-b:v", "2500k",
        "-maxrate", "3000k",
        "-bufsize", "6000k"
    ]

    command += [
        "-map", "0:a:0?",
        "-c:a", "aac",
        "-b:a", "128k",
        "-ar", "44100",
        "-ac", "2"
    ]

    command += ["-f", "flv", destination]
    return command

# =========================================================
# START FFMPEG
# =========================================================

def start_process(data):
    try:
        command = ffmpeg_command(data)
        print("▶️ Starting:", data["name"], flush=True)
        process = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True
        )
        return process
    except Exception as error:
        print("❌ FFmpeg Error:", error, flush=True)
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
        os.killpg(os.getpgid(process.pid), signal.SIGTERM)
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
        print("⚠️ Stream stopped:", data["name"], flush=True)
        time.sleep(RESTART_DELAY)
        if data["stopped"]:
            break
        new_process = start_process(data)
        if new_process:
            data["process"] = new_process
            data["started"] = time.time()
            print("🔄 Stream restarted:", data["name"], flush=True)

# =========================================================
# CREATE STREAM
# =========================================================

def create_stream(name, source, fb_url, key):
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
    thread = threading.Thread(target=monitor, args=(data,), daemon=True)
    thread.start()
    return data

# =========================================================
# KEYBOARD
# =========================================================

def main_keyboard():
    keyboard = types.ReplyKeyboardMarkup(resize_keyboard=True)
    keyboard.row("🔥 SOLO", "🔥 GROUP")
    keyboard.row("📡 STATUS", "⛔ STOP")
    keyboard.row("🛑 STOP ALL")
    return keyboard

# =========================================================
# START
# =========================================================

@bot.message_handler(commands=["start"])
def start(message):
    bot.send_message(message.chat.id, "👋 *Facebook Live Bot*\n\nاختر العملية:", reply_markup=main_keyboard())

# =========================================================
# SOLO
# =========================================================

@bot.message_handler(func=lambda m: m.text == "🔥 SOLO")
def solo_start(message):
    user_id = message.from_user.id
    sessions[user_id] = {"type": "solo"}
    bot.send_message(message.chat.id, "📝 أرسل اسم البث:")
    bot.register_next_step_handler(message, solo_name)

def solo_name(message):
    user_id = message.from_user.id
    sessions[user_id]["name"] = message.text.strip()
    bot.send_message(message.chat.id, "🔑 أرسل Facebook Stream Key:")
    bot.register_next_step_handler(message, solo_key)

def solo_key(message):
    user_id = message.from_user.id
    sessions[user_id]["key"] = message.text.strip()
    bot.send_message(message.chat.id, "🌐 أرسل Facebook Stream URL:")
    bot.register_next_step_handler(message, solo_fb_url)

def solo_fb_url(message):
    user_id = message.from_user.id
    sessions[user_id]["fb_url"] = message.text.strip()
    bot.send_message(message.chat.id, "🎥 أرسل رابط المصدر:\n\nm3u8 أو ts أو mp4")
    bot.register_next_step_handler(message, solo_source)

def solo_source(message):
    user_id = message.from_user.id
    setup = sessions.pop(user_id, None)
    if setup is None:
        return
    source = message.text.strip()
    name = setup["name"]

    if total_streams() >= MAX_STREAMS:
        bot.send_message(message.chat.id, f"❌ الحد الأقصى {MAX_STREAMS} بث.")
        return

    with lock:
        if name in solo:
            bot.send_message(message.chat.id, "❌ يوجد بث بهذا الاسم.")
            return

    bot.send_message(message.chat.id, "⏳ جاري تشغيل البث...")

    data = create_stream(name, source, setup["fb_url"], setup["key"])

    if data is None:
        bot.send_message(message.chat.id, "❌ فشل تشغيل FFmpeg.")
        return

    with lock:
        solo[name] = data

    bot.send_message(message.chat.id, f"✅ تم تشغيل *{name}* 🔥")

# =========================================================
# STOP ALL
# =========================================================

def stop_all():
    with lock:
        streams = list(solo.values())
        for group in groups.values():
            streams.extend(group.values())
        solo.clear()
        groups.clear()
    for data in streams:
        stop_process(data)
    return len(streams)

@bot.message_handler(func=lambda m: m.text == "🛑 STOP ALL")
def stop_all_button(message):
    number = stop_all()
    bot.send_message(message.chat.id, f"🛑 تم إيقاف {number} بث.")

# =========================================================
# MAIN
# =========================================================

def main():
    print("=" * 55)
    print("FACEBOOK LIVE TELEGRAM BOT")
    print("RAILWAY VERSION")
    print("=" * 55)

    try:
        result = subprocess.run(["ffmpeg", "-version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
        if result.returncode != 0:
            raise RuntimeError("FFmpeg is not working")
    except Exception as error:
        print("❌ FFmpeg Error:", error, flush=True)
        raise SystemExit(1)

    print("✅ FFmpeg OK")
    print(f"📊 MAX_STREAMS = {MAX_STREAMS}")
    print("🚀 Telegram Bot Started")

    while True:
        try:
            bot.infinity_polling(timeout=60, long_polling_timeout=60, skip_pending=True)
        except Exception as error:
            print("⚠️ Telegram Error:", error, flush=True)
            time.sleep(10)

if __name__ == "__main__":
    main()
