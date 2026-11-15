# Режимы в стиле Vice City: простые, которые я точно доделаю

Принцип, чтобы не тратить ваше время на генерацию зря:

1. Сначала я собираю **рабочий режим без вашего арта**: фон из уже загруженных сцен Vice City, всё остальное рисую кодом (SVG и CSS, как неоновые значки).
2. Вы смотрите, играете и говорите «да» или «поменяй механику».
3. Только потом вы генерируете картинки **для этого одного режима**. Число файлов небольшое (10–16), названия и размеры заданы точно, поэтому они встают без правок кода.

Каждый режим: один экран без карты, вся логика и награды на сервере, награды из реального каталога (то же окно выбора, что в «Розыске»), админка и кнопка в «Сезоне», тесты. Режимы независимы, можно делать любые по одному.

Азартность: «Скретч», «Колесо» и «Тайник» опираются на удачу. Я делаю их на бесплатные ежедневные попытки плюс попытки за шары, призы только из таблиц админа, суточные лимиты. Если режимы с удачей вам не нужны, берите «Сейфы», «Контракты» и «Викторину».

## Сводка

| № | Режим | Суть | Новых картинок | Сложность для меня |
|---|---|---|---|---|
| 1 | Сейфы | Подобрать код сейфа за 7 попыток | 13 | низкая |
| 2 | Скретч-карты | Стереть защитный слой, 3 одинаковых символа дают приз | 16 | низкая |
| 3 | Тайник на пляже | Копать клетки: добыча или полиция, забрать можно в любой момент | 14 | низкая |
| 4 | Колесо Diamond | Крутить колесо с призами из каталога | 11 | очень низкая |
| 5 | Контракты | Отправить команду на дело на несколько часов, потом забрать награду | 14 | низкая |
| 6 | Викторина «Радио» | 5 вопросов в день на время, серия даёт больше | 14 | низкая |

Мои рекомендации по порядку: **Колесо**, **Сейфы**, **Контракты**. Они самые чистые по логике и красиво смотрятся без сложной вёрстки.

---

## 1. Сейфы

**Игра.** В городе три сейфа в день: лёгкий (3 цифры), средний (4), сложный (5). У каждого 7 попыток. После попытки сервер говорит, сколько цифр на своём месте и сколько цифр есть, но стоят не там (как «Быки и коровы»). Код сервер загадывает при первом открытии и не присылает до конца игры. Угадал: награда уровня. Не угадал: сейф закрыт до завтра. Неделя: топ «Взломщики» по очкам (уровень сейфа + оставшиеся попытки).

**Что делаю я.** Таблицы, правила, антиповтор (одна попытка не засчитывается дважды), страница с кодовой панелью и историей попыток, админка с наградами по уровням и призами недели, тесты на повторяющиеся цифры и жульничество.

**Какие картинки нужны.** Сейф закрытый и открытый, ручка замка, добыча (пачка денег, слиток, камень), два значка, три баннера. Фон я возьму из загруженных сцен.

### Промпт (сейфы)

Общий блок стиля вставьте из раздела «Общий блок» внизу, затем:

```
Create an asset pack for the mode "Vice City Safes" (cracking a vault code). Output each image as a separate file with the exact name and size. All object images are transparent PNG, centered, with 6% empty margin. No text, no numbers, no letters on any image.

safe/safe_door.png 1024x1024: a round steel vault door seen straight from the front, thick rim, big bolts, brass and teal neon trim in the Vice City palette, with an EMPTY flat round plate in the center where a code dial will be placed by code (leave the center plain, no marks).
safe/safe_open.png 1024x1024: the same vault door swung open, inside is a glowing pile of cash, gold bars and a pink diamond.
safe/dial_knob.png 512x512: a chunky chrome dial knob with a small gold pointer notch, glossy.
safe/cash_stack.png 384x384: a stack of green cash with a pink band.
safe/gold_bar.png 384x384: three stacked gold bars.
safe/gem_pink.png 384x384: a large faceted pink-and-violet diamond.
safe/i_lock.png 256x256: a gold padlock, closed.
safe/i_key.png 256x256: a gold key with a palm-leaf head.
safe/bg_vault.webp 1600x1000: no characters, a neon-lit vault room interior, dark violet walls, steel shelves, pink and cyan light, calm area in the center-left for UI.
safe/bg_vault_mobile.webp 1200x1400: the same room, vertical crop.
safe/banner_wide.webp 2400x1000: the vault door and a pile of loot on the right, the left 45% calm for a title.
safe/banner_mobile.webp 1200x1400: the same, title area on top.
safe/hub_card.webp 1600x800: same scene, title area on the left.
```

---

## 2. Скретч-карты

**Игра.** Билет с 9 закрытыми окошками. Игрок стирает защитный слой пальцем (canvas), под ним символы. Три одинаковых символа дают приз, чем реже символ, тем больше приз. Исход определяет сервер при покупке билета, клиент только рисует его. Один бесплатный билет в день, дальше за шары, суточный лимит.

**Что делаю я.** Серверная раскладка символов с заданными шансами из админки, защита от повторного стирания (билет считается один раз), canvas-стирание с эффектом фольги, вспышка при выигрыше, админка с таблицей призов, тесты на корректность раскладки (нет выигрыша там, где его не должно быть).

**Картинки.** Рамка билета, фольга, 8 символов, вспышка, баннеры.

### Промпт (скретч)

```
Create an asset pack for the mode "Vice City Scratch Cards". Transparent PNG for objects, exact names and sizes, centered, 6% margin, no text, no numbers, no letters.

scratch/card_frame.png 900x1200: a lottery ticket frame in the Vice City palette, rounded corners, pink and cyan neon trim, with a plain empty 3x3 grid area in the middle (nine rounded empty windows, leave them flat dark, no symbols).
scratch/foil.png 512x512: a seamless tileable silver-pink scratch-off foil texture with a fine metallic grain, fully opaque.
scratch/sym_car.png, sym_palm.png, sym_diamond.png, sym_cash.png, sym_flamingo.png, sym_shades.png, sym_sunset.png, sym_star.png, each 256x256: eight glossy game symbols in one consistent style (a pink sports car, a palm tree, a faceted diamond, a banknote stack, a flamingo, sunglasses, a sunset circle, a golden star).
scratch/win_burst.png 1024x1024: a radial golden light burst with sparkles, transparent.
scratch/bg.webp 1600x1000 and scratch/bg_mobile.webp 1200x1400: a neon street at dusk, calm center, no characters.
scratch/banner_wide.webp 2400x1000, banner_mobile.webp 1200x1400, hub_card.webp 1600x800: a hand holding a scratch ticket with a coin, title area on the left (wide) or top (mobile).
```

---

## 3. Тайник на пляже

**Игра.** Поле 5 на 5 клеток песка. Под клетками добыча (деньги, слитки, камни, сундук) и «полиция». Игрок копает клетку за клеткой. Каждая добыча увеличивает множитель, полиция заканчивает игру и забирает половину накопленного. Забрать добычу можно в любой момент. Число полицейских клеток выбирает игрок (чем больше, тем выше множитель). Раскладка сервера, клиент не знает, что под клеткой, пока её не откопали.

**Что делаю я.** Серверная раскладка и проверка каждого хода, множители, выплата только через общий механизм наград, анимация раскопки на CSS, админка (размер поля, множители, лимиты), тесты на честность раскладки и невозможность отката хода.

**Картинки.** Песок, раскопанная клетка, четыре вида добычи, полиция, лопата, фон, баннеры.

### Промпт (тайник)

```
Create an asset pack for the mode "Vice City Beach Stash". Transparent PNG for objects, exact names and sizes, centered, 6% margin, no text.

beach/tile_sand.png 256x256: a square sand tile with a small shovel mark and a glossy rim, top-down 2.5D.
beach/tile_dug.png 256x256: the same tile dug out, a darker hollow with sand edges.
beach/item_cash.png, item_gold.png, item_gem.png, item_chest.png, each 256x256: loot icons (cash stack, gold bar, pink diamond, small treasure chest) in one glossy style.
beach/police.png 256x256: a cartoon police car with red and blue lights, top-down angle.
beach/i_shovel.png 256x256: a shovel stuck in sand.
beach/burst.png 512x512: a golden sparkle burst, transparent.
beach/bg.webp 1600x1000 and beach/bg_mobile.webp 1200x1400: a Vice City beach at sunset, palms, ocean, calm center-left, no characters.
beach/banner_wide.webp 2400x1000, banner_mobile.webp 1200x1400, hub_card.webp 1600x800: a shovel, loot, and a police car in the distance, title area free.
```

---

## 4. Колесо Diamond

**Игра.** Колесо с 8 секторами из каталога наград. Одна бесплатная прокрутка в день, дополнительные за шары (цена и лимит в админке). Результат определяет сервер по шансам секторов, колесо просто красиво к нему подкручивается. Джекпот сектор редкий. Секторы рисует сам код из картинок наград, поэтому арт нужен только для рамки.

**Что делаю я.** Колесо на SVG с плавным разгоном и торможением, подсветка выигрыша, лампочки по ободу, шансы и призы в админке, суточные лимиты, тесты на распределение и на невозможность повторной прокрутки одной попытки.

**Картинки.** Обод, ступица, указатель, лампочки, вспышка, фоны, баннеры. Всего 11 файлов.

### Промпт (колесо)

```
Create an asset pack for the mode "Diamond Wheel" (a prize wheel in a neon Vice City casino). Transparent PNG for objects, exact names and sizes, centered, no text, no numbers.

wheel/rim.png 1200x1200: a glossy round wheel rim with a hollow transparent center (the segments are drawn by code), chrome and pink neon, small round lamp sockets evenly spaced on the rim.
wheel/hub.png 400x400: a chrome-and-gold center cap, glossy.
wheel/pointer.png 256x256: a gold arrow pointer pointing down, jeweled.
wheel/lamp_on.png and wheel/lamp_off.png 128x128: a round bulb, lit warm yellow and unlit dark.
wheel/jackpot_burst.png 1024x1024: a golden light burst with confetti, transparent.
wheel/bg.webp 1600x1000 and wheel/bg_mobile.webp 1200x1400: a neon casino hall, dark violet, bokeh lights, calm center, no characters.
wheel/banner_wide.webp 2400x1000, banner_mobile.webp 1200x1400, hub_card.webp 1600x800: a glowing wheel with a diamond, title area free.
```

---

## 5. Контракты

**Игра.** Игрок отправляет команду (Гошан и Николай) на «дело» на несколько часов. Дел шесть, у каждого своя длительность, награда и риск (шанс неудачи). Пока команда занята, можно заходить и проверять таймер. По завершении игрок забирает награду. Улучшения команды (быстрее, безопаснее) за шары. Это спокойный режим, который игрок открывает по несколько раз в день.

**Что делаю я.** Таблицы заданий с таймерами на сервере, расчёт по времени (не зависит от клиента), награды и шансы в админке, страница с карточками дел, таймерами и кнопкой «Забрать», тесты на время и на однократную выдачу.

**Картинки.** Шесть иллюстраций дел, команда в трёх позах, иконки, фон, баннеры.

### Промпт (контракты)

```
Create an asset pack for the mode "Vice City Contracts" (a crew takes jobs and returns with a reward). No weapons, no violence, no text. Exact names and sizes.

jobs/job_courier.webp, job_race.webp, job_club.webp, job_yacht.webp, job_port.webp, job_photo.webp, each 768x512: six scenes (a courier delivery on a scooter, a street race at night, guarding a neon club entrance, a yacht party at sunset, loading crates in a port, a fashion photo shoot on the beach), one consistent cartoon style, bright and clean.
jobs/crew_goshan_idle.png and crew_nikolay_idle.png 900x1200: the two characters standing, transparent (use the attached character references).
jobs/crew_goshan_back.png and crew_nikolay_back.png 900x1200: the same characters returning with a bag of cash, cheerful, transparent.
jobs/crew_goshan_fail.png 900x1200: Goshan worried, transparent.
jobs/i_timer.png, i_risk.png, i_cash.png 256x256: a stopwatch, a warning triangle with a flame, a cash roll.
jobs/bg.webp 1600x1000 and bg_mobile.webp 1200x1400: a Vice City street at dusk, calm center, no characters.
jobs/banner_wide.webp 2400x1000, banner_mobile.webp 1200x1400, hub_card.webp 1600x800: the two characters with a city skyline, title area free.
```

---

## 6. Викторина «Радио Vice City»

**Игра.** Пять вопросов в день, 20 секунд на каждый, четыре варианта. Серия правильных ответов повышает награду. Вопросы вводит админ (текст, четыре варианта, правильный). Недельный топ по очкам: правильные ответы плюс быстрота. Сервер проверяет ответ и считает время сам, клиент таймер только показывает.

**Что делаю я.** Таблицы вопросов, выдача случайных пяти без повторов за неделю, проверка ответа и времени на сервере, анимации правильно и неправильно, админка со списком вопросов и импортом из текста, тесты на подсказки (правильный ответ не уходит клиенту заранее).

**Картинки.** Студия, микрофон, виниловая пластинка, рамка вопроса, четыре состояния кнопки ответа, кольцо таймера, огонёк серии.

### Промпт (викторина)

```
Create an asset pack for the mode "Radio Vice City Quiz". Transparent PNG for objects, exact names and sizes, no text, no numbers, no letters.

quiz/mic.png 512x512: a retro radio microphone, chrome, pink neon.
quiz/vinyl.png 512x512: a glossy vinyl record with a pink label, top-down (it will be rotated by code).
quiz/question_frame.png 1200x600: a retro radio display frame, rounded, neon trim, an empty dark screen area in the middle.
quiz/answer_idle.png, answer_selected.png, answer_correct.png, answer_wrong.png, each 1000x160: four states of a wide rounded button in the same shape: dark violet, cyan outlined, green, red.
quiz/timer_ring.png 512x512: a thin glossy ring with a small gap, transparent center (it will be animated by code).
quiz/flame.png 256x256: a streak flame, pink to gold.
quiz/bg.webp 1600x1000 and bg_mobile.webp 1200x1400: a radio studio at night, mixing desk, neon sign without letters, calm center, no characters.
quiz/banner_wide.webp 2400x1000, banner_mobile.webp 1200x1400, hub_card.webp 1600x800: a microphone and a vinyl record, title area free.
```

---

## Общий блок стиля (вставляется перед каждым промптом)

```
Style: premium mobile-game UI art for the app Crafter, Vice City mood. Smooth glossy 2.5D cartoon, crisp consistent rounded dark outlines (#14052e), broad clean gradient shading, soft white specular highlights, no painterly noise, no hand-drawn wobble, no blur. Palette: hot pink #ff4fa8, cyan #27d3ff, violet #8a45ff, gold #ffc83a, deep night #14052e, card violet #2b1252. Sharp edges, perfectly clean silhouettes, consistent light from the top-left. Backgrounds without text or logos. No watermarks. Attach 3-4 images from the earlier Vice archive (vice_wanted_assets) as the style reference and keep the same look.
Deliver: one file per asset with the exact name and size, PNG with real transparency for objects (no fake checkerboard), WebP for backgrounds and banners, sRGB, no upscaling.
```
