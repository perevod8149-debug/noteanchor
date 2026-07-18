# PDF TextContent Geometry Spike

## Purpose

This isolated spike exists to answer one question:

Do boxes computed from pdf.js `page.getTextContent().items` align with the visible PDF canvas text closely enough to be useful?

This spike is not production PDF note creation.

## What it does

- opens a local PDF inside the Tauri app;
- renders page 1 with pdf.js on a controlled canvas;
- calls `page.getTextContent()`;
- computes overlay boxes from `textContent.items` geometry;
- draws those boxes over the rendered page;
- shows optional labels and center points;
- exposes basic diagnostics for quick inspection.

## What it does not do

- no production integration;
- no note creation;
- no persistence;
- no right-click flow;
- no multi-page text-note workflow;
- no export or report.

## Source of truth

The overlay is based on `textContent.items` geometry and viewport transforms.

It does not use DOM text-layer spans as the source of hit testing or box placement.

## How to open it

In development mode:

- start the app with `npm.cmd run tauri:dev`;
- click `PDF textContent geometry spike` in the dev toolbar;
- open a PDF;
- enable the overlay toggles and inspect whether the boxes align with visible text.

The spike is intended to stay development-only.

## What to verify manually

1. Page 1 renders.
2. Text item boxes appear.
3. Labels and centers can be toggled.
4. Boxes sit over the same visible words or lines as the PDF canvas.
5. A line such as `"Nonsense!" said Mr. Decker.` can be inspected visually.

## Interpretation

- If the boxes align well enough, this supports a future isolated selection spike based on geometry data.
- If the boxes are shifted, scaled incorrectly, or visually unusable, stop there and do not proceed to selection on this path.
