require("regenerator-runtime/runtime");

const express = require("express");
const fs = require("fs");
const path = require("path");
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const cors = require("cors");
const { createCanvas, registerFont } = require("canvas");

const app = express();

// ✅ UPDATED CORS CONFIG (only change)
const allowedOrigins = [
  "https://www.ranipetpledge.in",
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json());

// ✅ FIX: Required for deployment (Render)
process.env.FONTCONFIG_PATH = "/etc/fonts";

// ✅ FIX: Use resolve + proper registration
registerFont(
  path.resolve(__dirname, "fonts", "NotoSansTamil-VariableFont_wdth,wght.ttf"),
  { family: "TamilFont" }
);

// Health route
app.get("/", (req, res) => {
  res.send("Backend is running ✅");
});

// Detect Tamil
function containsTamil(text) {
  return /[\u0B80-\u0BFF]/.test(text);
}

app.post("/generate-certificate", async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Name is required" });
    }

    const cleanName = name.trim();

    // Load template
    const templatePath = path.join(__dirname, "template", "certificate.pdf");
    if (!fs.existsSync(templatePath)) {
      return res.status(500).json({ error: "Template file not found" });
    }

    const existingPdfBytes = fs.readFileSync(templatePath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    pdfDoc.registerFontkit(fontkit);

    const page = pdfDoc.getPages()[0];
    const { width, height } = page.getSize();

    // English font
    const engFontPath = path.join(
      __dirname,
      "fonts",
      "LibreBaskerville-VariableFont_wght.ttf"
    );

    if (!fs.existsSync(engFontPath)) {
      return res.status(500).json({ error: "English font file not found" });
    }

    const engFontBytes = fs.readFileSync(engFontPath);
    const engFont = await pdfDoc.embedFont(engFontBytes);

    // Collector font (Arial style)
    const collectorFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const lineStartX = width * 0.30;
    const lineEndX = width * 0.78;
    const lineWidth = lineEndX - lineStartX;
    const maxHeight = height * 0.06;

    const xOffset = 10;
    const baseY = height * 0.455;
    const textColor = rgb(0.11, 0.21, 0.24);

    const collectorText = "Dr.J. U. Chandrakala, I.A.S.";
    const collectorFontSize = 18;

    const collectorWidth = collectorFont.widthOfTextAtSize(
      collectorText,
      collectorFontSize
    );

    const collectorX = width * 0.70 - collectorWidth / 2;
    const collectorY = height * 0.14;

    page.drawText(collectorText, {
      x: collectorX,
      y: collectorY,
      size: collectorFontSize,
      font: collectorFont,
      color: rgb(0.2, 0.25, 0.27),
    });

    if (containsTamil(cleanName)) {
      const measureCanvas = createCanvas(2000, 400);
      const measureCtx = measureCanvas.getContext("2d");

      let fontSize = 48;
      let measuredWidth = 0;
      let measuredHeight = 0;

      while (fontSize > 18) {
        measureCtx.font = `${fontSize}px "TamilFont"`;
        const metrics = measureCtx.measureText(cleanName);

        measuredWidth = metrics.width;

        const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.8;
        const descent = metrics.actualBoundingBoxDescent || fontSize * 0.2;
        measuredHeight = ascent + descent;

        if (measuredWidth <= lineWidth && measuredHeight <= maxHeight) break;

        fontSize -= 1;
      }

      const paddingX = 30;
      const paddingY = 20;

      const canvasWidth = Math.ceil(measuredWidth + paddingX * 2);
      const canvasHeight = Math.ceil(measuredHeight + paddingY * 2);

      const textCanvas = createCanvas(canvasWidth, canvasHeight);
      const ctx = textCanvas.getContext("2d");

      ctx.fillStyle = "#1c353c";
      ctx.font = `${fontSize}px "TamilFont"`;

      const finalMetrics = ctx.measureText(cleanName);
      const finalAscent =
        finalMetrics.actualBoundingBoxAscent || fontSize * 0.8;
      const finalDescent =
        finalMetrics.actualBoundingBoxDescent || fontSize * 0.2;

      ctx.fillText(cleanName, paddingX, paddingY + finalAscent);

      const pngBuffer = textCanvas.toBuffer("image/png");
      const pngImage = await pdfDoc.embedPng(pngBuffer);

      let scaleFactor;

      if (finalMetrics.width < lineWidth * 0.6) {
        scaleFactor = (lineWidth * 0.75) / finalMetrics.width;
      } else if (finalMetrics.width < lineWidth * 0.9) {
        scaleFactor = (lineWidth * 0.7) / finalMetrics.width;
      } else {
        scaleFactor = (lineWidth * 0.62) / finalMetrics.width;
      }

      const imageWidth = finalMetrics.width * scaleFactor;
      const imageHeight = (finalAscent + finalDescent) * scaleFactor;

      const x = lineStartX + (lineWidth - imageWidth) / 2 + xOffset;
      const y = baseY - imageHeight * 0.5;

      page.drawImage(pngImage, {
        x,
        y,
        width: imageWidth,
        height: imageHeight,
      });
    } else {
      let fontSize = 36;
      let textWidth = engFont.widthOfTextAtSize(cleanName, fontSize);
      let textHeight = engFont.heightAtSize(fontSize);

      while (
        (textWidth > lineWidth || textHeight > maxHeight) &&
        fontSize > 18
      ) {
        fontSize -= 1;
        textWidth = engFont.widthOfTextAtSize(cleanName, fontSize);
        textHeight = engFont.heightAtSize(fontSize);
      }

      const x = lineStartX + (lineWidth - textWidth) / 2 + xOffset;
      const y = baseY - textHeight * 0.2;

      page.drawText(cleanName, {
        x,
        y,
        size: fontSize,
        font: engFont,
        color: textColor,
      });
    }

    const pdfBytes = await pdfDoc.save();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="certificate.pdf"'
    );

    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error("Error generating certificate:", error);
    res.status(500).json({
      error: "Failed to generate certificate",
      details: error.message,
    });
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
