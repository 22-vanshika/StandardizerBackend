const fs = require("fs");
const path = require("path");

function parseDate(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return "";

  const clean = dateStr.trim().replace(/\s+/g, " ");
  const sep = clean.includes("-") ? "-" : "/";
  const parts = clean.split(sep);
  if (parts.length !== 3) return "";

  let day = "",
    month = "",
    year = "";

  if (parts[2].length === 2) parts[2] = "20" + parts[2];

  const d1 = parseInt(parts[0], 10);
  const d2 = parseInt(parts[1], 10);
  const d3 = parseInt(parts[2], 10);

  const original = clean;
  if (/^\d{2}[-\/]\d{2}[-\/]\d{4}$/.test(original)) {
    if (sep === "-" && d1 > 12) {
      day = d1;
      month = d2;
      year = d3;
    } else if (sep === "-" && d2 > 12) {
      month = d1;
      day = d2;
      year = d3;
    } else {
      month = d1;
      day = d2;
      year = d3;
    }
  } else if (/^\d{2}[-\/]\d{2}[-\/]\d{2}$/.test(original)) {
    const y = "20" + parts[2];
    if (d1 > 12) {
      day = d1;
      month = d2;
      year = parseInt(y);
    } else {
      month = d1;
      day = d2;
      year = parseInt(y);
    }
  } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(original)) {
    month = d1;
    day = d2;
    year = d3;
  } else {
    return "";
  }

  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900) return "";

  const daysInMonth = {
    "01": 31,
    "02": year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    "03": 31,
    "04": 30,
    "05": 31,
    "06": 30,
    "07": 31,
    "08": 31,
    "09": 30,
    10: 31,
    11: 30,
    12: 31,
  };

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  if (day > daysInMonth[mm]) return "";

  return `${dd}/${mm}/${year}`;
}

function extractLocation(description) {
  const words = description.trim().split(/\s+/);
  if (words.length === 0) return "";
  const locWord = words[words.length - 1].replace(/[^A-Za-z]/g, "");
  return locWord.charAt(0).toUpperCase() + locWord.slice(1).toLowerCase();
}

function extractHeaderMapping(fields) {
  const mapping = {};
  const lowered = fields.map((f) =>
    f
      .toLowerCase()
      .replace(/[^a-z]/g, "")
      .trim()
  );
  lowered.forEach((field, idx) => {
    if (!field) return;

    if (field.includes("date")) mapping.date = idx;
    else if (
      field.includes("description") ||
      field.includes("details") ||
      field === "transactiondescription"
    )
      mapping.description = idx;
    else if (field.includes("debit")) mapping.debit = idx;
    else if (field.includes("credit")) mapping.credit = idx;
    else if (field.includes("amount")) mapping.amount = idx;
  });

  if (
    mapping.date !== undefined &&
    (mapping.amount !== undefined ||
      mapping.debit !== undefined ||
      mapping.credit !== undefined)
  ) {
    return mapping;
  }

  return null;
}

function isValidTransactionLine(fields) {
  if (fields.length < 3) return false;
  for (const field of fields) {
    if (parseDate(field)) return true;
  }
  return false;
}

function processTransactionLine(
  fields,
  transactionType,
  currentCardName,
  columnMapping
) {
  let date = "";
  let description = "";
  let debit = "0.00";
  let credit = "0.00";
  let currency = "INR";

  const trimmed = fields.map((f) => f?.trim());

  if (columnMapping.description != null) {
    description =
      trimmed[columnMapping.description]
        ?.replace(/^"(.*)"$/, "$1")
        ?.replace(/\s+/g, " ")
        ?.trim() || "";
  }

  const rawDate = trimmed[columnMapping.date];
  const parsedDate = parseDate(rawDate);
  if (columnMapping.date != null && parsedDate) date = parsedDate;

  if (columnMapping.debit != null) {
    const val = parseFloat(trimmed[columnMapping.debit]);
    if (!isNaN(val)) debit = val.toFixed(2);
  }

  if (columnMapping.credit != null) {
    const val = parseFloat(trimmed[columnMapping.credit]);
    if (!isNaN(val)) credit = val.toFixed(2);
  }

  if (
    !columnMapping.debit &&
    !columnMapping.credit &&
    columnMapping.amount != null
  ) {
    const amountStr = trimmed[columnMapping.amount]
      .toLowerCase()
      .replace(/\s+/g, "");
    if (amountStr.endsWith("cr")) {
      const amt = parseFloat(amountStr.replace("cr", ""));
      credit = isNaN(amt) ? "0.00" : amt.toFixed(2);
    } else {
      const amt = parseFloat(amountStr);
      debit = isNaN(amt) ? "0.00" : amt.toFixed(2);
    }
  }

  if (transactionType === "International") {
    let words = description.trim().split(/\s+/);
    if (words.length > 1) {
      const lastWord = words[words.length - 1]
        .replace(/[^A-Za-z]/g, "")
        .toUpperCase();
      currency = lastWord;
      words = words.slice(0, -1);
      description = words.join(" ").trim();
    }
  }

  const location = extractLocation(description);

  return {
    date,
    description,
    debit,
    credit,
    currency,
    cardName: currentCardName,
    transaction: transactionType,
    location,
  };
}

function convertToSortableDate(dateStr) {
  const [dd, mm, yyyy] = dateStr.split("/");
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function StandardizeStatement(inputFile, outputFile, debug = false) {
  try {
    const raw = fs.readFileSync(inputFile, "utf-8");
    const lines = raw.split(/\r?\n/);
    let output =
      "Date,Transaction Description,Debit,Credit,Currency,CardName,Transaction,Location\n";
    let transactionType = "Domestic";
    let currentCardName = "";
    let columnMapping = null;
    const transactions = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.split(",").every((v) => v === "")) continue;

      if (line.toLowerCase().includes("domestic transaction")) {
        transactionType = "Domestic";
      } else if (line.toLowerCase().includes("international transaction")) {
        transactionType = "International";
      } else if (
        line.split(",").filter(Boolean).length === 1 &&
        !line.toLowerCase().includes("transaction")
      ) {
        currentCardName = line.replace(/,/g, "").trim();
      } else {
        const fields = line.split(",");
        if (columnMapping && extractHeaderMapping(fields)) continue;

        if (!columnMapping) {
          const mapping = extractHeaderMapping(fields);
          if (mapping) {
            columnMapping = mapping;
            continue;
          }
        }

        if (columnMapping && isValidTransactionLine(fields)) {
          const txn = processTransactionLine(
            fields,
            transactionType,
            currentCardName,
            columnMapping
          );
          if (txn.date) {
            const lineStr = `${txn.date},${txn.description},${txn.debit},${txn.credit},${txn.currency},${txn.cardName},${txn.transaction},${txn.location}`;
            if (!lineStr.startsWith(",")) {
              transactions.push({
                sortKey: convertToSortableDate(txn.date),
                line: lineStr,
              });
              if (debug) console.log("Parsed:", lineStr);
            }
          }
        }
      }
    }

    transactions.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    output += transactions.map((t) => t.line).join("\n") + "\n";
    fs.writeFileSync(outputFile, output, "utf-8");
    console.log("✅ Standardized file generated:", outputFile);
  } catch (err) {
    console.error("❌ Error processing file:", err.message);
  }
}

// // CLI support
// if (require.main === module) {
//   const [, , inputPath] = process.argv;

//   if (!inputPath) {
//     console.error("Usage: node index.js <input.csv>");
//     process.exit(1);
//   }

//   // Dynamically generate output file name
//   const inputFileName = path.basename(inputPath); // e.g., HDFC-Input-Case1.csv
//   const outputFileName = inputFileName.replace("Input", "Output");
//   const outputPath = path.join(path.dirname(inputPath), outputFileName);

//   StandardizeStatement(inputPath, outputPath);
// }

module.exports = StandardizeStatement;
