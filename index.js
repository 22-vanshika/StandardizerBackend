// index.js
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const StandardizeStatement = require("./StandardizeStatement");

const app = express();
const PORT = 5050;

app.use(cors());
app.use(express.static("outputs"));

const upload = multer({ dest: "uploads/" });

app.post("/upload", upload.single("statement"), (req, res) => {
  const inputPath = req.file.path;
  const originalName = req.file.originalname;
  const outputFileName = originalName.replace("Input", "Output");
  const outputPath = path.join("outputs", outputFileName);

  StandardizeStatement(inputPath, outputPath);
  const host = req.headers.host;
  res.json({ message: "Processed", downloadUrl: `https://${host}/${outputFileName}` });
  
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
