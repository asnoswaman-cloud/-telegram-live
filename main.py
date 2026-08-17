import asyncio
import os
import signal
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional

from aiogram import Bot, Dispatcher, F
from aiogram.filters import CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import KeyboardButton, Message, ReplyKeyboardMarkup
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode

# ============================================================
# ضع توكن بوت تيليجرام هنا
# ============================================================
BOT_TOKEN = "8806164669:AAGwNJQDSvHOcoCzycF7zTNlSgKBfAuv81o"

# FFmpeg executable. إذا كان ffmpeg في PATH اتركه كما هو.
FFMPEG = "ffmpeg"

# مجلد ملفات البث المؤقتة
WORK_DIR = Path("streams")
WORK_DIR.mkdir(exist_ok=True)

# الحد الأقصى الافتراضي للبثوث المتزامنة في GROUP
MAX_GROUP_STREAMS = 10


@dataclass
class Stream:
    name: str
    source_url: str
    facebook_key: str
    process: Optional[asyncio.subprocess.Process] = None


streams: Dict[str, Stream] = {}


class StreamForm(StatesGroup):
    name = State()
    source = State()
    facebook_key = State()


class StopForm(StatesGroup):
    name = State()


main_keyboard = ReplyKeyboardMarkup(
    keyboard=[
        [KeyboardButton(text="🎯 SOLO")],
        [KeyboardButton(text="🔥 GROUP")],
        [KeyboardButton(text="🛑 STOP")],
    ],
    resize_keyboard=True,
)


def normalize_name(name: str) -> str:
    return " ".join(name.strip().split()).lower()


def facebook_rtmp_url(stream_key: str) -> str:
    # Facebook Live يقبل RTMPS. المفتاح يأتي من Facebook.
    return f"rtmps://live-api-s.facebook.com:443/rtmp/{stream_key}"


async def start_ffmpeg(stream: Stream) -> None:
    """
    يشغل المصدر ويعيد بثه إلى Facebook.
    لا يتم فحص المصدر أو المفتاح خارج FFmpeg؛ استخدم فقط مصادر
    ومفاتيح تملك حق استخدامها.
    """
    output = facebook_rtmp_url(stream.facebook_key)

    cmd = [
        FFMPEG,
        "-hide_banner",
        "-loglevel", "warning",
        "-reconnect", "1",
        "-reconnect_streamed", "1",
        "-reconnect_delay_max", "10",
        "-i", stream.source_url,

        # إعادة ترميز مناسبة للبث المباشر
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-pix_fmt", "yuv420p",
        "-r", "30",
        "-g", "60",
        "-b:v", "4000k",
        "-maxrate", "4000k",
        "-bufsize", "8000k",

        "-c:a", "aac",
        "-b:a", "128k",
        "-ar", "44100",
        "-ac", "2",

        "-f", "flv",
        output,
    ]

    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    stream.process = process

    async def watch_process():
        if process.stderr:
            # نقرأ الأخطاء حتى لا يمتلئ buffer
            while True:
                line = await process.stderr.readline()
                if not line:
                    break

        return_code = await process.wait()

        # لا نحذف البث إذا كان ما زال نفس الكائن في القاموس
        key = normalize_name(stream.name)
        current = streams.get(key)
        if current is stream:
            stream.process = None

        print(f"[FFMPEG] {stream.name} انتهى. code={return_code}")

    asyncio.create_task(watch_process())


async def stop_stream(name: str) -> bool:
    key = normalize_name(name)
    stream = streams.get(key)

    if not stream or not stream.process:
        return False

    process = stream.process

    try:
        process.send_signal(signal.SIGTERM)
        await asyncio.wait_for(process.wait(), timeout=8)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
    except ProcessLookupError:
        pass

    stream.process = None
    streams.pop(key, None)
    return True


async def begin_stream(message: Message, state: FSMContext):
    data = await state.get_data()

    name = data["name"].strip()
    source = data["source"].strip()
    fb_key = data["facebook_key"].strip()

    key = normalize_name(name)

    if key in streams:
        await message.answer(
            "❌ يوجد بث بهذا الاسم بالفعل.\n"
            "اختر اسماً مختلفاً أو أوقف البث القديم أولاً."
        )
        await state.clear()
        return

    if len(streams) >= MAX_GROUP_STREAMS:
        await message.answer("❌ وصلت إلى الحد الأقصى للبثوث المتزامنة.")
        await state.clear()
        return

    stream = Stream(
        name=name,
        source_url=source,
        facebook_key=fb_key,
    )

    streams[key] = stream

    try:
        await start_ffmpeg(stream)
    except FileNotFoundError:
        streams.pop(key, None)
        await message.answer(
            "❌ لم يتم العثور على FFmpeg على السيرفر.\n"
            "ثبّت FFmpeg ثم شغّل البوت من جديد."
        )
        await state.clear()
        return
    except Exception as exc:
        streams.pop(key, None)
        await message.answer(f"❌ فشل تشغيل البث:\n{exc}")
        await state.clear()
        return

    await state.clear()

    await message.answer(
        f"✅ تم تشغيل البث بنجاح\n\n"
        f"📺 الاسم: {name}\n"
        f"📡 المصدر: {source}\n\n"
        f"🛑 لإيقافه اضغط STOP ثم أرسل الاسم: {name}",
        reply_markup=main_keyboard,
    )


async def ask_stream_name(message: Message, state: FSMContext):
    await state.clear()
    await state.set_state(StreamForm.name)
    await message.answer("📺 أرسل اسم البث:")


async def ask_source(message: Message, state: FSMContext):
    name = message.text.strip()

    if not name:
        await message.answer("❌ الاسم لا يمكن أن يكون فارغاً.")
        return

    if normalize_name(name) in streams:
        await message.answer("❌ هذا الاسم مستخدم لبث يعمل حالياً. أرسل اسماً آخر:")
        return

    await state.update_data(name=name)
    await state.set_state(StreamForm.source)
    await message.answer("🔗 أرسل رابط مصدر البث (HLS/HTTP أو رابط تدعمه FFmpeg):")


async def ask_facebook_key(message: Message, state: FSMContext):
    source = message.text.strip()

    if not source:
        await message.answer("❌ الرابط لا يمكن أن يكون فارغاً.")
        return

    await state.update_data(source=source)
    await state.set_state(StreamForm.facebook_key)
    await message.answer("🔑 أرسل Facebook Stream Key:")


async def receive_facebook_key(message: Message, state: FSMContext):
    fb_key = message.text.strip()

    if not fb_key:
        await message.answer("❌ المفتاح لا يمكن أن يكون فارغاً.")
        return

    await state.update_data(facebook_key=fb_key)
    await begin_stream(message, state)


async def ask_stop_name(message: Message, state: FSMContext):
    await state.clear()
    await state.set_state(StopForm.name)
    await message.answer("📺 أرسل اسم البث الذي تريد إيقافه:")


async def receive_stop_name(message: Message, state: FSMContext):
    name = message.text.strip()
    await state.clear()

    key = normalize_name(name)
    stream = streams.get(key)

    if not stream:
        await message.answer(
            f"❌ لا يوجد بث يعمل باسم: {name}",
            reply_markup=main_keyboard,
        )
        return

    await message.answer(f"⏹️ جاري إيقاف البث: {stream.name} ...")

    stopped = await stop_stream(name)

    if stopped:
        await message.answer(
            f"✅ تم إيقاف بث «{stream.name}» فقط.\n"
            "بقية البثوث تستمر بالعمل.",
            reply_markup=main_keyboard,
        )
    else:
        await message.answer(
            "❌ تعذر إيقاف البث؛ ربما انتهى بالفعل.",
            reply_markup=main_keyboard,
        )


async def cancel(message: Message, state: FSMContext):
    await state.clear()
    await message.answer("❌ تم إلغاء العملية.", reply_markup=main_keyboard)


async def on_start(message: Message, state: FSMContext):
    await state.clear()
    await message.answer(
        "👋 مرحباً بك\n\n"
        "اختر العملية:",
        reply_markup=main_keyboard,
    )


async def show_streams(message: Message):
    if not streams:
        await message.answer("📭 لا توجد بثوث تعمل حالياً.", reply_markup=main_keyboard)
        return

    lines = ["📡 البثوث الحالية:\n"]
    for stream in streams.values():
        status = "🟢 يعمل" if stream.process else "🟡 قيد المتابعة"
        lines.append(f"• {stream.name} — {status}")

    await message.answer("\n".join(lines), reply_markup=main_keyboard)


async def main():
    if BOT_TOKEN == "PUT_YOUR_TELEGRAM_BOT_TOKEN_HERE":
        raise RuntimeError(
            "ضع توكن البوت في المتغير BOT_TOKEN داخل bot.py أولاً."
        )

    bot = Bot(
        token=BOT_TOKEN,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    dp = Dispatcher()

    dp.message.register(on_start, CommandStart())

    dp.message.register(ask_stream_name, F.text == "🎯 SOLO")
    dp.message.register(ask_stream_name, F.text == "🔥 GROUP")
    dp.message.register(ask_stop_name, F.text == "🛑 STOP")

    dp.message.register(cancel, F.text.casefold() == "/cancel")
    dp.message.register(show_streams, F.text.casefold() == "/streams")

    dp.message.register(ask_source, StreamForm.name)
    dp.message.register(ask_facebook_key, StreamForm.source)
    dp.message.register(receive_facebook_key, StreamForm.facebook_key)

    dp.message.register(receive_stop_name, StopForm.name)

    print("Bot is running...")
    try:
        await dp.start_polling(bot)
    finally:
        # إيقاف كل عمليات FFmpeg عند إغلاق البوت
        for name in list(streams.keys()):
            await stop_stream(name)
        await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())
