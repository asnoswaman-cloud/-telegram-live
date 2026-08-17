import asyncio
import os
import signal
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

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
BOT_TOKEN = "PUT_YOUR_TELEGRAM_BOT_TOKEN_HERE"

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
    watch_task: Optional[asyncio.Task] = None


@dataclass
class StreamGroup:
    """مجموعة بثوث تعمل معاً"""
    name: str
    streams: List[Stream] = field(default_factory=list)
    is_running: bool = False


streams: Dict[str, Stream] = {}
groups: Dict[str, StreamGroup] = {}


class StreamForm(StatesGroup):
    name = State()
    source = State()
    facebook_key = State()


class GroupForm(StatesGroup):
    name = State()
    stream_name = State()
    stream_source = State()
    stream_facebook_key = State()
    confirm = State()


class StopForm(StatesGroup):
    name = State()


class StopGroupForm(StatesGroup):
    name = State()


main_keyboard = ReplyKeyboardMarkup(
    keyboard=[
        [KeyboardButton(text="🎯 SOLO")],
        [KeyboardButton(text="🔥 GROUP")],
        [KeyboardButton(text="🛑 STOP")],
        [KeyboardButton(text="📡 البثوث الحالية")],
    ],
    resize_keyboard=True,
)


def normalize_name(name: str) -> str:
    return " ".join(name.strip().split()).lower()


def facebook_rtmp_url(stream_key: str) -> str:
    """Facebook Live يقبل RTMPS. المفتاح يأتي من Facebook."""
    return f"rtmps://live-api-s.facebook.com:443/rtmp/{stream_key}"


async def start_ffmpeg(stream: Stream) -> None:
    """
    يشغل المصدر ويعيد بثه إلى Facebook.
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

    # انتظر قليلاً للتحقق من نجاح العملية
    await asyncio.sleep(2)
    if process.returncode is not None:
        # العملية فشلت فوراً
        if process.stderr:
            error_data = await process.stderr.read()
            error_msg = error_data.decode()[:300]
        else:
            error_msg = "Unknown error"
        raise Exception(f"FFmpeg failed to start: {error_msg}")

    async def watch_process():
        try:
            if process.stderr:
                while True:
                    line = await process.stderr.readline()
                    if not line:
                        break
                    print(f"[FFMPEG {stream.name}] {line.decode().strip()}")

            return_code = await process.wait()

            key = normalize_name(stream.name)
            current = streams.get(key)
            if current is stream:
                stream.process = None
                stream.watch_task = None

            print(f"[FFMPEG] {stream.name} ended. code={return_code}")
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"[FFMPEG ERROR] {stream.name}: {e}")

    # تخزين مرجع المهمة
    stream.watch_task = asyncio.create_task(watch_process())


async def stop_stream(name: str) -> bool:
    """إيقاف بث واحد"""
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
        try:
            await asyncio.wait_for(process.wait(), timeout=5)
        except asyncio.TimeoutError:
            pass
    except ProcessLookupError:
        pass

    stream.process = None
    if stream.watch_task:
        stream.watch_task.cancel()
    streams.pop(key, None)
    return True


async def stop_group(name: str) -> int:
    """إيقاف مجموعة بثوث كاملة، يعيد عدد البثوث المتوقفة"""
    key = normalize_name(name)
    group = groups.get(key)

    if not group:
        return 0

    stopped_count = 0
    for stream in group.streams:
        if await stop_stream(stream.name):
            stopped_count += 1

    group.is_running = False
    groups.pop(key, None)
    return stopped_count


# ============== دوال البث الفردي SOLO ==============

async def begin_solo_stream(message: Message, state: FSMContext):
    """بدء بث فردي"""
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


# ============== دوال البث الجماعي GROUP ==============

async def start_group(message: Message, state: FSMContext):
    """بدء إنشاء مجموعة بثوث"""
    await state.clear()
    await state.set_state(GroupForm.name)
    await message.answer(
        "🔥 إنشاء مجموعة بثوث\n\n"
        "ستقوم بإنشاء مجموعة تحتوي على عدة بثوث تعمل معاً.\n"
        "📺 أرسل اسم المجموعة:"
    )


async def receive_group_name(message: Message, state: FSMContext):
    """استقبال اسم المجموعة"""
    group_name = message.text.strip()

    if not group_name:
        await message.answer("❌ الاسم لا يمكن أن يكون فارغاً.")
        return

    group_key = normalize_name(group_name)
    if group_key in groups:
        await message.answer("❌ توجد مجموعة بهذا الاسم بالفعل. أرسل اسماً آخر:")
        return

    await state.update_data(group_name=group_name)
    await state.update_data(group_streams=[])
    await state.set_state(GroupForm.stream_name)
    await message.answer(
        f"✅ تم إنشاء المجموعة: {group_name}\n\n"
        "الآن أضف البثوث إلى المجموعة.\n"
        "📺 أرسل اسم البث الأول:"
    )


async def receive_group_stream_name(message: Message, state: FSMContext):
    """استقبال اسم البث داخل المجموعة"""
    stream_name = message.text.strip()

    if not stream_name:
        await message.answer("❌ الاسم لا يمكن أن يكون فارغاً.")
        return

    # التحقق من عدم وجود بث بنفس الاسم
    if normalize_name(stream_name) in streams:
        await message.answer("❌ هذا الاسم مستخدم لبث يعمل حالياً. أرسل اسماً آخر:")
        return

    # التحقق من عدم تكرار الاسم داخل المجموعة
    data = await state.get_data()
    group_streams = data.get("group_streams", [])
    for s in group_streams:
        if normalize_name(s["name"]) == normalize_name(stream_name):
            await message.answer("❌ يوجد بث بهذا الاسم في المجموعة. أرسل اسماً آخر:")
            return

    await state.update_data(current_stream_name=stream_name)
    await state.set_state(GroupForm.stream_source)
    await message.answer(f"🔗 أرسل رابط مصدر البث ({stream_name}):")


async def receive_group_stream_source(message: Message, state: FSMContext):
    """استقبال مصدر البث داخل المجموعة"""
    source = message.text.strip()

    if not source:
        await message.answer("❌ الرابط لا يمكن أن يكون فارغاً.")
        return

    await state.update_data(current_stream_source=source)
    await state.set_state(GroupForm.stream_facebook_key)
    await message.answer("🔑 أرسل Facebook Stream Key:")


async def receive_group_stream_key(message: Message, state: FSMContext):
    """استقبال مفتاح البث داخل المجموعة"""
    fb_key = message.text.strip()

    if not fb_key:
        await message.answer("❌ المفتاح لا يمكن أن يكون فارغاً.")
        return

    # إضافة البث إلى قائمة المجموعة
    data = await state.get_data()
    stream_name = data["current_stream_name"]
    stream_source = data["current_stream_source"]
    group_streams = data.get("group_streams", [])

    stream_data = {
        "name": stream_name,
        "source": stream_source,
        "facebook_key": fb_key,
    }
    group_streams.append(stream_data)
    await state.update_data(group_streams=group_streams)

    # عرض ملخص البثوث المضافة
    summary = "📋 البثوث المضافة إلى المجموعة:\n\n"
    for i, s in enumerate(group_streams, 1):
        summary += f"{i}. {s['name']}\n   📡 {s['source']}\n\n"

    summary += (
        f"إجمالي البثوث: {len(group_streams)}\n\n"
        "ماذا تريد أن تفعل؟\n"
        "1️⃣ أرسل /add لإضافة بث آخر\n"
        "2️⃣ أرسل /start لبدء تشغيل المجموعة\n"
        "3️⃣ أرسل /cancel للإلغاء"
    )

    await state.set_state(GroupForm.confirm)
    await message.answer(summary)


async def handle_group_confirm(message: Message, state: FSMContext):
    """معالجة أوامر المجموعة (إضافة/بدء/إلغاء)"""
    command = message.text.strip().lower()
    data = await state.get_data()
    group_streams = data.get("group_streams", [])
    group_name = data.get("group_name", "بدون اسم")

    if command == "/add":
        await state.set_state(GroupForm.stream_name)
        await message.answer(f"📺 أرسل اسم البث الجديد (البث رقم {len(group_streams) + 1}):")
        return

    elif command == "/start":
        if not group_streams:
            await message.answer("❌ لا توجد بثوث في المجموعة. أضف بثاً واحداً على الأقل.")
            return

        await begin_group_streams(message, state)
        return

    elif command == "/cancel":
        await state.clear()
        await message.answer("❌ تم إلغاء إنشاء المجموعة.", reply_markup=main_keyboard)
        return

    else:
        await message.answer(
            "❌ أمر غير معروف.\n"
            "استخدم:\n"
            "/add - لإضافة بث آخر\n"
            "/start - لبدء تشغيل المجموعة\n"
            "/cancel - للإلغاء"
        )
        return


async def begin_group_streams(message: Message, state: FSMContext):
    """بدء تشغيل جميع البثوث في المجموعة"""
    data = await state.get_data()
    group_name = data["group_name"].strip()
    group_streams = data.get("group_streams", [])

    group_key = normalize_name(group_name)

    # التحقق من عدم وجود مجموعة بنفس الاسم
    if group_key in groups:
        await message.answer("❌ توجد مجموعة بهذا الاسم تعمل بالفعل.")
        await state.clear()
        return

    # التحقق من عدد البثوث الإجمالي
    if len(streams) + len(group_streams) > MAX_GROUP_STREAMS:
        await message.answer(
            f"❌ عدد البثوث الإجمالي سيتجاوز الحد الأقصى ({MAX_GROUP_STREAMS}).\n"
            f"البثوث الحالية: {len(streams)}\n"
            f"بثوث المجموعة: {len(group_streams)}"
        )
        await state.clear()
        return

    # إنشاء كائنات البث وتشغيلها
    group = StreamGroup(name=group_name)
    successful_streams = []
    failed_streams = []

    await message.answer(f"🔥 جاري تشغيل مجموعة «{group_name}» ({len(group_streams)} بث)...")

    for stream_data in group_streams:
        stream = Stream(
            name=stream_data["name"],
            source_url=stream_data["source"],
            facebook_key=stream_data["facebook_key"],
        )

        stream_key = normalize_name(stream.name)

        if stream_key in streams:
            failed_streams.append((stream.name, "الاسم مستخدم بالفعل"))
            continue

        streams[stream_key] = stream

        try:
            await start_ffmpeg(stream)
            group.streams.append(stream)
            successful_streams.append(stream.name)
        except Exception as exc:
            streams.pop(stream_key, None)
            failed_streams.append((stream.name, str(exc)))

    await state.clear()

    # بناء رسالة النتيجة
    result_msg = f"📊 نتائج تشغيل المجموعة «{group_name}»:\n\n"

    if successful_streams:
        result_msg += "✅ البثوث الناجحة:\n"
        for name in successful_streams:
            result_msg += f"  • {name}\n"
        result_msg += "\n"

    if failed_streams:
        result_msg += "❌ البثوث الفاشلة:\n"
        for name, error in failed_streams:
            result_msg += f"  • {name}: {error}\n"
        result_msg += "\n"

    if successful_streams:
        group.is_running = True
        groups[group_key] = group
        result_msg += f"🛑 لإيقاف المجموعة كاملة اضغط STOP ثم أرسل: {group_name}"
    else:
        result_msg += "❌ فشل تشغيل جميع البثوث في المجموعة."

    await message.answer(result_msg, reply_markup=main_keyboard)


# ============== دوال الإيقاف ==============

async def ask_stop(message: Message, state: FSMContext):
    """سؤال المستخدم عما يريد إيقافه"""
    await state.clear()
    
    # إنشاء كيبورد خاص للإيقاف
    stop_keyboard = ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="⏹️ إيقاف بث واحد")],
            [KeyboardButton(text="⏹️ إيقاف مجموعة")],
            [KeyboardButton(text="⬅️ رجوع")],
        ],
        resize_keyboard=True,
    )
    
    await message.answer(
        "ماذا تريد أن توقف؟",
        reply_markup=stop_keyboard
    )


async def ask_stop_single(message: Message, state: FSMContext):
    """طلب اسم بث واحد للإيقاف"""
    await state.clear()
    await state.set_state(StopForm.name)
    
    # عرض البثوث الحالية
    if streams:
        active_streams = "\n".join([f"• {s.name}" for s in streams.values()])
        await message.answer(
            f"📡 البثوث الحالية:\n{active_streams}\n\n"
            "📺 أرسل اسم البث الذي تريد إيقافه:"
        )
    else:
        await message.answer("📭 لا توجد بثوث تعمل حالياً.", reply_markup=main_keyboard)
        return


async def ask_stop_group(message: Message, state: FSMContext):
    """طلب اسم مجموعة للإيقاف"""
    await state.clear()
    await state.set_state(StopGroupForm.name)
    
    # عرض المجموعات الحالية
    if groups:
        active_groups = "\n".join([f"• {g.name} ({len(g.streams)} بث)" for g in groups.values()])
        await message.answer(
            f"🔥 المجموعات الحالية:\n{active_groups}\n\n"
            "📺 أرسل اسم المجموعة التي تريد إيقافها:"
        )
    else:
        await message.answer("📭 لا توجد مجموعات تعمل حالياً.", reply_markup=main_keyboard)
        return


async def receive_stop_name(message: Message, state: FSMContext):
    """إيقاف بث واحد"""
    name = message.text.strip()
    await state.clear()

    stream = streams.get(normalize_name(name))

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
            f"✅ تم إيقاف بث «{stream.name}» بنجاح.",
            reply_markup=main_keyboard,
        )
    else:
        await message.answer(
            "❌ تعذر إيقاف البث؛ ربما انتهى بالفعل.",
            reply_markup=main_keyboard,
        )


async def receive_stop_group_name(message: Message, state: FSMContext):
    """إيقاف مجموعة كاملة"""
    name = message.text.strip()
    await state.clear()

    group = groups.get(normalize_name(name))

    if not group:
        await message.answer(
            f"❌ لا توجد مجموعة تعمل باسم: {name}",
            reply_markup=main_keyboard,
        )
        return

    await message.answer(f"⏹️ جاري إيقاف مجموعة «{group.name}» ({len(group.streams)} بث)...")

    stopped_count = await stop_group(name)

    if stopped_count > 0:
        await message.answer(
            f"✅ تم إيقاف مجموعة «{group.name}» بنجاح.\n"
            f"عدد البثوث المتوقفة: {stopped_count}",
            reply_markup=main_keyboard,
        )
    else:
        await message.answer(
            "❌ تعذر إيقاف المجموعة؛ ربما انتهت بالفعل.",
            reply_markup=main_keyboard,
        )


# ============== دوال عامة ==============

async def cancel(message: Message, state: FSMContext):
    await state.clear()
    await message.answer("❌ تم إلغاء العملية.", reply_markup=main_keyboard)


async def on_start(message: Message, state: FSMContext):
    await state.clear()
    await message.answer(
        "👋 مرحباً بك\n\n"
        "اختر العملية:\n"
        "🎯 SOLO - لتشغيل بث واحد\n"
        "🔥 GROUP - لتشغيل مجموعة بثوث معاً\n"
        "🛑 STOP - لإيقاف بث أو مجموعة\n"
        "📡 البثوث الحالية - لعرض كل البثوث",
        reply_markup=main_keyboard,
    )


async def show_streams(message: Message):
    """عرض جميع البثوث والمجموعات الحالية"""
    if not streams and not groups:
        await message.answer("📭 لا توجد بثوث تعمل حالياً.", reply_markup=main_keyboard)
        return

    lines = ["📡 الحالة الحالية:\n"]

    if groups:
        lines.append("🔥 المجموعات:")
        for group in groups.values():
            status = "🟢 يعمل" if group.is_running else "🟡 قيد المتابعة"
            lines.append(f"  • {group.name} ({len(group.streams)} بث) — {status}")
            for stream in group.streams:
                stream_status = "🟢" if stream.process else "🟡"
                lines.append(f"    {stream_status} {stream.name}")
        lines.append("")

    # البثوث الفردية (غير التابعة لمجموعة)
    solo_streams = []
    for stream in streams.values():
        # التحقق إذا كان البث تابعاً لمجموعة
        is_in_group = False
        for group in groups.values():
            if stream in group.streams:
                is_in_group = True
                break
        if not is_in_group:
            solo_streams.append(stream)

    if solo_streams:
        lines.append("🎯 البثوث الفردية:")
        for stream in solo_streams:
            status = "🟢 يعمل" if stream.process else "🟡 قيد المتابعة"
            lines.append(f"  • {stream.name} — {status}")

    lines.append(f"\n📊 إجمالي البثوث: {len(streams)}")

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

    # الأوامر الأساسية
    dp.message.register(on_start, CommandStart())

    # أزرار القائمة الرئيسية
    dp.message.register(ask_stream_name, F.text == "🎯 SOLO")
    dp.message.register(start_group, F.text == "🔥 GROUP")
    dp.message.register(ask_stop, F.text == "🛑 STOP")
    dp.message.register(show_streams, F.text == "📡 البثوث الحالية")
    dp.message.register(on_start, F.text == "⬅️ رجوع")

    # أوامر الإيقاف
    dp.message.register(ask_stop_single, F.text == "⏹️ إيقاف بث واحد")
    dp.message.register(ask_stop_group, F.text == "⏹️ إيقاف مجموعة")

    # أوامر عامة
    dp.message.register(cancel, F.text.casefold() == "/cancel")
    dp.message.register(show_streams, F.text.casefold() == "/streams")

    # حالات البث الفردي
    dp.message.register(ask_source, StreamForm.name)
    dp.message.register(ask_facebook_key, StreamForm.source)
    dp.message.register(receive_facebook_key, StreamForm.facebook_key)

    # حالات المجموعة
    dp.message.register(receive_group_name, GroupForm.name)
    dp.message.register(receive_group_stream_name, GroupForm.stream_name)
    dp.message.register(receive_group_stream_source, GroupForm.stream_source)
    dp.message.register(receive_group_stream_key, GroupForm.stream_facebook_key)
    dp.message.register(handle_group_confirm, GroupForm.confirm)

    # حالات الإيقاف
    dp.message.register(receive_stop_name, StopForm.name)
    dp.message.register(receive_stop_group_name, StopGroupForm.name)

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
