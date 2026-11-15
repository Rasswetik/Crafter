"""Telegram-бот проверки отзывов. Работает на общей базе с мини-приложением (core.py)."""
import asyncio
import html
import logging
import os
import time

from telegram import (InlineKeyboardButton, InlineKeyboardMarkup, MenuButtonWebApp, ReplyKeyboardRemove, Update,
                      WebAppInfo)
from telegram.constants import ParseMode
from telegram.ext import (Application, CallbackQueryHandler, CommandHandler, ContextTypes, MessageHandler, filters)

import core

PAGE = 5
BTN_FIND, BTN_OK, BTN_BAD = "🔍 Найти отзыв", "✅ Найденные отзывы", "❌ Не найденные отзывы"
BTN_SET, BTN_MENU, BTN_APP = "⚙️ Настройки", "🏠 Меню", "📱 Открыть мини-приложение"
MENU_TEXT = "Что делаем? 👇"
H = ParseMode.HTML
e = html.escape


def webapp_url():
    u = (os.environ.get("WEBAPP_URL") or "").strip().rstrip("/")
    return u if u.startswith("https://") else ""


def btn(label, data):
    return InlineKeyboardButton(label, callback_data=data)


def menu_kb():
    rows = []
    if webapp_url():
        rows.append([InlineKeyboardButton(BTN_APP, web_app=WebAppInfo(url=webapp_url()))])
    rows += [[btn(BTN_FIND, "m:find")], [btn(BTN_OK, "m:found"), btn(BTN_BAD, "m:bad")], [btn(BTN_SET, "m:set")]]
    return InlineKeyboardMarkup(rows)


def back_row():
    return [btn(BTN_MENU, "m:menu")]


def touch(update: Update):
    u = update.effective_user
    core.upsert_user(u.id, u.first_name, u.username)
    return u.id


def verdict_text(it):
    st = {"found": "✅ <b>Отзыв найден</b>", "similar": "🟡 <b>Найден похожий отзыв</b>",
          "not_found": "❌ <b>Отзыв не найден</b>"}[it["verdict"]]
    t = e(it["text"][:300] + ("…" if len(it["text"]) > 300 else ""))
    s = f"{st}\n\n🏪 {e(it['store'])} · <b>{e(it['app_name'])}</b>\n"
    if it.get("review_date"):
        s += f"📅 {it['review_date']}\n"
    s += f"💬 <i>{t}</i>\n\n📊 Совпадение: <b>{round((it['score'] or 0) * 100)}%</b> · проверено отзывов: {it['checked']}"
    if it["verdict"] == "not_found":
        s += ("\n\nℹ️ Apple отдаёт не все отзывы и с задержкой." if it["store"] == "App Store"
              else "\n\nℹ️ Среди последних отзывов такого нет.")
    elif it.get("matched_author"):
        s += f"\n👤 Автор: {e(it['matched_author'])}"
    return s


# ---------- хендлеры ----------
async def start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    touch(update)
    tmp = await update.message.reply_text("…", reply_markup=ReplyKeyboardRemove())  # убрать старую клавиатуру
    await tmp.delete()
    await update.message.reply_text(
        f"👋 Привет, <b>{e(update.effective_user.first_name or '')}</b>!\n\n"
        "Я проверяю, опубликован ли отзыв в <b>App Store</b> и <b>Google Play</b>.\n\n"
        "Нажми «🔍 Найти отзыв» и отправь скриншот. Магазин и приложение я определю сам, найду отзыв и пришлю ссылку.",
        parse_mode=H, reply_markup=menu_kb())


async def on_image(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    m = update.message
    uid = touch(update)
    f = m.photo[-1] if m.photo else m.document
    status = await m.reply_text("🔎 Ищу отзыв…\n▫️ Читаю скриншот")
    again = [btn(BTN_FIND, "m:find"), btn(BTN_MENU, "m:menu")]
    try:
        data = bytes(await (await f.get_file()).download_as_bytearray())
        scan = await asyncio.to_thread(core.scan_image, data)
        if not scan.get("app_name") or not scan.get("review_text"):
            await status.edit_text("😕 Не смог прочитать текст на скриншоте. Пришлите более чёткий, чтобы были "
                                   "видны название приложения и текст отзыва.", reply_markup=InlineKeyboardMarkup([again]))
            return
        await status.edit_text("🔎 Ищу отзыв…\n✔️ Скриншот прочитан\n▫️ Ищу в магазине")
        it = await asyncio.to_thread(core.run_check, uid, scan["app_name"], scan["review_text"], scan["store"],
                                     scan.get("date"), scan.get("rating"), scan.get("thumb"), "bot")
    except core.CheckError as ex:
        await status.edit_text("⚠️ " + e(str(ex)), parse_mode=H, reply_markup=InlineKeyboardMarkup([again]))
        return
    except Exception:  # noqa
        logging.exception("process")
        await status.edit_text("⚠️ Что-то пошло не так. Попробуйте ещё раз.", reply_markup=InlineKeyboardMarkup([again]))
        return
    rows = []
    if it["found"] and it.get("review_url"):
        rows.append([InlineKeyboardButton("🔗 Открыть отзыв" if it["store"] == "Google Play" else "🔗 Отзывы приложения",
                                          url=it["review_url"])])
    if webapp_url():
        rows.append([InlineKeyboardButton("📱 Подробнее в мини-приложении", web_app=WebAppInfo(url=webapp_url()))])
    rows.append(again)
    await status.edit_text(verdict_text(it), parse_mode=H, reply_markup=InlineKeyboardMarkup(rows),
                           disable_web_page_preview=True)


def list_page(uid, found, page):
    total = core.count_checks(uid, found)
    rows = core.list_checks(uid, found, limit=PAGE, offset=page * PAGE)
    title = BTN_OK if found else BTN_BAD
    if not total:
        return f"<b>{title}</b>\n\nПока пусто. Нажмите «{BTN_FIND}».", InlineKeyboardMarkup([back_row()])
    out = [f"<b>{title}</b> ({total})\n"]
    for i, r in enumerate(rows, page * PAGE + 1):
        t = e(r["text"][:110] + ("…" if len(r["text"]) > 110 else ""))
        link = f' · <a href="{e(r["review_url"])}">открыть</a>' if found and r.get("review_url") else ""
        out.append(f"{i}. <b>{e(r['app_name'])}</b> · {e(r['store'])}\n"
                   f"   {time.strftime('%d.%m.%Y', time.localtime(r['created']))} · {round((r['score'] or 0) * 100)}%{link}\n"
                   f"   <i>{t}</i>\n")
    k = "f" if found else "n"
    nav = []
    if page > 0:
        nav.append(btn("◀️", f"l:{k}:{page - 1}"))
    if (page + 1) * PAGE < total:
        nav.append(btn("▶️", f"l:{k}:{page + 1}"))
    kb = ([nav] if nav else []) + [[btn("🗑 Очистить", f"c:{k}"), btn(BTN_MENU, "m:menu")]]
    return "\n".join(out), InlineKeyboardMarkup(kb)


def settings_view(uid):
    cur = core.get_country(uid)
    kb = [[btn(("✔️ " if c[0] == cur else "") + f"{c[2]} {c[1]}", f"s:{c[0]}")] for c in core.COUNTRIES] + [back_row()]
    return "⚙️ <b>Страна магазина</b>\nОтзывы ищутся в магазине этой страны.", InlineKeyboardMarkup(kb)


async def on_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    uid = touch(update)
    kind, *a = q.data.split(":")
    if kind == "m":
        if a[0] == "menu":
            await q.edit_message_text(MENU_TEXT, reply_markup=menu_kb())
        elif a[0] == "find":
            await q.edit_message_text("📸 <b>Отправьте скриншот отзыва</b>\nМожно сразу несколько, по одному на сообщение.",
                                      parse_mode=H, reply_markup=InlineKeyboardMarkup([back_row()]))
        elif a[0] in ("found", "bad"):
            text, kb = list_page(uid, a[0] == "found", 0)
            await q.edit_message_text(text, parse_mode=H, reply_markup=kb, disable_web_page_preview=True)
        elif a[0] == "set":
            text, kb = settings_view(uid)
            await q.edit_message_text(text, parse_mode=H, reply_markup=kb)
    elif kind == "l":
        text, kb = list_page(uid, a[0] == "f", int(a[1]))
        await q.edit_message_text(text, parse_mode=H, reply_markup=kb, disable_web_page_preview=True)
    elif kind == "c":
        kb = InlineKeyboardMarkup([[btn("Да, очистить", f"cc:{a[0]}"), btn("Отмена", f"l:{a[0]}:0")]])
        await q.edit_message_text("Удалить все отзывы из этого списка?", reply_markup=kb)
    elif kind == "cc":
        core.clear_checks(uid, a[0] == "f")
        await q.edit_message_text("🗑 Список очищен.", reply_markup=InlineKeyboardMarkup([back_row()]))
    elif kind == "s":
        core.set_country(uid, a[0])
        _, kb = settings_view(uid)
        await q.edit_message_reply_markup(kb)
        await q.answer("Сохранено")
        return
    await q.answer()


async def fallback(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    touch(update)
    await update.message.reply_text("Отправьте скриншот отзыва или выберите действие 👇", reply_markup=menu_kb())


async def post_init(app: Application):
    # Если у токена включён вебхук (бот подключён к другому сервису), опрос getUpdates не работает: сообщения уходят туда.
    info = await app.bot.get_webhook_info()
    if info.url:
        if os.environ.get("TAKE_OVER_WEBHOOK") == "1":
            await app.bot.delete_webhook()
            logging.warning("Вебхук %s отключён, бот теперь работает через опрос.", info.url)
        else:
            logging.error("С токеном связан ВЕБХУК на %s. Сообщения уходят туда, а не в этот бот. Перевыпустите токен в "
                          "@BotFather (/revoke) или поставьте TAKE_OVER_WEBHOOK=1 в .env.", info.url)
    if webapp_url():  # кнопка мини-приложения рядом с полем ввода
        await app.bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text="Проверка", web_app=WebAppInfo(url=webapp_url())))


def build_application(token):
    app = Application.builder().token(token).concurrent_updates(True).post_init(post_init).build()
    app.add_handler(CommandHandler(["start", "help", "menu"], start))
    app.add_handler(MessageHandler(filters.PHOTO | filters.Document.IMAGE, on_image))
    app.add_handler(CallbackQueryHandler(on_cb))
    app.add_handler(MessageHandler(filters.ALL & ~filters.COMMAND, fallback))
    return app
