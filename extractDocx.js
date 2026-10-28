import mammoth from 'mammoth';
import fs from 'fs';
import path from 'path';

async function extract() {
  const docxPath = path.resolve('Green_Living_at_School_Unit_2_English_10 (1).docx');
  const result = await mammoth.extractRawText({ path: docxPath });
  console.log('Extracted raw text from DOCX:\n', result.value);
}

extract().catch(console.error);
