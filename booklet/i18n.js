// Перевод интерфейса. Исходный язык — русский: строки в коде остаются русскими, а словарь EN
// превращает их в английские. Работает в окне (переводит всё, что появляется в DOM)
// и в основном процессе Electron (журнал, диалоги): require('../booklet/i18n.js').
// {0}, {1}… — места для чисел и названий; найденное там тоже переводится, если есть в словаре.
// Элементы с translate="no" (названия глав, файлов, ввод пользователя) не трогаются.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.I18N = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const EN = {
    // ---------- Шапка и общие ----------
    'MangaForge 2 — печать книг': 'MangaForge 2 — book printing',
    'Печать книг и манги тетрадями': 'Print books and manga as folded booklets',
    'Открыть PDF': 'Open PDF',
    'Журнал': 'Log',
    'Журнал · {0}': 'Log · {0}',
    'Скачать PDF для печати': 'Download PDF for printing',
    'Дизайн': 'Design',
    'Светлая или тёмная': 'Light or dark',
    'Язык': 'Language',
    'Стол переплётчика': 'Bookbinder’s desk',
    'Печатный цех': 'Print shop',
    'Строгий': 'Strict',
    'Классика': 'Classic',
    'Как в системе': 'System',
    'Светлая': 'Light',
    'Тёмная': 'Dark',
    'Закрыть': 'Close',
    'Работаю…': 'Working…',
    'Отпустите, чтобы открыть PDF': 'Drop to open',
    'нет': 'none',
    'Авто': 'Auto',
    'пусто': 'blank',
    'и': 'and',
    'мм': 'mm',
    '{0} мм': '{0} mm',
    '{0} КБ': '{0} KB',
    '{0} МБ': '{0} MB',
    '{0}, {1}': '{0}, {1}',
    '{0} · {1}': '{0} · {1}',
    'Схема тетради {0}': 'Diagram of signature {0}',
    'Дальше ▶': 'Next ▶',
    '◀ Дальше': '◀ Next',
    'Назад ▶': 'Back ▶',
    'КБ': 'KB',
    'МБ': 'MB',

    // ---------- Файлы ----------
    'Файлы': 'Files',
    '+ Папка с главами': '+ Chapter folders',
    '⇣ Скачать по ссылке': '⇣ Download from link',
    '↕ Расставить по томам и главам': '↕ Sort by volume and chapter',
    'Главы сами встают по порядку: том, потом глава (Vol.1 Ch.2 → Ch.10 → Ch.10.5 → Vol.2 Ch.11). Подходит для папок и CBZ из FMD2 и других качалок. Стрелками ↑↓ можно поправить вручную. DJVU сначала переведите в PDF.':
      'Chapters are put in order automatically: volume, then chapter (Vol.1 Ch.2 → Ch.10 → Ch.10.5 → Vol.2 Ch.11). Works with folders and CBZ from FMD2 and other downloaders. Use ↑↓ to adjust by hand. Convert DJVU to PDF first.',
    'Выше': 'Up',
    'Ниже': 'Down',
    'Убрать': 'Remove',
    'Т.{0} Гл.{1}': 'Vol.{0} Ch.{1}',
    'Т.{0}': 'Vol.{0}',
    'Гл.{0}': 'Ch.{0}',
    '{0} стр.': '{0} pp.',
    '{0}{1} стр. · {2}': '{0}{1} pp. · {2}',
    'Нужен PDF, CBZ или папка с главами. DJVU и CBR сначала переведите в PDF или CBZ.': 'Add a PDF, a CBZ or a folder of chapters. Convert DJVU and CBR to PDF or CBZ first.',
    'Открываю…': 'Opening…',
    'Распаковываю {0} ({1} из {2})': 'Unpacking {0} ({1} of {2})',
    'В «{0}» нет картинок.': 'There are no images in “{0}”.',
    'Читаю картинки: {0} из {1}': 'Reading images: {0} of {1}',
    'Читаю страницы: {0} из {1}': 'Reading pages: {0} of {1}',
    'Не получилось открыть: {0}': 'Could not open: {0}',
    'Не получилось открыть:': 'Could not open:',
    'Нашёл обложку по имени файла. Проверьте её в разделе «Обложка».': 'Found the cover by its file name. Check it under “Cover”.',
    'Готовлю пример…': 'Preparing the example…',
    'Пример (40 страниц).pdf': 'Example (40 pages).pdf',
    'Главы расставлены по томам и номерам.': 'Chapters sorted by volume and number.',
    'Манга': 'Manga',
    'Том': 'Vol',
    'Гл.': 'Ch.',

    // ---------- Формат книги ----------
    'Формат книги': 'Book format',
    'Обычная книга': 'Regular book',
    'Маленькая книга': 'Small book',
    '2 страницы на стороне листа. Лист сгибается пополам.': '2 pages per side of the sheet. The sheet is folded in half.',
    '2 страницы на стороне листа. Лист режется пополам на 2 листка.': '2 pages per side of the sheet. The sheet is cut in half into 2 leaves.',
    '4 страницы на стороне. Лист режется пополам — сразу 2 тетради.': '4 pages per side. The sheet is cut in half — 2 signatures at once.',
    '4 страницы на стороне. Лист режется на 4 листка.': '4 pages per side. The sheet is cut into 4 leaves.',
    'Готовая книга: {0}': 'Finished book: {0}',
    'Готовая книга:': 'Finished book:',
    '{0} × {1} мм{2}': '{0} × {1} mm{2}',
    'Как скреплять': 'Binding',
    'Сгибать тетрадями': 'Fold into signatures',
    'Дырокол': 'Hole punch',
    'Листы режутся на отдельные листки, у корешка остаётся чистое поле под дырокол. Скрепить кольцами, дисками или пружиной — без клея и шитья. Порядок после разрезки менять не нужно.':
      'Sheets are cut into separate leaves with a blank margin at the spine for the hole punch. Bind with rings, discs or a coil — no glue or sewing. No need to reorder anything after cutting.',
    'Поле под дырокол': 'Punch margin',
    'Обычный дырокол пробивает в 10–12 мм от края, для колец и дисков хватает 12–15 мм.': 'A regular hole punch makes holes 10–12 mm from the edge; 12–15 mm is enough for rings and discs.',

    // ---------- Обложка ----------
    'Обложка': 'Cover',
    'Передняя — стр.': 'Front — page',
    'Задняя — стр.': 'Back — page',
    '1-я': '1st',
    'последняя': 'last',
    'Что сделать с обложкой': 'What to do with the cover',
    'Отдельный лист по размеру книги': 'Separate sheet sized to the book',
    'Как обычные страницы': 'As regular pages',
    'Не печатать': 'Don’t print',
    'Толщина бумаги блока, мм': 'Paper thickness, mm',
    'Бумага обложки': 'Cover paper',
    'Обложку с именем cover, обложка, 0000 программа находит сама. Если обложка — одна широкая картинка (зад + корешок + перед), укажите её как переднюю.':
      'The app finds covers named cover, обложка or 0000 by itself. If the cover is one wide image (back + spine + front), set it as the front.',
    'Обложка не выбрана — книга начнётся сразу со страниц.': 'No cover selected — the book starts right with the pages.',
    'Страницы обложки уберутся из книги и не напечатаются.': 'Cover pages are removed from the book and not printed.',
    'Страницы обложки останутся в книге как обычные страницы.': 'Cover pages stay in the book as regular pages.',
    'Развёртка {0} × {1} мм (корешок {2} мм) → печать на {3}': 'Cover spread {0} × {1} mm (spine {2} mm) → printed on {3}',
    ', уменьшена до {0}% — выберите бумагу больше': ', scaled down to {0}% — choose larger paper',
    '. Широкая картинка займёт всю развёртку.': '. The wide image will fill the whole spread.',

    // ---------- Книга ----------
    'Книга': 'Book',
    'Бумага для печати': 'Printing paper',
    'Как читается': 'Reading direction',
    'Слева направо': 'Left to right',
    'Справа налево (манга)': 'Right to left (manga)',
    'Листов в одной тетради': 'Sheets per signature',
    'Вся книга одной тетрадью': 'Whole book as one signature',
    'Ровнять тетради (меньше пустых страниц)': 'Even out signatures (fewer blank pages)',
    'Будет 2 тетради: верхние половинки листов и нижние.': 'There will be 2 signatures: the top halves of the sheets and the bottom halves.',
    'Все листы сгибаются одной стопкой. Удобно для тонких книжек до ~40 страниц.': 'All sheets are folded as one stack. Good for thin books up to ~40 pages.',
    'Тетрадь = {0} половинок = {1} страниц. Один лист бумаги даёт по половинке в 2 тетради.': 'Signature = {0} halves = {1} pages. Each sheet of paper gives a half to 2 signatures.',
    'Тетрадь = {0} лист. = {1} страниц. Для обычной бумаги удобно 4–8 листов.': 'Signature = {0} sheets = {1} pages. 4–8 sheets work well for regular paper.',
    'Какие страницы': 'Pages',
    'все (например: 1-30, 45, 50-)': 'all (e.g. 1-30, 45, 50-)',
    'Убрать страницы': 'Skip pages',
    'например страницы переводчиков: 2, 31': 'e.g. translator pages: 2, 31',
    'Развороты (широкие картинки) разрезать на 2 страницы и поставить друг напротив друга': 'Split spreads (wide images) into 2 pages and place them facing each other',
    'Пустых в начале': 'Blank pages at start',
    'Последняя страница — задняя обложка': 'Last page is the back cover',

    // ---------- Поля и размер ----------
    'Поля и размер': 'Margins and size',
    'Поля, мм': 'Margins, mm',
    'Сверху': 'Top',
    'Снизу': 'Bottom',
    'Снаружи': 'Outer',
    'У корешка': 'Spine',
    'Масштаб': 'Scale',
    'Сдвиг к краю, мм': 'Shift outward, mm',
    'Сдвиг вверх, мм': 'Shift up, mm',
    'Толщина бумаги': 'Paper thickness',
    'Внутренние листы тетради при сгибе выступают. Этот сдвиг подтягивает их страницы к корешку. Для обычной бумаги 0–0,1.':
      'Inner sheets of a signature stick out when folded. This shift pulls their pages toward the spine. For regular paper use 0–0.1.',

    // ---------- Обрезка ----------
    'Обрезать поля сканов': 'Trim scan margins',
    'Срезает белые или серые поля по краям каждой страницы, чтобы картинка стала крупнее.': 'Trims white or grey margins around each page so the artwork gets bigger.',
    'Найти поля автоматически': 'Find margins automatically',
    'Слева': 'Left',
    'Справа': 'Right',
    'Не обрезать': 'Don’t trim',
    'Ищу поля на страницах…': 'Looking for margins…',
    'Ищу поля на страницах… {0}': 'Looking for margins… {0}',
    'Не нашёл полей: страницы пустые или без рамки.': 'No margins found: the pages are blank or have no border.',
    'Поля найдены: сверху {0}%, снизу {1}%, слева {2}%, справа {3}%.': 'Margins found: top {0}%, bottom {1}%, left {2}%, right {3}%.',

    // ---------- Печать ----------
    'Печать': 'Printing',
    'Имя файла': 'File name',
    'подберётся по файлам': 'taken from the files',
    'Принтер': 'Printer',
    'Печатает с двух сторон': 'Prints both sides',
    'Только с одной': 'One side only',
    'Получится два файла: сначала печатаете лицевые стороны, потом переворачиваете стопку и печатаете обороты.': 'You get two files: print the fronts first, then flip the stack and print the backs.',
    'Обороты в обратном порядке': 'Backs in reverse order',
    'Метки сгиба, разреза и номера листов': 'Fold and cut marks, sheet numbers',
    'Печатать номера страниц': 'Print page numbers',
    'Размер номера': 'Number size',
    'Сбросить все настройки': 'Reset all settings',

    // ---------- Пустой экран ----------
    'Перетащите PDF, CBZ или папки с главами сюда': 'Drop a PDF, CBZ or chapter folders here',
    'Книгу, мангу, конспект. Файлы не уходят с компьютера.': 'A book, manga or notes. Files never leave your computer.',
    'Выбрать PDF': 'Choose PDF',
    'Выбрать папку с главами': 'Choose chapter folder',
    'Скачать по ссылке': 'Download from link',
    'Посмотреть на примере': 'Try an example',
    'Страницы раскладываются по листам': 'Pages are laid out on sheets',
    'На один лист A4 с двух сторон помещается 4 страницы книги.': 'One A4 sheet holds 4 book pages, two on each side.',
    'Листы складываются «бабочкой»': 'Sheets are folded together',
    'Стопку листов сгибают пополам, получается тетрадь со страницами по порядку.': 'Fold the stack in half and you get a signature with pages in order.',
    'Тетради собираются в книгу': 'Signatures make a book',
    'Тетради кладут по порядку и сшивают или склеивают корешок.': 'Stack the signatures in order and sew or glue the spine.',

    // ---------- Сводка и вкладки ----------
    'страниц книги': 'book pages',
    'листок': 'leaf',
    'листка': 'leaves',
    'листков': 'leaves',
    'тетрадь': 'signature',
    'тетради': 'signatures',
    'тетрадей': 'signatures',
    'лист бумаги': 'sheet of paper',
    'листа бумаги': 'sheets of paper',
    'листов бумаги': 'sheets of paper',
    'пустая страница': 'blank page',
    'пустые страницы': 'blank pages',
    'пустых страниц': 'blank pages',
    'размер книги, мм': 'book size, mm',
    'Сначала напечатайте файл «лицевые», затем переверните стопку, вставьте обратно в лоток и напечатайте «обороты». Проверьте сначала на 2 листах.':
      'Print the “fronts” file first, then flip the stack, put it back in the tray and print the “backs”. Test on 2 sheets first.',
    'Двусторонняя печать, переворот': 'Duplex printing, flip on the',
    'по длинному краю': 'long edge',
    'по короткому краю': 'short edge',
    '. Масштаб в окне печати — «Фактический размер» (100%).': '. Set the print scale to “Actual size” (100%).',
    'Пролистать листы': 'Sheet by sheet',
    'Все листы': 'All sheets',
    'Как собрать': 'How to assemble',
    'Готовая книга': 'Finished book',
    'Размер предпросмотра': 'Preview size',

    // ---------- Пролистать листы ----------
    '◀ Назад': '◀ Back',
    'Вперёд ▶': 'Next ▶',
    'Лист {0} из {1}': 'Sheet {0} of {1}',
    'Лист {0}': 'Sheet {0}',
    'лист {0}': 'sheet {0}',
    'Лист 1': 'Sheet 1',
    'Нажмите, чтобы перевернуть': 'Click to flip',
    '↻ Перевернуть лист': '↻ Flip sheet',
    'Клавиши: ← → — листать, пробел — перевернуть': 'Keys: ← → to page, Space to flip',
    'Что на этом листе': 'What’s on this sheet',
    'Порядок печати': 'Print order',
    'Сначала печатаются все стороны A (файл «лицевые»), потом стопку переворачивают и печатают все B.': 'All A sides are printed first (the “fronts” file), then the stack is flipped and all B sides are printed.',
    'Принтер печатает A, затем на обороте того же листа B, и берёт следующий лист.': 'The printer prints A, then B on the back of the same sheet, then takes the next sheet.',
    'Сейчас видно: оборот листа (как он ляжет после переворота)': 'Showing: back of the sheet (as it lies after flipping)',
    'Сейчас видно: лицевая сторона': 'Showing: front side',
    '{0} — тетрадь {1}, лист {2} из {3}': '{0} — signature {1}, sheet {2} of {3}',
    '{0} — пусто': '{0} — blank',
    'низ': 'bottom',
    'верх': 'top',
    'Тетрадь {0} из {1} · в ней это лист {2} из {3}': 'Signature {0} of {1} · sheet {2} of {3} in it',
    '{0} половина пустая.': '{0} half is blank.',
    'Нижняя': 'Bottom',
    'Верхняя': 'Top',
    '⬇ Нижняя': '⬇ Bottom',
    '⬆ Верхняя': '⬆ Top',
    '{0} половина → тетрадь {1}': '{0} half → signature {1}',
    'лицевая:': 'front:',
    'оборот:': 'back:',
    'После сгиба: стр.': 'After folding: pp.',
    'Тетрадь {0}': 'Signature {0}',
    'Где он в тетради {0}': 'Where it sits in signature {0}',
    'Выделенная линия — {0}. Вид сверху на сложенную тетрадь.': 'The highlighted line is {0}. Top view of the folded signature.',
    'эта половинка': 'this half',
    'этот лист': 'this sheet',
    '{0} и {1}': '{0} and {1}',
    'после разрезки — {0} {1}': 'after cutting — {0} {1}',
    '{0} кусок →': '{0} piece →',
    ', стопка {0}': ', pile {0}',
    '⬉ левый верхний': '⬉ top left',
    '⬈ правый верхний': '⬈ top right',
    '⬋ левый нижний': '⬋ bottom left',
    '⬊ правый нижний': '⬊ bottom right',
    '◧ левый': '◧ left',
    '◨ правый': '◨ right',
    'листок {0} (стр. {1})': 'leaf {0} (pp. {1})',
    'листок {0}: {1}': 'leaf {0}: {1}',
    'Заштрихованная полоса — поле под дырокол. На обороте она с другой стороны, поэтому после переворота совпадает.': 'The hatched strip is the punch margin. On the back it is on the other side, so it lines up after flipping.',

    // ---------- Все листы ----------
    'лицевая сторона': 'front side',
    'оборот этого же листа': 'back of the same sheet',
    'метка L{0}/{1}': 'mark L{0}/{1}',
    'метка T{0}·L{1}': 'mark T{0}·L{1}',
    '{0}Тетрадь {1}': '{0}Signature {1}',
    'четыре стопки: левую верхнюю, правую верхнюю, левую нижнюю, правую нижнюю': 'four piles: top left, top right, bottom left, bottom right',
    'две стопки: левую и правую': 'two piles: left and right',
    'Так листы выйдут из принтера. После печати разрежьте всю стопку по линиям разреза — получатся {0}. Положите их друг на друга в этом порядке (первая — сверху): листки сразу пойдут по порядку. Пробейте дыроколом поле у корешка (заштриховано).':
      'This is how the sheets come out of the printer. After printing, cut the whole stack along the cut lines — you get {0}. Stack them in this order (first on top) and the leaves are already in order. Punch the margin at the spine (hatched).',
    'Так листы выйдут из принтера. На каждой стороне 4 страницы. После печати разрежьте всю стопку пополам по линии разреза: верхние половинки — одна тетрадь, нижние — другая. Каждую тетрадь сложите пополам.':
      'This is how the sheets come out of the printer. Each side holds 4 pages. After printing, cut the whole stack in half along the cut line: the top halves are one signature, the bottom halves another. Fold each signature in half.',
    'Так листы выйдут из принтера. На одном листе 4 страницы: две с лица (A) и две с оборота (B). Первый лист: первая и последняя страница тетради снаружи, дальше листы вкладываются друг в друга. Сложите листы тетради стопкой и согните пополам — страницы пойдут по порядку.':
      'This is how the sheets come out of the printer. Each sheet holds 4 pages: two on the front (A) and two on the back (B). Sheet 1 has the first and last pages of the signature on the outside, the next sheets nest inside it. Stack the sheets of a signature and fold them in half — the pages fall into order.',
    'отдельный лист {0}, печать с одной стороны · листок {1} × {2} мм': 'separate {0} sheet, one-sided · leaf {1} × {2} mm',
    'отдельный лист {0} · книга {1} × {2} мм · корешок {3} мм': 'separate {0} sheet · book {1} × {2} mm · spine {3} mm',
    'перед · зад': 'front · back',
    '{0} · корешок · {1}': '{0} · spine · {1}',
    'перед': 'front',
    'зад': 'back',
    'только пустые': 'blank only',
    'стр. {0}–{1}': 'pp. {0}–{1}',
    'стр. {0}–{1} + {2} пуст.': 'pp. {0}–{1} + {2} blank',
    '+ {0} пуст.': '+ {0} blank',

    // ---------- Как собрать ----------
    'Скачайте PDF и напечатайте': 'Download the PDF and print it',
    'Разрежьте листы пополам': 'Cut the sheets in half',
    'Разрежьте всю стопку поперёк по засечкам — ножом по линейке или резаком. Верхние половинки — тетрадь с меньшим номером, нижние — следующая. Порядок в стопке не меняйте.':
      'Cut the whole stack across at the marks — with a knife and ruler or a paper cutter. The top halves are the lower-numbered signature, the bottom halves the next one. Don’t change the order in the stack.',
    'Сложите {0} стопкой': 'Stack the {0}',
    'половинки': 'halves',
    'листы': 'sheets',
    'Листы одной тетради — стороной A вверх, лист 1 сверху, остальные под ним по порядку. Метка в углу подсказывает: «T1 · L3/6 · A» — тетрадь 1, лист 3, сторона A.':
      'Sheets of one signature go side A up, sheet 1 on top, the rest below it in order. The corner mark helps: “T1 · L3/6 · A” means signature 1, sheet 3, side A.',
    'Согните пополам': 'Fold in half',
    'Согните всю стопку сразу так, чтобы лист 1 оказался снаружи. Проверьте: на обложке тетради 1 — страница {0}.': 'Fold the whole stack at once so that sheet 1 is on the outside. Check: the cover of signature 1 shows page {0}.',
    'Соберите тетради вместе': 'Put the signatures together',
    'Положите сложенные тетради по порядку: T1, T2, T3… Сгибы — в одну сторону, {0}. Выровняйте стопку постукиванием.': 'Stack the folded signatures in order: T1, T2, T3… Folds all on one side, {0}. Tap the stack to align it.',
    'справа': 'on the right',
    'слева': 'on the left',
    'Скрепите корешок': 'Bind the spine',
    'Прошейте каждую тетрадь по сгибу (3–5 стежков) и сшейте тетради между собой. Или зажмите стопку, намажьте корешок клеем ПВА в 2 слоя и подклейте полоску ткани или плотной бумаги.':
      'Sew each signature along the fold (3–5 stitches) and sew the signatures together. Or clamp the stack, apply 2 coats of PVA glue to the spine and glue on a strip of cloth or heavy paper.',
    'Тонкую тетрадь можно скрепить степлером по сгибу (2–3 скобы) или прошить нитью.': 'A thin signature can be stapled along the fold (2–3 staples) or sewn with thread.',
    'Файл «обложка» напечатайте на плотной бумаге {0} (односторонняя печать, масштаб 100%). Обрежьте по уголкам-меткам, согните по меткам корешка, промажьте корешок блока клеем и оберните.':
      'Print the “cover” file on heavy {0} paper (one-sided, 100% scale). Trim at the corner marks, fold at the spine marks, glue the spine of the book block and wrap the cover around it.',
    'Наклейте обложку из плотной бумаги. Готовую обложку из страниц манги можно выбрать в разделе «Обложка» слева.': 'Glue on a cover made of heavy paper. You can pick a cover from the manga pages under “Cover” on the left.',
    'Книга целиком: тетради по порядку': 'The whole book: signatures in order',
    'Тетрадь {0} · {1} {2}': 'Signature {0} · {1} {2}',
    'половинка': 'half',
    'половинок': 'halves',
    'лист': 'sheet',
    'листа': 'sheets',
    'листов': 'sheets',
    'Вид сверху на сложенную тетрадь: каждая линия — один лист, согнутый пополам. Цифры — страницы на половинках листа.': 'Top view of the folded signature: each line is one sheet folded in half. Numbers are the pages on each half.',
    'Лист {0} стр. {1} и {2}': 'Sheet {0} pp. {1} and {2}',
    'стр. {0} и {1}': 'pp. {0} and {1}',
    'Схема каждой тетради': 'Diagram of each signature',
    'Разрежьте стопку на 4 части': 'Cut the stack into 4 parts',
    'Разрежьте стопку пополам': 'Cut the stack in half',
    'Не перекладывая листы, разрежьте всю стопку ({0} {1}) по засечкам — резаком или ножом по линейке. Получится {2}.': 'Without reordering, cut the whole stack ({0} {1}) at the marks — with a paper cutter or a knife and ruler. You get {2}.',
    '4 стопки': '4 piles',
    '2 стопки': '2 piles',
    'Сложите стопки по порядку': 'Stack the piles in order',
    'Стопку {0} — сверху, под ней {1}. Листки сразу идут по порядку: сверху листок 1 со страницей {2}.': 'The pile of {0} goes on top, then {1}. The leaves are already in order: leaf 1 with page {2} is on top.',
    'левого верхнего куска': 'top-left pieces',
    'левых половинок': 'left halves',
    'правую верхнюю, затем левую нижнюю и правую нижнюю': 'top right, then bottom left and bottom right',
    'правую': 'the right one',
    'Пробейте дыроколом': 'Punch the holes',
    'Поле под дырокол — {0} у лицевой стороны листка ({1} мм). Пробивайте по 10–15 листков за раз, прижимая их к упору дырокола одинаково.': 'The punch margin is {0} on the front of each leaf ({1} mm). Punch 10–15 leaves at a time, pushing them against the punch guide the same way.',
    'Скрепите': 'Bind',
    'Наденьте листки на кольца, диски (тетрадь на дисках) или пружину. Клей и нитки не нужны, листки можно вынимать и добавлять.': 'Put the leaves on rings, discs or a coil. No glue or thread needed, and leaves can be taken out or added.',
    'Файл «обложка» напечатайте на плотной бумаге {0} с одной стороны, разрежьте по засечкам и пробейте так же: перед — первым, зад — последним.': 'Print the “cover” file on heavy {0} paper one-sided, cut at the marks and punch it the same way: front first, back last.',
    'Положите сверху и снизу листки плотной бумаги или пластиковые обложки. Обложку из страниц манги можно выбрать в разделе «Обложка» слева.': 'Add a leaf of heavy paper or a plastic cover on top and at the bottom. You can pick a cover from the manga pages under “Cover” on the left.',
    'Стопки после разрезки — сверху вниз': 'Piles after cutting — top to bottom',
    'листки {0}–{1}': 'leaves {0}–{1}',
    'лист A4': 'A4 sheet',
    'лицо листа 1': 'front of sheet 1',
    'стопки': 'piles',
    'дырокол': 'punch',
    'лицо': 'front',
    'оборот': 'back',
    'лист 1 — сверху': 'sheet 1 on top',
    'клей': 'glue',

    // ---------- Готовая книга ----------
    'нет обложки': 'no cover',
    'Дальше': 'Next',
    'Назад': 'Back',
    'Готовая книга на кольцах или дисках': 'Finished book on rings or discs',
    'Готовая книга после складывания и склейки': 'Finished book after folding and binding',
    'конец': 'end',
    'начало': 'start',
    'Листайте кнопками, стрелками ← → или щелчком по странице.{0}': 'Turn pages with the buttons, the ← → keys or by clicking a page.{0}',
    'Листайте кнопками, стрелками ← → или щелчком по странице.': 'Turn pages with the buttons, the ← → keys or by clicking a page.',
    'Манга листается справа налево.': 'Manga reads right to left.',
    'Передняя обложка · {0} из {1}': 'Front cover · {0} of {1}',
    'Задняя обложка · {0} из {1}': 'Back cover · {0} of {1}',
    '{0}: стр. {1} · {2} из {3}': '{0}: pp. {1} · {2} of {3}',
    'Первая страница': 'First page',
    'Последняя страница': 'Last page',
    'Разворот': 'Spread',

    // ---------- PDF ----------
    'Собираю PDF…': 'Building PDF…',
    'Собираю PDF… {0}%': 'Building PDF… {0}%',
    'Сохраняю…': 'Saving…',
    '{0} — лицевые.pdf': '{0} — fronts.pdf',
    '{0} — обороты.pdf': '{0} — backs.pdf',
    '{0} — для печати.pdf': '{0} — for printing.pdf',
    '{0} — обложка.pdf': '{0} — cover.pdf',
    '«лицевые»': '“fronts”',
    '«обороты»': '“backs”',
    '«для печати»': '“for printing”',
    '«обложка»': '“cover”',
    'Готово! Скачано: {0}.': 'Done! Downloaded: {0}.',
    'Не получилось собрать PDF: {0}': 'Could not build the PDF: {0}',
    'Книга': 'Book',

    // ---------- Ошибки ядра ----------
    'Не понял «{0}». Пример: 1-30, 45, 50-': 'Didn’t understand “{0}”. Example: 1-30, 45, 50-',
    '«{0}»: в документе всего {1} стр.': '“{0}”: the document has only {1} pages',
    'Диапазон пустой': 'The range is empty',
    'Убрать страницы: {0}': 'Skip pages: {0}',
    'В книге не осталось страниц': 'No pages left in the book',

    // ---------- Скачать по ссылке ----------
    'Скачать мангу по ссылке': 'Download manga from a link',
    'Свернуть: скачивание продолжится': 'Minimize: the download keeps going',
    '— Свернуть': '— Minimize',
    'Ссылка на страницу манги': 'Link to the manga page',
    'Найти': 'Find',
    'Папка:': 'Folder:',
    'Каждая манга — в своей папке по названию, внутри папки глав': 'Each manga goes to its own folder named after it, with a folder per chapter inside',
    'Изменить…': 'Change…',
    'Открыть': 'Open',
    'Все': 'All',
    'Ничего': 'None',
    'Сразу в книгу': 'Add to book',
    'Скачать': 'Download',
    'Развернуть': 'Restore',
    'Стоп': 'Stop',
    'Не удалось скачать скрипты сайтов с GitHub FMD: {0}. Проверьте интернет и перезапустите программу.': 'Could not download the site scripts from FMD on GitHub: {0}. Check your internet connection and restart the app.',
    'Скачиваю скрипты сайтов с GitHub FMD: {0} из {1} Это нужно один раз.': 'Downloading site scripts from FMD on GitHub: {0} of {1}. This is needed only once.',
    'Скачиваю скрипты сайтов с GitHub FMD… Это нужно один раз.': 'Downloading site scripts from FMD on GitHub… This is needed only once.',
    'Работает на скриптах FMD: {0} сайтов, среди них {1} и другие. Вставьте ссылку на страницу манги (не главы).': 'Runs on FMD site scripts: {0} sites, including {1} and more. Paste a link to the manga page (not a chapter).',
    'Останавливаю…': 'Stopping…',
    'Вставьте ссылку, начинающуюся с https://': 'Paste a link starting with https://',
    'Ищу мангу…': 'Looking for the manga…',
    'Сайт не ответил. Проверьте, открывается ли он в браузере.': 'The site didn’t respond. Check that it opens in your browser.',
    'Глав не нашлось. Возможно, сайт требует входа в аккаунт или поменял вёрстку.': 'No chapters found. The site may require signing in or may have changed its layout.',
    'Том {0} Глава {1}': 'Vol {0} Ch {1}',
    'Глава {0}': 'Ch {0}',
    '{0} глав': '{0} chapters',
    '{0} из {1} глав уже есть в папке — их не будем качать заново.': '{0} of {1} chapters are already in the folder and won’t be downloaded again.',
    'Тома:': 'Volumes:',
    'Том {0}': 'Vol {0}',
    'без тома': 'no volume',
    'Без тома': 'No volume',
    '✓ уже скачана': '✓ already downloaded',
    'Остановить': 'Stop',
    'главу': 'chapter',
    'главы': 'chapters',
    'глав': 'chapters',
    'Скачать {0} {1}': 'Download {0} {1}',
    'Глава {0} из {1}: беру из папки…': 'Chapter {0} of {1}: reading from the folder…',
    'Глава {0} из {1}: ищу страницы…': 'Chapter {0} of {1}: looking for pages…',
    'Глава {0} из {1}: страница {2} из {3}': 'Chapter {0} of {1}: page {2} of {3}',
    '{0} (не все страницы)': '{0} (not all pages)',
    'запись на диск: {0}': 'writing to disk: {0}',
    'и ещё {0}': 'and {0} more',
    ' и ещё {0}': ' and {0} more',
    'Не скачались: {0}. Подробности — в «Журнале».': 'Not downloaded: {0}. Details are in the “Log”.',
    'Сохранено в папку «{0}».': 'Saved to the “{0}” folder.',
    'Остановлено.': 'Stopped.',
    'Остановлено': 'Stopped',
    'Закончено': 'Finished',
    'Ничего не скачалось. Возможно, сайт не отдаёт картинки.': 'Nothing was downloaded. The site may not be serving images.',
    'Остановлено — в книгу добавлено то, что успело скачаться.': 'Stopped — what was downloaded so far has been added to the book.',
    'Готово, главы в книге.': 'Done, the chapters are in the book.',
    'Готово.': 'Done.',
    'Этот сайт не поддерживается': 'This site isn’t supported',
    'Путь вне папки загрузок': 'Path is outside the download folder',
    'Куда скачивать мангу': 'Where to download manga',

    // ---------- Окно «Журнал» ----------
    'Всё подробно': 'Everything',
    'Всё, включая каждый запрос и каждую картинку': 'Everything, including every request and every image',
    'Главное': 'Main',
    'Ошибки': 'Errors',
    'Поиск': 'Search',
    'Копировать': 'Copy',
    'Скопировано ✓': 'Copied ✓',
    'Не скопировалось': 'Copy failed',
    'Открыть файл': 'Open file',
    'Папка': 'Folder',
    '{0} из {1}': '{0} of {1}',
    'Новых ошибок: {0}. Ctrl+Shift+L': 'New errors: {0}. Ctrl+Shift+L',
    'Что происходит в программе. Ctrl+Shift+L': 'What the app is doing. Ctrl+Shift+L',

    // ---------- Записи журнала ----------
    'загрузка': 'download', 'файлы': 'files', 'настройки': 'settings', 'подсказка': 'message', 'страница': 'page',
    'движок': 'engine', 'окно': 'window', 'консоль': 'console', 'старт': 'start', 'скрипты': 'scripts', 'миниатюра': 'thumbnail',
    'Не картинка или битый файл в архиве {0}: {1}': 'Not an image or a broken file in archive {0}: {1}',
    'Добавляю: {0} файлов (PDF {1}, архивов {2}, картинок {3})': 'Adding {0} files (PDF {1}, archives {2}, images {3})',
    'Ничего подходящего': 'Nothing suitable',
    'без типа': 'no type',
    'Не картинка или формат не поддерживается: {0} ({1}, {2} байт)': 'Not an image or unsupported format: {0} ({1}, {2} bytes)',
    'Открыто за {0} мс, всего в книге {1} файлов, {2} страниц': 'Opened in {0} ms, the book now has {1} files, {2} pages',
    '{0}: {1} стр.': '{0}: {1} pp.',
    'Не получилось открыть': 'Could not open',
    '{0}: внутри не JPEG/PNG (первые байты {1}), перевожу в JPEG': '{0}: not JPEG/PNG inside (first bytes {1}), converting to JPEG',
    'Собираю PDF «{0}»: {1} файлов': 'Building PDF “{0}”: {1} files',
    'Картинки подготовлены за {0} мс': 'Images prepared in {0} ms',
    'Готово за {0} с: {1}': 'Done in {0} s: {1}',
    'Готово за {0} с': 'Done in {0} s',
    'Не получилось собрать PDF': 'Could not build the PDF',
    'Окно свёрнуто, скачивание идёт дальше': 'Window minimized, the download keeps going',
    'Нажата «Стоп» на свёрнутой панели': '“Stop” pressed on the minimized panel',
    'Нажата «Остановить»': '“Stop” pressed',
    'Новая папка загрузок: {0}': 'New download folder: {0}',
    'Ищу мангу по ссылке {0}': 'Looking for the manga at {0}',
    'Глав не нашлось (сайт {0}, код {1}, название «{2}»)': 'No chapters found (site {0}, code {1}, title “{2}”)',
    '«{0}» ({1}): {2} глав, уже в папке {3}': '“{0}” ({1}): {2} chapters, {3} already in the folder',
    'Поиск манги не удался: {0}': 'Manga lookup failed: {0}',
    'Обложка не скачалась: {0}': 'Cover not downloaded: {0}',
    'Старт: {0} глав «{1}» → папка «{2}»': 'Start: {0} chapters of “{1}” → folder “{2}”',
    '[{0}/{1}] {2}: уже скачана, {3} картинок с диска': '[{0}/{1}] {2}: already downloaded, {3} images from disk',
    '[{0}/{1}] {2}: список страниц, попытка {3} из 3 — ошибка': '[{0}/{1}] {2}: page list, attempt {3} of 3 — error',
    '[{0}/{1}] {2}: сайт не дал страниц, попытка {3} из 3': '[{0}/{1}] {2}: the site returned no pages, attempt {3} of 3',
    '[{0}/{1}] {2}: страниц нет после 3 попыток — глава пропущена': '[{0}/{1}] {2}: no pages after 3 attempts — chapter skipped',
    '[{0}/{1}] {2}: {3} страниц → {4}': '[{0}/{1}] {2}: {3} pages → {4}',
    '{0}, стр. {1}: попытка {2} из 3 — ошибка': '{0}, p. {1}: attempt {2} of 3 — error',
    '{0}, стр. {1}: попытка {2} из 3 — пустой ответ': '{0}, p. {1}: attempt {2} of 3 — empty response',
    '{0}, стр. {1}: не скачалась': '{0}, p. {1}: not downloaded',
    'Не записалось на диск: {0}': 'Could not write to disk: {0}',
    '[{0}/{1}] {2}: {3} из {4} страниц за {5} с': '[{0}/{1}] {2}: {3} of {4} pages in {5} s',
    '{0} за {1} с: {2} картинок, скачано {3} МБ, ошибок {4}': '{0} in {1} s: {2} images, {3} MB downloaded, {4} errors',
    'Ошибка: {0} ({1}:{2}:{3})': 'Error: {0} ({1}:{2}:{3})',
    'Необработанный отказ промиса': 'Unhandled promise rejection',
    'Необработанная ошибка': 'Uncaught error',
    'Открываю во внешнем браузере: {0}': 'Opening in the external browser: {0}',
    'Страница упала': 'The page crashed',
    'Не загрузилась страница {0}: {1} ({2})': 'Page didn’t load {0}: {1} ({2})',
    'Страница загружена': 'Page loaded',
    'Сохранение файла «{0}», {1} байт': 'Saving file “{0}”, {1} bytes',
    'Сохранено: {0}': 'Saved: {0}',
    'отменено': 'cancelled',
    'Файл «{0}» не сохранён: {1}': 'File “{0}” not saved: {1}',
    'Окно не отвечает': 'The window is not responding',
    'Окно снова отвечает': 'The window is responding again',
    '{0}({1}) → {2} за {3} мс': '{0}({1}) → {2} in {3} ms',
    '{0}({1}) упал через {2} мс': '{0}({1}) failed after {2} ms',
    '══════════ MangaForge 2 запущен ══════════': '══════════ MangaForge 2 started ══════════',
    '══════════ Выход ══════════': '══════════ Exit ══════════',
    'Скрипты сайтов на месте, проверены {0}': 'Site scripts are in place, checked {0}',
    'Проверяю обновления скриптов сайтов FMD': 'Checking FMD site scripts for updates',
    'Скачиваю скрипты сайтов FMD (первый запуск)': 'Downloading FMD site scripts (first run)',
    'Обновление скриптов не удалось': 'Script update failed',
    '{0}: «{1}», {2} глав{3}, код {4}': '{0}: “{1}”, {2} chapters{3}, code {4}',
    ' (первая «{0}», последняя «{1}»)': ' (first “{0}”, last “{1}”)',
    '{0} страниц{1}{2}': '{0} pages{1}{2}',
    ', скрипт вернул false': ', the script returned false',
    ', первая {0}': ', first {0}',
    '{0} {1} байт': '{0} {1} bytes',
    'НЕТ КАРТИНКИ': 'NO IMAGE',
    '{0} сайтов': '{0} sites',
    'Папка загрузок: {0}': 'Download folder: {0}',
    'записано': 'written',
    '{0} картинок с диска': '{0} images from disk',
    'уже скачано {0} из {1}': '{0} of {1} already downloaded',
    'Упал служебный процесс': 'A helper process crashed',
    'нет ответа за {0} с': 'no response in {0} s',
    'HTTP {0} {1} ✗ {2} через {3} мс': 'HTTP {0} {1} ✗ {2} after {3} ms',
    'HTTP {0} {1} → {2} перенаправление на {3}': 'HTTP {0} {1} → {2} redirect to {3}',
    'HTTP {0} {1} → {2}, {3}, {4} байт, {5} мс{6}': 'HTTP {0} {1} → {2}, {3}, {4} bytes, {5} ms{6}',
    ' (итоговый адрес {0})': ' (final address {0})',
    'без типа': 'no type',
    'Загружен скрипт {0} за {1} мс: {2}': 'Loaded script {0} in {1} ms: {2}',
    'Скрипт {0} не загрузился': 'Script {0} failed to load',
    'Lua сломался, перезапускаю {0} и повторяю': 'Lua broke, restarting {0} and retrying',
    'Сайт {0}: в скрипте адрес {1}, работаю с {2}': 'Site {0}: the script has address {1}, using {2}',
    'Ссылка {0} → модуль {1} ({2})': 'Link {0} → module {1} ({2})',
    'Для {0} нет скрипта сайта': 'No site script for {0}',
    'Скрипт {0}({1}) — старт': 'Script {0}({1}) — start',
    'Скрипт {0} → {1} за {2} мс': 'Script {0} → {1} in {2} ms',
    'Скрипт {0} упал через {1} мс ({2})': 'Script {0} failed after {1} ms ({2})',
    'GitHub ответил {0}': 'GitHub responded {0}',
    'Скрипты FMD: {0} файлов, обновить {1}': 'FMD scripts: {0} files, {1} to update',
    'JSON не разобран: {0}': 'JSON not parsed: {0}',
    '… (+{0} симв.)': '… (+{0} chars)',
    'Язык интерфейса: {0}': 'Interface language: {0}',
    '[{0} шт.]': '[{0} items]',
    '<{0} байт>': '<{0} bytes>',
    // Ключи данных в журнале
    'папка': 'folder', 'тома': 'volumes', 'сразу в книгу': 'add to book', 'не скачались': 'not downloaded', 'форматы': 'formats',
    'ссылка': 'link', 'картинка': 'image', 'ошибка': 'error', 'основной': 'main', 'обороты': 'backs', 'обложка': 'cover',
    'проверено': 'checked', 'версия': 'version', 'система': 'system', 'память': 'memory', 'процессор': 'CPU', 'язык': 'language',
    'папка программы': 'app folder', 'данные': 'data', 'журнал': 'log', 'аргументы': 'arguments',
  };

  const CYR = /[А-Яа-яЁё]/;
  let lang = 'ru';
  const cache = new Map();
  const exact = new Map();
  const patterns = [];
  for (const [key, val] of Object.entries(EN)) {
    // Пробелы по краям не важны: при переводе они берутся из исходной строки
    const k = key.trim(), v = val.trim();
    if (!/\{\d\}/.test(k)) { exact.set(k, v); continue; }
    const parts = k.split(/(\{\d\})/);
    const order = [];
    const src = parts.map((p) => {
      const m = /^\{(\d)\}$/.exec(p);
      if (!m) return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      order.push(+m[1]);
      return '([\\s\\S]*?)';
    }).join('');
    // Чем больше постоянного текста, тем раньше проверяем — так конкретное побеждает общее
    patterns.push({ re: new RegExp('^' + src + '$'), order, to: v, weight: k.replace(/\{\d\}/g, '').length });
  }
  patterns.sort((a, b) => b.weight - a.weight);

  // Перевести одну строку целиком (пробелы по краям сохраняются)
  function tr(s) {
    if (lang !== 'en' || s === null || s === undefined) return s;
    s = String(s);
    if (!CYR.test(s)) return s;
    if (cache.has(s)) return cache.get(s);
    const lead = s.match(/^\s*/)[0], tail = s.match(/\s*$/)[0];
    const core = s.trim().replace(/\s+/g, ' ');
    let out = exact.get(core);
    if (out === undefined) {
      for (const p of patterns) {
        const m = p.re.exec(core);
        if (!m) continue;
        const vals = [];
        p.order.forEach((n, i) => { vals[n] = tr(m[i + 1]); });
        // Короткий общий шаблон («{0} из {1}») годится, только если внутри всё перевелось — иначе он режет чужой текст
        if (p.weight < 12 && vals.some((v) => CYR.test(v))) continue;
        out = p.to.replace(/\{(\d)\}/g, (x, n) => vals[n] ?? '');
        break;
      }
    }
    const res = out === undefined ? s : lead + out + tail;
    if (cache.size > 5000) cache.clear();
    cache.set(s, res);
    return res;
  }

  // t('Строка {0}', a) — перевод с подстановкой: для имён файлов, папок и всего, что не попадает в DOM
  function t(s, ...args) {
    const base = lang === 'en' ? (exact.get(s) ?? EN[s] ?? s) : s;
    return base.replace(/\{(\d)\}/g, (m, n) => (args[n] === undefined ? m : args[n]));
  }

  // ---------- Перевод страницы ----------
  const ATTRS = ['title', 'placeholder', 'aria-label'];
  const skip = (el) => !el || (el.closest && el.closest('[translate="no"], script, style, textarea'));
  function translateNode(node) {
    if (lang !== 'en') return;
    if (node.nodeType === 3) {
      if (!skip(node.parentElement) && CYR.test(node.data)) { const v = tr(node.data); if (v !== node.data) node.data = v; }
      return;
    }
    if (node.nodeType !== 1 || skip(node)) return;
    for (const a of ATTRS) {
      const v = node.getAttribute(a);
      if (v && CYR.test(v)) { const x = tr(v); if (x !== v) node.setAttribute(a, x); }
    }
    const walker = node.ownerDocument.createTreeWalker(node, 5 /* элементы и текст */, null);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === 3) {
        if (CYR.test(n.data) && !skip(n.parentElement)) { const v = tr(n.data); if (v !== n.data) n.data = v; }
      } else if (!skip(n)) {
        for (const a of ATTRS) {
          const v = n.getAttribute(a);
          if (v && CYR.test(v)) { const x = tr(v); if (x !== v) n.setAttribute(a, x); }
        }
      }
    }
  }

  function watch(doc) {
    if (lang !== 'en') return;
    doc.documentElement.lang = 'en';
    if (CYR.test(doc.title)) doc.title = tr(doc.title);
    translateNode(doc.body);
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'characterData') translateNode(m.target);
        else if (m.type === 'attributes') translateNode(m.target);
        else for (const n of m.addedNodes) translateNode(n);
      }
    }).observe(doc.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  return {
    EN,
    get lang() { return lang; },
    setLang(l) { lang = l === 'en' ? 'en' : 'ru'; cache.clear(); },
    tr, t, watch,
  };
});
