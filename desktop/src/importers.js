// Importa guiones desde TXT, Markdown, DOCX y PDF (todo local).
const fs = require('fs');
const path = require('path');

async function importFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const title = path.basename(filePath, ext);
  let text = '';

  if (ext === '.txt' || ext === '.md') {
    text = fs.readFileSync(filePath, 'utf8');
  } else if (ext === '.docx') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    text = result.value;
  } else if (ext === '.pdf') {
    // Se importa el archivo interno para evitar el modo de prueba de pdf-parse.
    const pdfParse = require('pdf-parse/lib/pdf-parse.js');
    const result = await pdfParse(fs.readFileSync(filePath));
    text = result.text;
  } else {
    throw new Error(`Formato no compatible: ${ext}`);
  }

  // Normaliza saltos de línea y colapsa líneas vacías repetidas.
  text = text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, content: text };
}

module.exports = { importFile };
