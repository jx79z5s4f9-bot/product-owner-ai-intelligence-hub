/**
 * Translation Route
 * Dutch <-> English with &&term&& glossary support
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/connection');

const OLLAMA_URL = 'http://localhost:11434/api/generate';
const MODEL = 'gemma2:2b';
const GLOSSARY_FILE = path.join(__dirname, '..', 'data', 'domain-glossary.md');

// In-memory glossary cache
let glossaryCache = { nlToEn: {}, enToNl: {} };
loadGlossary();

function loadGlossary() {
  try {
    if (!fs.existsSync(GLOSSARY_FILE)) {
      console.log('[Translate] No glossary file found');
      return;
    }

    const content = fs.readFileSync(GLOSSARY_FILE, 'utf-8');
    const tableRowRegex = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|/gm;
    let match;

    while ((match = tableRowRegex.exec(content)) !== null) {
      const dutch = match[1].trim();
      const english = match[2].trim();

      if (dutch === 'Dutch' || dutch.startsWith('---') || dutch.startsWith('<!--')) {
        continue;
      }

      if (dutch && english) {
        glossaryCache.nlToEn[dutch.toLowerCase()] = english;
        glossaryCache.enToNl[english.toLowerCase()] = dutch;
      }
    }

    console.log(`[Translate] Loaded ${Object.keys(glossaryCache.nlToEn).length} glossary terms`);
  } catch (error) {
    console.error('[Translate] Glossary load error:', error.message);
  }
}

/**
 * POST /api/translate
 * Body: { text, direction: 'auto'|'nl-en'|'en-nl' }
 */
router.post('/', async (req, res) => {
  const { text, direction = 'auto' } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Text required' });
  }

  try {
    // Extract &&term&& markers
    const { cleanText, markedTerms } = extractMarkedTerms(text);

    // Detect direction if auto
    const finalDirection = direction === 'auto' ? detectLanguage(cleanText) : direction;

    // Build glossary context
    const glossaryContext = buildGlossaryContext(finalDirection);

    // Translate
    const prompt = `Translate the following from ${finalDirection === 'nl-en' ? 'Dutch' : 'English'} to ${finalDirection === 'nl-en' ? 'English' : 'Dutch'}.
${glossaryContext}
Preserve all formatting, headers, bullet points. Only output the translation, nothing else.

TEXT:
${cleanText}

TRANSLATION:`;

    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt: prompt,
        stream: false,
        options: { temperature: 0.2, num_predict: 4000 }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status}`);
    }

    const data = await response.json();
    let translation = cleanTranslation(data.response);

    // Apply glossary to ensure consistency
    translation = applyGlossary(translation, finalDirection);

    // Translate marked terms
    const termTranslations = await translateTerms(markedTerms, finalDirection);

    res.json({
      translation,
      direction: finalDirection,
      sourceLanguage: finalDirection === 'nl-en' ? 'Dutch' : 'English',
      targetLanguage: finalDirection === 'nl-en' ? 'English' : 'Dutch',
      markedTerms,
      termTranslations
    });

  } catch (error) {
    console.error('[Translate] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/translate/glossary
 * Returns all glossary terms
 */
router.get('/glossary', (req, res) => {
  res.json({
    nlToEn: glossaryCache.nlToEn,
    enToNl: glossaryCache.enToNl,
    count: Object.keys(glossaryCache.nlToEn).length
  });
});

/**
 * POST /api/translate/glossary
 * Body: { terms: [], translations: [], direction }
 */
router.post('/glossary', (req, res) => {
  const { terms, translations, direction = 'nl-en' } = req.body;

  if (!terms || !translations) {
    return res.status(400).json({ error: 'Terms and translations required' });
  }

  try {
    let added = 0;
    const db = getDb();
    const date = new Date().toISOString().split('T')[0];

    for (let i = 0; i < terms.length; i++) {
      const term = terms[i];
      const translation = translations[i];

      if (!term || !translation) continue;

      const dutch = direction === 'nl-en' ? term : translation;
      const english = direction === 'nl-en' ? translation : term;

      // Add to cache
      glossaryCache.nlToEn[dutch.toLowerCase()] = english;
      glossaryCache.enToNl[english.toLowerCase()] = dutch;

      // Add to database
      if (db) {
        db.run(
          `INSERT OR REPLACE INTO glossary (dutch, english, context) VALUES (?, ?, ?)`,
          [dutch, english, `Added ${date}`]
        );
      }

      added++;
    }

    // Also append to markdown file
    appendToGlossaryFile(terms, translations, direction);

    res.json({ success: true, added });

  } catch (error) {
    console.error('[Translate] Glossary add error:', error);
    res.status(500).json({ error: error.message });
  }
});

function extractMarkedTerms(text) {
  const markedTerms = [];
  const regex = /&&([^&]+)&&/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    markedTerms.push(match[1].trim());
  }

  const cleanText = text.replace(/&&([^&]+)&&/g, '$1');
  return { cleanText, markedTerms };
}

function detectLanguage(text) {
  const dutchWords = /\b(het|een|van|de|en|dat|is|zijn|niet|ook|maar|voor|met|die|aan|er|nog|wat|als|naar|kan|zou|wel|moet|hij|zij|wij|hun|deze|meer|over|uit|geen|dan|hoe|waar|nu|uur)\b/gi;
  const matches = text.match(dutchWords) || [];
  return matches.length >= 3 ? 'nl-en' : 'en-nl';
}

function buildGlossaryContext(direction) {
  const dict = direction === 'nl-en' ? glossaryCache.nlToEn : glossaryCache.enToNl;
  const entries = Object.entries(dict).slice(0, 30);

  if (entries.length === 0) return '';

  const examples = entries.map(([source, target]) => `${source} → ${target}`).join('\n');
  return `\nGLOSSARY (use these exact translations):\n${examples}\n`;
}

function applyGlossary(text, direction) {
  const dict = direction === 'nl-en' ? glossaryCache.nlToEn : glossaryCache.enToNl;
  let result = text;

  const sortedTerms = Object.keys(dict).sort((a, b) => b.length - a.length);
  for (const term of sortedTerms) {
    const replacement = dict[term];
    const regex = new RegExp(`\\b${escapeRegex(term)}\\b`, 'gi');
    result = result.replace(regex, replacement);
  }

  return result;
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function translateTerms(terms, direction) {
  const translations = [];
  const dict = direction === 'nl-en' ? glossaryCache.nlToEn : glossaryCache.enToNl;

  for (const term of terms) {
    // Check cache first
    if (dict[term.toLowerCase()]) {
      translations.push(dict[term.toLowerCase()]);
      continue;
    }

    // Translate via LLM
    try {
      const prompt = `Translate this single term from ${direction === 'nl-en' ? 'Dutch' : 'English'} to ${direction === 'nl-en' ? 'English' : 'Dutch'}. Only output the translation.\n\nTerm: ${term}\n\nTranslation:`;

      const response = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          prompt,
          stream: false,
          options: { temperature: 0.1, num_predict: 50 }
        })
      });

      const data = await response.json();
      translations.push(cleanTranslation(data.response));
    } catch (error) {
      translations.push('');
    }
  }

  return translations;
}

function cleanTranslation(text) {
  if (!text) return '';
  return text
    .replace(/^(Translation:|Here is the translation:|The translation is:)/i, '')
    .trim();
}

function appendToGlossaryFile(terms, translations, direction) {
  try {
    const date = new Date().toISOString().split('T')[0];
    const newRows = [];

    for (let i = 0; i < terms.length; i++) {
      const dutch = direction === 'nl-en' ? terms[i] : translations[i];
      const english = direction === 'nl-en' ? translations[i] : terms[i];
      if (dutch && english) {
        newRows.push(`| ${dutch} | ${english} | Auto-added | ${date} |`);
      }
    }

    if (newRows.length > 0 && fs.existsSync(GLOSSARY_FILE)) {
      fs.appendFileSync(GLOSSARY_FILE, '\n' + newRows.join('\n'), 'utf-8');
    }
  } catch (error) {
    console.error('[Translate] Glossary append error:', error.message);
  }
}

module.exports = router;
