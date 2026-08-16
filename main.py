import telebot
import subprocess
import time
import threading

TOKEN = "8390693108:AAEoVcLwzMPNBGJXObQzhcLgMay35N42i4g"
bot = telebot.TeleBot(TOKEN)

solo_streams = {}
groups = {}
current_setup = {}

# تشغيل ffmpeg
def start_ffmpeg(stream_url, fb_link, fb_key):
    full_url = f"{fb_link}/{fb_key}"
    try:
        process = subprocess.Popen([
            "ffmpeg",
            "-re", "-i", stream_url,
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-f", "flv",
            full_url
        ])
        return process
    except Exception:
        return None

# إعادة تشغيل البث تلقائياً بدون رسالة
def auto_restart(name, data):
    while True:
        process = data["process"]

        if process.poll() is not None:  # البث توقف

            # إذا كان الرابط MP4 → كرره
            if data["stream_url"].lower().endswith(".mp4"):
                new_process = start_ffmpeg(data["stream_url"], data["fb_link"], data["fb_key"])
                data["process"] = new_process
                data["start_time"] = time.time()

            # إذا كان m3u8 أو ts → إعادة تشغيل عادية
            else:
                new_process = start_ffmpeg(data["stream_url"], data["fb_link"], data["fb_key"])
                data["process"] = new_process
                data["start_time"] = time.time()

        time.sleep(3)

# واجهة البداية
@bot.message_handler(commands=['start'])
def start(message):
    markup = telebot.types.ReplyKeyboardMarkup(resize_keyboard=True)
    markup.row("🔥 SOLO بث واحد", "🔥 GROUP بث مجموعة")
    markup.row("⛔ STOP إيقاف بث", "📡 البثوث النشطة")
    bot.send_message(message.chat.id, "مرحباً 👋 اختر العملية:", reply_markup=markup)

# ============================
# SOLO
# ============================

@bot.message_handler(func=lambda msg: msg.text == "🔥 SOLO بث واحد")
def solo_start(message):
    bot.send_message(message.chat.id, "أرسل اسم البث:")
    bot.register_next_step_handler(message, solo_name)

def solo_name(message):
    current_setup["name"] = message.text
    bot.send_message(message.chat.id, "أرسل المفتاح:")
    bot.register_next_step_handler(message, solo_key)

def solo_key(message):
    current_setup["key"] = message.text
    bot.send_message(message.chat.id, "أرسل رابط:")
    bot.register_next_step_handler(message, solo_link)

def solo_link(message):
    name = current_setup["name"]
    fb_key = current_setup["key"]
    fb_link = message.text

    # رابط البث الحقيقي يأتي الآن
    bot.send_message(message.chat.id, "أرسل رابط البث الحقيقي (m3u8 / ts / mp4):")
    bot.register_next_step_handler(message, solo_stream_url)

def solo_stream_url(message):
    stream_url = message.text
    name = current_setup["name"]
    fb_key = current_setup["key"]
    fb_link = current_setup["fb_link"]

    process = start_ffmpeg(stream_url, fb_link, fb_key)

    solo_streams[name] = {
        "stream_url": stream_url,
        "fb_link": fb_link,
        "fb_key": fb_key,
        "process": process,
        "start_time": time.time()
    }

    threading.Thread(target=auto_restart, args=(name, solo_streams[name])).start()

    bot.send_message(message.chat.id, f"تم تشغيل بث **{name}** بنجاح 🎥🔥")
    current_setup.clear()

# ============================
# GROUP
# ============================

@bot.message_handler(func=lambda msg: msg.text == "🔥 GROUP بث مجموعة")
def group_start(message):
    bot.send_message(message.chat.id, "كم عدد البثوث؟")
    bot.register_next_step_handler(message, ask_count)

def ask_count(message):
    try:
        count = int(message.text)
        current_setup["count"] = count
        current_setup["streams"] = []
        bot.send_message(message.chat.id, "أرسل اسم الكروب:")
        bot.register_next_step_handler(message, ask_group_name)
    except:
        bot.send_message(message.chat.id, "❌ أرسل رقم صحيح.")

def ask_group_name(message):
    current_setup["group_name"] = message.text
    bot.send_message(message.chat.id, "أرسل اسم البث الأول:")
    bot.register_next_step_handler(message, ask_stream_name)

def ask_stream_name(message):
    stream = {"name": message.text}
    current_setup["streams"].append(stream)
    bot.send_message(message.chat.id, "أرسل المفتاح:")
    bot.register_next_step_handler(message, ask_key)

def ask_key(message):
    current_setup["streams"][-1]["key"] = message.text
    bot.send_message(message.chat.id, "أرسل رابط:")
    bot.register_next_step_handler(message, ask_fb_link)

def ask_fb_link(message):
    current_setup["streams"][-1]["fb_link"] = message.text
    bot.send_message(message.chat.id, "أرسل رابط البث الحقيقي (m3u8 / ts / mp4):")
    bot.register_next_step_handler(message, ask_stream_url)

def ask_stream_url(message):
    current_setup["streams"][-1]["stream_url"] = message.text

    if len(current_setup["streams"]) == current_setup["count"]:
        bot.send_message(message.chat.id, "جاري تشغيل جميع بثوث الكروب 🔥🔥🔥")
        start_group_streams(message)
    else:
        bot.send_message(message.chat.id, "أرسل اسم البث التالي:")
        bot.register_next_step_handler(message, ask_stream_name)

def start_group_streams(message):
    group_name = current_setup["group_name"]
    groups[group_name] = {}

    for stream in current_setup["streams"]:
        name = stream["name"]
        fb_link = stream["fb_link"]
        key = stream["key"]
        stream_url = stream["stream_url"]

        process = start_ffmpeg(stream_url, fb_link, key)

        groups[group_name][name] = {
            "stream_url": stream_url,
            "fb_link": fb_link,
            "fb_key": key,
            "process": process,
            "start_time": time.time()
        }

        threading.Thread(target=auto_restart, args=(name, groups[group_name][name])).start()

    bot.send_message(message.chat.id, f"تم تشغيل جميع بثوث كروب **{group_name}** بنجاح 🎥🔥")
    current_setup.clear()

# ============================
# STOP
# ============================

@bot.message_handler(func=lambda msg: msg.text == "⛔ STOP إيقاف بث")
def stop_request(message):
    bot.send_message(message.chat.id, "أرسل اسم البث:")
    bot.register_next_step_handler(message, stop_stream)

def stop_stream(message):
    stream_name = message.text

    if stream_name in solo_streams:
        solo_streams[stream_name]["process"].terminate()
        del solo_streams[stream_name]
        bot.send_message(message.chat.id, f"🛑 تم إيقاف بث **{stream_name}**")
        return

    for group_name, streams in groups.items():
        if stream_name in streams:
            streams[stream_name]["process"].terminate()
            del streams[stream_name]
            bot.send_message(message.chat.id, f"🛑 تم إيقاف بث **{stream_name}** داخل كروب **{group_name}**")
            return

    bot.send_message(message.chat.id, "❌ لم يتم العثور على بث بهذا الاسم.")

# ============================
# ACTIVE STREAMS
# ============================

@bot.message_handler(func=lambda msg: msg.text == "📡 البثوث النشطة")
def active_streams(message):
    text = "📡 **البثوث النشطة الآن:**\n\n"

    for name, data in solo_streams.items():
        duration = int(time.time() - data["start_time"])
        text += f"🔥 SOLO: {name} — {duration//60} دقيقة و {duration%60} ثانية\n"

    for group_name, streams in groups.items():
        text += f"\n🎛 كروب: {group_name}\n"
        for name, data in streams.items():
            duration = int(time.time() - data["start_time"])
            text += f"   🔥 {name} — {duration//60} دقيقة و {duration%60} ثانية\n"

    bot.send_message(message.chat.id, text)

bot.polling()
