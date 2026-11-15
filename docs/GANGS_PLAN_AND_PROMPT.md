# Войны банд: Гошан против Николая (Vice City)

Раз в неделю идёт война двух банд. Игрок вступает в одну из них, а очки банде приносят обычные действия в приложении. Всё, что нужно для работы, я собираю на уже загруженных картинках «Розыска»: их стиль (Гошан в бирюзовой гавайке, Николай в розовой) тот, на который опираемся. Ниже: как работает режим и промпт на **недостающие** картинки (55 файлов). Подставятся без правок кода.

## Как это работает

* Две банды: **Гошан** (бирюзовый и фиолетовый) и **Николай** (розовый и оранжевый). Названия, девизы и цвета можно менять в админке.
* Война идёт с понедельника 00:00 до воскресенья 24:00 по Москве. Банду выбираешь один раз и можешь сменить, пока ещё не набрал очков в текущей войне.
* Очки даёт то же, что и в «Розыске»: раунды арены, открытые паки, апгрейды, крафты, покупки, продажи. Чтобы один богатый игрок не решал войну, в сутки на игрока есть потолок очков (по умолчанию 300).
* Если в одной банде игроков заметно больше, меньшая банда получает множитель очков (до ×1,5), чтобы война была честной.
* **Шесть районов**, каждый связан с действием:
  * Оушен-Бич: открытые паки,
  * Даунтаун: арена,
  * Малая Гавана: апгрейды,
  * Порт: крафт,
  * Стар-Айленд: магазин и рынок,
  * Вайс-Пойнт: цепочки и бесплатные награды.
  Район отходит той банде, у которой в нём больше очков.
* В конце недели сервер сам подводит итог. Каждый игрок забирает награду кнопкой «Забрать»: за победу или утешительную, за каждый район своей банды, за личный уровень вклада и места в общем топе. Все призы из реального каталога и настраиваются в админке.
* Личный ранг по очкам: Новичок, Бегун, Водила, Авторитет, Легенда.
* На странице: шкала «перетягивания каната» между бандами, отсчёт до конца войны, шесть карточек районов, выбор банды, мой вклад, топ, награды.

## Что нужно сгенерировать (55 файлов)

Вставьте сначала общий блок стиля, затем нужные куски. Всё, что объект, PNG с настоящей прозрачностью. Фоны и баннеры WebP. Никакого текста, цифр и букв на картинках.

### Общий блок стиля

```
Style: premium mobile-game UI art for the app Crafter, Vice City mood, the SAME look as the attached references (the characters Goshan, a boy with orange hair, sunglasses, teal Hawaiian shirt, purple shorts, pink and cyan sneakers, and Nikolay, an orange orangutan with sunglasses on his head, pink Hawaiian shirt, purple shorts, white sneakers). Smooth glossy 2.5D cartoon, crisp consistent rounded dark outlines, broad clean gradient shading, soft white specular highlights, no painterly noise, no hand-drawn wobble. Keep the faces, proportions and outfits identical to the references.
Gang colors: GOSHAN gang = cyan #27d3ff with violet #8a45ff. NIKOLAY gang = hot pink #ff4fa8 with orange #ff8a3c. Shared: gold #ffc83a, deep night #14052e, card violet #2b1252.
Strictly non-violent: no weapons, no blood, no fighting. The rivalry is shown with spray paint, boomboxes, cars, flags and neon.
No text, no numbers, no letters anywhere. No watermarks. Real transparency for objects (not a fake checkerboard). sRGB. No upscaling. One file per asset, exact name and size.
```

### Заставки и баннеры

```
gangs/versus_wide.webp 2400x1000: a night Vice City street split by neon light, Goshan on the left in a cyan-lit pose, Nikolay on the right in a pink-lit pose, facing each other with friendly rivalry, a clash spark between them in the center, palms and city strip behind. The center top is calm for a title.
gangs/versus_mobile.webp 1200x1400: the same scene in a vertical crop, the characters smaller, title area on top.
gangs/hub_card.webp 1600x800: the same rivalry scene, the title area on the left third calm.
gangs/bg.webp 1600x1000 and gangs/bg_mobile.webp 1200x1400: a night street background lit cyan on the left half and pink on the right half, no characters, calm center, no text.
```

### Эмблемы, флаги, награды

```
gangs/emblem_goshan.png 512x512: a round gang crest, cyan and violet, a pair of sunglasses and a palm leaf, chrome rim, glossy.
gangs/emblem_nikolay.png 512x512: a round gang crest, pink and orange, a pair of sunglasses and a banana leaf, chrome rim, glossy.
gangs/flag_goshan.png 600x900 and gangs/flag_nikolay.png 600x900: tall waving flags on a pole in each gang color with the matching crest in the center.
gangs/chest_goshan.png 512x512 and gangs/chest_nikolay.png 512x512: a rewards crate in each gang color with a gold lock, glossy.
gangs/crown_gold.png 256x256: a gold crown with a pink and cyan gem.
gangs/ribbon_victory_goshan.png and gangs/ribbon_victory_nikolay.png 1600x400: a wide victory ribbon with confetti in each gang color, the center plain for text.
gangs/ribbon_defeat.png 1600x400: a wide gray-violet ribbon, calm, the center plain for text.
```

### Персонажи (новые позы, по 900x1200, прозрачные)

```
gangs/goshan_crossed.png and gangs/nikolay_crossed.png: arms crossed, confident smile, a small gang crest on the chest.
gangs/goshan_recruit.png and gangs/nikolay_recruit.png: a hand reaching toward the viewer inviting to join, friendly smile.
gangs/goshan_cheer.png and gangs/nikolay_cheer.png: arms up, victory, confetti-free.
gangs/goshan_sad.png and gangs/nikolay_sad.png: disappointed but cute, slumped shoulders.
```

### Районы (6 штук)

```
gangs/district_beach.webp, district_havana.webp, district_downtown.webp, district_port.webp, district_island.webp, district_point.webp, each 1200x700: six wide scene illustrations, no characters, no text, in one consistent style:
beach: Ocean Beach at sunset, palms, boardwalk, a pack-shaped neon sign without letters.
havana: Little Havana, a garage street with colorful cars and string lights.
downtown: Downtown, tall neon towers and an arena entrance with spotlights.
port: the Port, cranes, containers, a workshop with sparks.
island: Starfish Island, a luxury mansion with a pool and a mall glow.
point: Vice Point, a lighthouse, a gift stand and a market stall.
gangs/di_beach.png, di_havana.png, di_downtown.png, di_port.png, di_island.png, di_point.png, each 256x256: matching round icons.
gangs/frame_goshan.png, frame_nikolay.png, frame_neutral.png, each 1200x700: transparent frame overlays for the district cards, a neon border with small flag corners in cyan, pink, and neutral gold.
```

### Шкала противостояния и значки

```
gangs/tug_frame.png 2000x200: a wide horizontal bar frame, chrome with neon, the inside transparent, a small notch in the center.
gangs/spark.png 256x256: a bright clash spark at the center point, pink and cyan, transparent.
gangs/i_spray.png, i_boombox.png, i_turf.png, each 256x256: a spray can, a boombox, a turf flag, glossy icons.
```

### Ранги (по 256x256 для каждой банды)

```
gangs/rank_goshan_1.png ... rank_goshan_5.png and gangs/rank_nikolay_1.png ... rank_nikolay_5.png: five rank badges for each gang, rising in grandeur: 1 Rookie (a plain round badge), 2 Runner (a sneaker with wings), 3 Driver (a steering wheel), 4 Boss (a crown of sunglasses), 5 Legend (a full golden crest with laurels). Cyan and violet for Goshan, pink and orange for Nikolay, same shapes in both.
```

### Сцены вступления (необязательно, красиво)

```
gangs/join_goshan.webp 1400x900 and gangs/join_nikolay.webp 1400x900: a gang hangout scene for each side without characters: Goshan's rooftop pool at night in cyan and violet; Nikolay's neon garage with a pink car in pink and orange.
```

## Как будет выглядеть работа

1. Сейчас я собираю прототип на уже загруженных картинках «Розыска»: персонажи, фоны, значки, медали, рамки. Он полностью играбелен.
2. Когда вы пришлёте этот архив, я подставлю его по названиям, код менять не придётся.
3. Если часть файлов не будет готова, режим не сломается: вместо них останутся запасные картинки.
