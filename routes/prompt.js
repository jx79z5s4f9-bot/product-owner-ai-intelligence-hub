/**
 * Prompt Route
 * ALWAYS extracts entities and ALWAYS saves output
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const entityExtractor = require('../services/entity-extractor');
const fileSaver = require('../services/file-saver');

const os = require('os');

const OLLAMA_URL = 'http://localhost:11434/api/generate';
const MODEL = 'mistral';

// Load .md guide content from new location
const MD_BASE = path.join(os.homedir(), 'ProductOwnerAI', 'orchestrator');
const LEGACY_MD_BASE = path.join(__dirname, '..', 'Product ownership AI');

function loadGuideContent(filename) {
  const possiblePaths = [
    // New location first
    path.join(MD_BASE, filename),
    path.join(MD_BASE, 'prompts', filename),
    path.join(MD_BASE, 'best-practices', filename),
    // Fallback to legacy location
    path.join(LEGACY_MD_BASE, filename),
    path.join(LEGACY_MD_BASE, 'prompts', filename),
    path.join(LEGACY_MD_BASE, 'best-practices', filename)
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf-8');
    }
  }
  return null;
}

/**
 * POST /api/prompt
 * Body: { prompt, mode, selectedCards, rteName }
 */
router.post('/', async (req, res) => {
  const { prompt, mode = 'debrief', selectedCards = [], rteName = 'default' } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt required' });
  }

  console.log(`[Prompt] Mode: ${mode}, RTE: ${rteName}, Cards: ${selectedCards.length}, Prompt length: ${prompt.length}`);

  try {
    // STEP 1: ALWAYS extract entities from user input
    console.log('[Prompt] Step 1: Extracting entities...');
    const extraction = await entityExtractor.extract(prompt);
    console.log(`[Prompt] Extracted: ${extraction.entities.length} entities, ${extraction.relationships.length} relationships`);

    // STEP 2: Load selected .md guides (or default to orchestrator)
    let guideContext = '';
    const guidesToLoad = selectedCards.length > 0 ? selectedCards : ['workflow-orchestrator-v2.md'];

    for (const guide of guidesToLoad) {
      const content = loadGuideContent(guide);
      if (content) {
        guideContext += `\n\n## Guide: ${guide}\n${content}\n`;
      }
    }

    // STEP 3: Build LLM prompt based on mode
    const systemPrompt = buildSystemPrompt(mode, guideContext, extraction);
    const fullPrompt = `${systemPrompt}\n\nUSER INPUT:\n${prompt}\n\nRESPONSE:`;

    // STEP 4: Call Ollama for response
    console.log('[Prompt] Step 2: Calling Ollama...');
    console.log(`[Prompt] Mode: ${mode}, Model: ${MODEL}`);
    console.log(`[Prompt] System prompt length: ${systemPrompt.length}, Full prompt length: ${fullPrompt.length}`);
    const ollamaResponse = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt: fullPrompt,
        stream: false,
        options: { temperature: 0.7, num_predict: 4000 }
      })
    });

    if (!ollamaResponse.ok) {
      throw new Error(`Ollama error: ${ollamaResponse.status}`);
    }

    const ollamaData = await ollamaResponse.json();
    const aiResponse = ollamaData.response || '';

    // STEP 5: Save to file (skip for retrieve mode - user can choose to save)
    let savedFile = null;
    let persistenceStats = null;
    if (mode !== 'retrieve') {
      console.log('[Prompt] Step 3: Saving file...');
      const title = extractTitle(prompt) || extractTitle(aiResponse) || `${mode}-output`;

      savedFile = fileSaver.save(mode, aiResponse, {
        title,
        entities: extraction.entities,
        relationships: extraction.relationships,
        sections: extraction.sections,
        selectedCards: guidesToLoad,
        rteName
      });

      // Also extract from the AI response and persist (in addition to user input extraction)
      console.log('[Prompt] Step 4: Extracting from AI response...');
      try {
        const intelligencePersistence = require('../services/intelligence-persistence');
        const rteId = intelligencePersistence.getRteIdByName(rteName);
        
        if (rteId) {
          // Extract from AI response (may contain additional entities)
          const responseExtraction = await entityExtractor.extract(aiResponse, { rteId });
          
          // Merge with user input extraction
          const mergedExtraction = {
            entities: [...extraction.entities, ...responseExtraction.entities],
            relationships: [...extraction.relationships, ...responseExtraction.relationships]
          };
          
          // Persist to RTE-scoped tables
          persistenceStats = intelligencePersistence.save(mergedExtraction, rteId, savedFile.filepath);
          console.log(`[Prompt] Persisted: ${persistenceStats.actors} actors, ${persistenceStats.relationships} relationships`);
        }
      } catch (persistError) {
        console.error('[Prompt] Persistence error:', persistError.message);
      }

      console.log(`[Prompt] Complete. Saved to: ${savedFile.filename}`);
    } else {
      console.log('[Prompt] Retrieve mode - not auto-saving (user can save manually)');
    }

    // Return response
    res.json({
      success: true,
      response: aiResponse,
      extraction: {
        entities: extraction.entities,
        relationships: extraction.relationships,
        sections: extraction.sections
      },
      savedFile: savedFile ? {
        filename: savedFile.filename,
        filepath: savedFile.filepath
      } : null,
      persistence: persistenceStats,
      mode,
      guidesUsed: guidesToLoad,
      autoSaved: mode !== 'retrieve'
    });

  } catch (error) {
    console.error('[Prompt] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

function buildSystemPrompt(mode, guideContext, extraction) {
  let systemPrompt = `You are PO AI, a Product Ownership assistant.

${guideContext}

EXTRACTED ENTITIES FROM USER INPUT:
${JSON.stringify(extraction.entities, null, 2)}

EXTRACTED RELATIONSHIPS:
${JSON.stringify(extraction.relationships, null, 2)}

`;

  switch (mode) {
    case 'debrief':
      systemPrompt += `
MODE: DEBRIEF - DO NOT SIMPLY REPEAT THE INPUT
You MUST transform and restructure the user's raw daily log input.

INSTRUCTIONS:
1. **DO NOT** echo back or copy the original text
2. **CREATE** a structured summary with clear markdown headers
3. **ORGANIZE** by topic/theme/project (not chronologically)
4. **EXTRACT** and list action items, blockers, and priorities
5. **IDENTIFY** people, teams, systems, and their roles/relationships
6. **HIGHLIGHT** critical path items (deadlines, dependencies, Q2/Q3 plans)
7. **FORMAT** as clean, organized markdown with H2 headers for sections

OUTPUT STRUCTURE:
- Project/System Overview (what it's about)
- Key Activities (what was done, grouped logically)
- Action Items (clear, bullet-pointed TO-DOs)
- Blockers & Dependencies (what's blocking progress)
- People & Roles (who's involved, their responsibilities)
- Timeline & Priorities (when things happen, what's critical)
- Next Steps (clear follow-ups)

CRITICAL: Your response should be SUBSTANTIALLY DIFFERENT from the input - reorganized, summarized, and structured.`;
      break;

    case 'create':
      systemPrompt += `
MODE: CREATE - GENERATE NEW STRUCTURED CONTENT
DO NOT echo the user input. Instead, generate well-structured output.

INSTRUCTIONS:
1. Use the loaded guides as templates/references
2. CREATE original, structured output
3. Fill in all required sections from the template
4. Be specific, actionable, and complete
5. Use clear markdown formatting with headers

Your output should be a properly formatted document, NOT a summary of the input.`;
      break;

    case 'retrieve':
      systemPrompt += `
MODE: RETRIEVE - ANSWER THE QUESTION DIRECTLY
The user has a question. Answer it based on your knowledge and the guides.

INSTRUCTIONS:
1. Answer the question directly and clearly
2. Provide specific, actionable information
3. Reference the loaded guides when relevant
4. Do NOT simply repeat or echo the question
5. Be concise but thorough

Format your answer as clean markdown.`;
      break;

    default:
      systemPrompt += `
Process the user's input and provide a helpful, structured response.
Format as clean markdown.`;
  }

  return systemPrompt;
}

function extractTitle(text) {
  const headerMatch = text.match(/^##?\s+(.+)$/m);
  if (headerMatch) return headerMatch[1].trim();

  const firstLine = text.split('\n')[0].trim();
  if (firstLine && firstLine.length > 5 && firstLine.length < 100) {
    return firstLine.replace(/^[#\-*]+\s*/, '');
  }
  return null;
}

/**
 * POST /api/prompt/save
 * Manually save a response (for retrieve mode)
 */
router.post('/save', (req, res) => {
  const { content, mode = 'retrieve', rteName = 'default', title } = req.body;

  if (!content) {
    return res.status(400).json({ error: 'Content required' });
  }

  try {
    const savedFile = fileSaver.save(mode, content, {
      title: title || `${mode}-output`,
      rteName
    });

    res.json({
      success: true,
      savedFile: {
        filename: savedFile.filename,
        filepath: savedFile.filepath
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
