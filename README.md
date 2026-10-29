# MangaForge 2 — print manga and books as folded booklets

**English** · [Русский](README.ru.md)

The second version of MangaForge: a free, offline tool for printing manga, comics and books at home.
Load a PDF, a CBZ or a pile of chapter folders and get a PDF for any ordinary printer.
Fold the printed sheets in half into signatures, then sew or glue the signatures into a real book.

Nothing to install: it is a single HTML page that runs in your browser with no internet connection.
Your files never leave your computer.

> The app's interface is in Russian. The UI labels below are quoted in Russian with a translation.

## Features

- **Any source.** PDF, CBZ/ZIP, a folder of images, or many chapter folders at once (for example, downloaded with FMD2).
  Chapters are sorted by volume and chapter number, including decimal chapters like "Ch. 10.5".
- **Two book formats.**
  - *Regular book:* 2 pages per side of the sheet. A4 sheets give an A5 book.
  - *Small book:* 4 pages per side. Each A4 sheet is cut in half into two signatures, giving an A6 book.
- **Right-to-left manga.** Page order and the spine on the right, just like the original.
- **Double-page spreads.** Wide pages are split into two halves that always land on facing pages of the book.
- **Covers handled the way scanlation groups release them.** Front and back covers are detected automatically from file names (cover, обложка, 000…) and can be picked by hand. The cover can be:
  - left out;
  - printed as regular pages;
  - printed as a separate wrap-around sheet sized exactly to the book. The spine width is calculated from the sheet count and paper thickness, with trim marks.
- **Even signatures.** Choose the number of sheets per signature, and all signatures come out the same size. Creep compensation for the inner sheets is included.
- **Scan cleanup.** Margins, scale, offset, manual or automatic trimming of white borders, and optional page numbers.
- **Works with any printer.** Automatic duplex, or manual duplex with two files: fronts and backs.
- **Visual preview.**
  - Flip any sheet over to see its back.
  - See where each sheet sits in its signature.
  - Follow step-by-step assembly instructions with pictures.
  - Page through the finished book before printing.
- **20 color themes**, light and dark.

## Quick start

1. Download the repository (Code → Download ZIP) and unpack it.
2. Open `booklet/index.html` in Chrome or Edge.
3. Click «Открыть PDF» (Open PDF) or add a CBZ or a chapter folder.
4. Choose the book format and reading direction, and check the cover.
5. Review the sheets in the «Пролистать листы» (Flip through sheets) tab, then click «Сохранить» (Save).
6. Print the PDF double-sided at 100% scale ("Actual size").
   Flip on the short edge for a regular book and on the long edge for a small book.
7. Assemble the book using the «Как собрать» (How to assemble) tab.

Tip: before a big print run, print 1–2 sheets and check that the backs line up with the fronts.

## Assembling the book

```
print → (cut in half) → stack, sheet 1 on top → fold in half → signatures in order → sew / glue the spine → cover
```

Each sheet has a mark in the corner such as `T1 · L3/6 · A`: signature 1, sheet 3 of 6, front side.
If the sheets get mixed up, the mark tells you where each one belongs.

## How it works

A signature of P = 4·S pages is made from S sheets. Sheet *i* (counting from 0) carries:

| | Front | Back |
|---|---|---|
| Left to right | `P−1−2i`, `2i` | `2i+1`, `P−2−2i` |
| Right to left (manga) | `2i`, `P−1−2i` | `P−2−2i`, `2i+1` |

Once the stack is folded, the pages fall into order. In the small book, two signatures share one A4 sheet: one on the top half, the other on the bottom half.

## Project structure

```
booklet/
  index.html   interface markup
  app.js       interface: loading, sorting, covers, preview, saving
  core.js      UI-free core: page order, imposition, PDF generation (also runs in Node.js)
  style.css    styles and themes
  lib/         third-party libraries (local copies, no internet needed)
```

## Third-party libraries

- [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT): creating PDFs.
- [PDF.js](https://github.com/mozilla/pdf.js) (Apache-2.0): reading and rendering PDFs.
- [JSZip](https://github.com/Stuk/jszip) (MIT / GPLv3): reading CBZ and ZIP.

## License

[MIT](LICENSE): free to use, modify and distribute with attribution.
