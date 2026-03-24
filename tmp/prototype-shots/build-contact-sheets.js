const sharp = require("sharp");
const path = require("path");

const root = path.join(process.cwd(), "tmp/prototype-shots");
const sets = {
  "contact-concepts.png": [
    ["C1 default", "concept1-default.png"],
    ["C1 spell", "concept1-spellcheck.png"],
    ["C1 visual", "concept1-visual.png"],
    ["C2 text", "concept2-text.png"],
    ["C2 spell", "concept2-spellcheck.png"],
    ["C2 visual", "concept2-visual.png"],
    ["C3 default", "concept3-default.png"],
    ["C3 unclear", "concept3-unclear.png"],
    ["C3 visual", "concept3-visual.png"]
  ],
  "contact-legacy.png": [
    ["Legacy patch", "legacy-default-patch.png"],
    ["Legacy spell", "legacy-spellcheck.png"],
    ["Legacy callout", "legacy-callout.png"],
    ["Legacy visual", "legacy-visual.png"]
  ],
  "contact-all.png": [
    ["C1 default", "concept1-default.png"],
    ["C2 text", "concept2-text.png"],
    ["C3 default", "concept3-default.png"],
    ["Legacy patch", "legacy-default-patch.png"],
    ["C1 visual", "concept1-visual.png"],
    ["C2 visual", "concept2-visual.png"],
    ["C3 unclear", "concept3-unclear.png"],
    ["Legacy visual", "legacy-visual.png"]
  ]
};

function makeLabelSvg(label) {
  return Buffer.from(`
    <svg width="380" height="242" xmlns="http://www.w3.org/2000/svg">
      <rect x="0.5" y="0.5" width="379" height="241" fill="none" stroke="#dce0e6"/>
      <text x="14" y="228" font-family="Arial, sans-serif" font-size="16" fill="#111827">${label}</text>
    </svg>
  `);
}

async function buildSheet(outputName, items) {
  const cardWidth = 380;
  const cardHeight = 242;
  const gap = 14;
  const cols = items.length > 4 ? 3 : 2;
  const rows = Math.ceil(items.length / cols);
  const sheetWidth = cols * cardWidth + (cols - 1) * gap;
  const sheetHeight = rows * cardHeight + (rows - 1) * gap;
  const composites = [];

  for (let index = 0; index < items.length; index += 1) {
    const [label, fileName] = items[index];
    const resized = await sharp(path.join(root, fileName))
      .resize({ width: 360, height: 202, fit: "inside" })
      .png()
      .toBuffer();

    const card = await sharp({
      create: {
        width: cardWidth,
        height: cardHeight,
        channels: 4,
        background: "#ffffff"
      }
    })
      .composite([
        { input: resized, left: 10, top: 10 },
        { input: makeLabelSvg(label), left: 0, top: 0 }
      ])
      .png()
      .toBuffer();

    composites.push({
      input: card,
      left: (index % cols) * (cardWidth + gap),
      top: Math.floor(index / cols) * (cardHeight + gap)
    });
  }

  await sharp({
    create: {
      width: sheetWidth,
      height: sheetHeight,
      channels: 4,
      background: "#f5f7fa"
    }
  })
    .composite(composites)
    .png()
    .toFile(path.join(root, outputName));
}

async function main() {
  for (const [outputName, items] of Object.entries(sets)) {
    await buildSheet(outputName, items);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
