/**
 * Deep Document Analysis Routes
 * Heavy single-document processing with user control
 * 
 * Unlike regular ingest (light/fast), this is for:
 * - Architecture documents
 * - Strategy documents
 * - Complex meeting notes
 * - Requirements documents
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../db/connection');

// Ollama configuration
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';

// In-memory progress state for SSE
let analysisProgress = {
  active: false,
  startTime: null,
  totalChunks: 0,
  currentChunk: 0,
  chunkResults: [], // { chunk, status, systems, actors, relationships }
  filename: null,
  model: null
};

// Store last analysis session for retry functionality
let lastAnalysisSession = {
  chunks: [],           // Original document chunks
  chunkAnalyses: [],    // Analysis results per chunk
  chunkEntities: [],    // Extracted entities per chunk
  model: null,
  template: null,
  customInstructions: '',
  filename: null
};

// SSE clients listening for progress updates
let progressClients = [];

// Analysis type templates
const ANALYSIS_TEMPLATES = {
  architecture: {
    name: 'Architecture Document',
    icon: '🏗️',
    prompt: `Je bent een enterprise architect die documentatie analyseert.

Analyseer dit document en extraheer de volgende secties. Gebruik EXACT deze kopjes:

## Samenvatting
(3-5 zinnen over het document)

## Systemen & Componenten
Lijst alle systemen als bullet points met bold naam:
- **Systeemnaam**: beschrijving

## Actoren
Lijst alle actoren (teams, rollen, organisaties) als:
- **Actornaam**: beschrijving of rol

## Relaties
Lijst alle koppelingen tussen systemen als:
- **Systeem A** → **Systeem B**: type verbinding

## Beslissingen
Lijst belangrijke beslissingen met rationale

## Risico's
Lijst risico's en aandachtspunten

## Implementatie
Praktische overwegingen

Wees uitgebreid. Gebruik Nederlandse termen waar van toepassing.`,
    entityTypes: ['system', 'component', 'team', 'interface']
  },
  
  strategy: {
    name: 'Strategy Document',
    icon: '🎯',
    prompt: `Je bent een strategisch adviseur die beleidsdocumenten analyseert.

Analyseer dit document en extraheer:

1. **Samenvatting** (3-5 zinnen)
2. **Strategische Doelen** (korte en lange termijn)
3. **Prioriteiten** (met onderbouwing)
4. **Beslissingen** (wat is besloten en waarom)
5. **Stakeholders** (wie zijn betrokken)
6. **Afhankelijkheden** (wat moet eerst)
7. **Risico's & Mitigaties**
8. **Volgende Stappen**

Formatteer als Markdown met duidelijke koppen.`,
    entityTypes: ['goal', 'stakeholder', 'decision', 'risk']
  },
  
  meeting: {
    name: 'Meeting Notes',
    icon: '📋',
    prompt: `Je bent een project manager die vergadernotities analyseert.

Analyseer dit document en extraheer:

1. **Samenvatting** (3-5 zinnen - waar ging het over)
2. **Aanwezigen** (personen en hun rol)
3. **Actiepunten** (wie, wat, wanneer)
4. **Beslissingen** (wat is er besloten)
5. **Open Vragen** (onbeantwoorde zaken)
6. **Risico's/Blokkades** (wat houdt zaken tegen)
7. **Volgende Stappen**

Formatteer als Markdown. Gebruik checkboxes voor acties: - [ ] Actie`,
    entityTypes: ['person', 'action', 'decision', 'blocker']
  },
  
  requirements: {
    name: 'Requirements Document',
    icon: '📝',
    prompt: `Je bent een business analyst die requirements analyseert.

Analyseer dit document en extraheer:

1. **Samenvatting** (wat wordt er gebouwd)
2. **Functionele Requirements** (wat moet het doen)
3. **Non-Functionele Requirements** (performance, security, etc)
4. **Actoren/Gebruikers** (wie gebruikt het)
5. **Systemen & Interfaces** (waarmee integreert het)
6. **Constraints** (beperkingen)
7. **Acceptatiecriteria** (wanneer is het af)
8. **Open Punten**

Formatteer als Markdown met genummerde items waar gepast.`,
    entityTypes: ['requirement', 'user', 'system', 'constraint']
  },
  
  custom: {
    name: 'Custom Analysis',
    icon: '⚡',
    prompt: `Analyseer dit document.`,
    entityTypes: []
  }
};

// Recommended models for Dutch
const RECOMMENDED_MODELS = [
  { id: 'mistral:7b', name: 'Mistral 7B', recommended: true, note: 'Best for Dutch' },
  { id: 'llama3.1:8b', name: 'Llama 3.1 8B', recommended: false, note: 'Good general' },
  { id: 'gemma2:9b', name: 'Gemma 2 9B', recommended: false, note: 'Good for Dutch' },
  { id: 'deepseek-r1:7b', name: 'DeepSeek R1 7B', recommended: false, note: 'Reasoning' },
  { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B', recommended: false, note: 'Multilingual' }
];

/**
 * GET /api/analyze/templates
 * Get available analysis templates
 */
router.get('/templates', (req, res) => {
  const templates = Object.entries(ANALYSIS_TEMPLATES).map(([key, value]) => ({
    id: key,
    name: value.name,
    icon: value.icon,
    entityTypes: value.entityTypes
  }));
  
  res.json({ templates, models: RECOMMENDED_MODELS });
});

/**
 * GET /api/analyze/models
 * Get available Ollama models
 */
router.get('/models', async (req, res) => {
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`);
    if (!response.ok) {
      return res.json({ models: RECOMMENDED_MODELS, available: [] });
    }
    
    const data = await response.json();
    const available = data.models?.map(m => m.name) || [];
    
    // Merge recommended with available
    const models = RECOMMENDED_MODELS.map(m => ({
      ...m,
      available: available.some(a => a.startsWith(m.id.split(':')[0]))
    }));
    
    res.json({ models, available });
  } catch (error) {
    res.json({ models: RECOMMENDED_MODELS, available: [], error: error.message });
  }
});

/**
 * GET /api/analyze/progress
 * Server-Sent Events endpoint for real-time progress updates
 */
router.get('/progress', (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // Send current state immediately
  const sendProgress = () => {
    const data = JSON.stringify({
      active: analysisProgress.active,
      startTime: analysisProgress.startTime,
      totalChunks: analysisProgress.totalChunks,
      currentChunk: analysisProgress.currentChunk,
      chunkResults: analysisProgress.chunkResults,
      filename: analysisProgress.filename,
      model: analysisProgress.model,
      elapsedMs: analysisProgress.startTime ? Date.now() - analysisProgress.startTime : 0
    });
    res.write(`data: ${data}\n\n`);
  };
  
  // Send initial state
  sendProgress();
  
  // Add client to list
  progressClients.push(res);
  
  // Remove on disconnect
  req.on('close', () => {
    progressClients = progressClients.filter(client => client !== res);
  });
});

/**
 * Broadcast progress update to all SSE clients
 */
function broadcastProgress() {
  const data = JSON.stringify({
    active: analysisProgress.active,
    startTime: analysisProgress.startTime,
    totalChunks: analysisProgress.totalChunks,
    currentChunk: analysisProgress.currentChunk,
    chunkResults: analysisProgress.chunkResults,
    filename: analysisProgress.filename,
    model: analysisProgress.model,
    elapsedMs: analysisProgress.startTime ? Date.now() - analysisProgress.startTime : 0
  });
  
  progressClients.forEach(client => {
    try {
      client.write(`data: ${data}\n\n`);
    } catch (e) {
      // Client disconnected
    }
  });
}

/**
 * POST /api/analyze/retry-chunk
 * Retry a failed chunk from the last analysis session
 */
router.post('/retry-chunk', async (req, res) => {
  const { chunkIndex } = req.body;
  
  if (chunkIndex === undefined || chunkIndex < 0) {
    return res.status(400).json({ error: 'Invalid chunk index' });
  }
  
  if (!lastAnalysisSession.chunks || lastAnalysisSession.chunks.length === 0) {
    return res.status(400).json({ error: 'No analysis session available for retry' });
  }
  
  if (chunkIndex >= lastAnalysisSession.chunks.length) {
    return res.status(400).json({ error: 'Chunk index out of range' });
  }
  
  const { chunks, model, template, customInstructions } = lastAnalysisSession;
  
  console.log(`[Analyze] Retrying chunk ${chunkIndex + 1}/${chunks.length}`);
  
  // Update progress to show retrying
  if (analysisProgress.chunkResults && analysisProgress.chunkResults[chunkIndex]) {
    analysisProgress.chunkResults[chunkIndex].status = 'processing';
    broadcastProgress();
  }
  
  try {
    const chunkPrompt = `${template.prompt}

Dit is DEEL ${chunkIndex + 1} van ${chunks.length} van een groot document.
Focus op het extraheren van alle systemen, actoren en relaties uit dit deel.

${customInstructions ? `Aanvullende instructies: ${customInstructions}\n` : ''}
---
DOCUMENT DEEL ${chunkIndex + 1}/${chunks.length}:
${chunks[chunkIndex]}`;

    const chunkResult = await callOllama(model, chunkPrompt);
    
    if (chunkResult.error) {
      console.error(`[Analyze] Retry chunk ${chunkIndex + 1} failed:`, chunkResult.error);
      if (analysisProgress.chunkResults && analysisProgress.chunkResults[chunkIndex]) {
        analysisProgress.chunkResults[chunkIndex].status = 'failed';
        broadcastProgress();
      }
      return res.status(500).json({ error: chunkResult.error });
    }
    
    // Extract entities from this chunk
    const chunkEntities = extractEntitiesFromAnalysis(chunkResult.response, template.entityTypes);
    
    // Store for session
    lastAnalysisSession.chunkAnalyses[chunkIndex] = chunkResult.response;
    lastAnalysisSession.chunkEntities[chunkIndex] = chunkEntities;
    
    // Update progress
    if (analysisProgress.chunkResults && analysisProgress.chunkResults[chunkIndex]) {
      analysisProgress.chunkResults[chunkIndex].status = 'done';
      analysisProgress.chunkResults[chunkIndex].systems = chunkEntities.systems?.length || 0;
      analysisProgress.chunkResults[chunkIndex].actors = chunkEntities.actors?.length || 0;
      analysisProgress.chunkResults[chunkIndex].relationships = chunkEntities.relationships?.length || 0;
      broadcastProgress();
    }
    
    console.log(`[Analyze] Retry chunk ${chunkIndex + 1} succeeded: ${chunkEntities.systems?.length || 0} systems, ${chunkEntities.actors?.length || 0} actors, ${chunkEntities.relationships?.length || 0} relationships`);
    
    // Recalculate merged entities from all successful chunks
    let allEntities = { systems: [], actors: [], relationships: [], decisions: [], actions: [] };
    for (const entities of lastAnalysisSession.chunkEntities) {
      if (entities) {
        mergeEntities(allEntities, entities);
      }
    }
    
    res.json({
      success: true,
      chunkIndex,
      entities: chunkEntities,
      totalEntities: {
        systems: allEntities.systems.length,
        actors: allEntities.actors.length,
        relationships: allEntities.relationships.length
      }
    });
    
  } catch (error) {
    console.error(`[Analyze] Retry chunk ${chunkIndex + 1} error:`, error);
    if (analysisProgress.chunkResults && analysisProgress.chunkResults[chunkIndex]) {
      analysisProgress.chunkResults[chunkIndex].status = 'failed';
      broadcastProgress();
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analyze/session
 * Get the current analysis session state for retry UI
 */
router.get('/session', (req, res) => {
  res.json({
    hasSession: lastAnalysisSession.chunks && lastAnalysisSession.chunks.length > 0,
    totalChunks: lastAnalysisSession.chunks?.length || 0,
    filename: lastAnalysisSession.filename,
    model: lastAnalysisSession.model,
    chunkStates: lastAnalysisSession.chunkEntities?.map((entities, i) => ({
      chunk: i + 1,
      hasResult: entities !== null,
      systems: entities?.systems?.length || 0,
      actors: entities?.actors?.length || 0,
      relationships: entities?.relationships?.length || 0
    })) || []
  });
});

/**
 * GET /api/analyze/last
 * Get the most recent saved analysis result
 */
router.get('/last', (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const resultsDir = path.join(__dirname, '..', 'data', 'analysis-results');
    
    if (!fs.existsSync(resultsDir)) {
      return res.json({ success: false, error: 'No saved analyses found' });
    }
    
    const files = fs.readdirSync(resultsDir)
      .filter(f => f.startsWith('analysis-') && f.endsWith('.json'))
      .sort()
      .reverse();
    
    if (files.length === 0) {
      return res.json({ success: false, error: 'No saved analyses found' });
    }
    
    const lastFile = path.join(resultsDir, files[0]);
    const data = JSON.parse(fs.readFileSync(lastFile, 'utf-8'));
    data.recoveredFrom = files[0];
    
    res.json(data);
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * POST /api/analyze
 * Perform deep analysis on a document
 * 
 * Body:
 *   - content: Document content (required)
 *   - analysisType: 'architecture' | 'strategy' | 'meeting' | 'requirements' | 'custom'
 *   - model: Ollama model to use (default: mistral:7b)
 *   - customInstructions: Additional user instructions
 *   - filename: Optional filename for saving
 */
router.post('/', async (req, res) => {
  const { 
    content, 
    analysisType = 'architecture', 
    model = 'mistral:latest',
    customInstructions = '',
    filename = null
  } = req.body;

  if (!content || content.trim().length === 0) {
    return res.status(400).json({ error: 'Document content is required' });
  }

  const startTime = Date.now();
  const template = ANALYSIS_TEMPLATES[analysisType] || ANALYSIS_TEMPLATES.custom;

  // Chunk threshold: ~20K chars is about 5K tokens, leaving room for prompt and response
  const CHUNK_THRESHOLD = 20000;
  const MAX_CHUNK_SIZE = 15000;

  try {
    let finalAnalysis = '';
    let allEntities = { systems: [], actors: [], relationships: [], decisions: [], actions: [] };
    let chunkCount = 1;

    if (content.length > CHUNK_THRESHOLD) {
      // Large document - split into chunks
      const chunks = splitDocumentIntoChunks(content, MAX_CHUNK_SIZE);
      chunkCount = chunks.length;
      console.log(`[Analyze] Large document (${content.length} chars) - splitting into ${chunks.length} chunks`);

      // Initialize progress tracking
      analysisProgress = {
        active: true,
        startTime: startTime,
        totalChunks: chunks.length,
        currentChunk: 0,
        chunkResults: chunks.map((_, i) => ({
          chunk: i + 1,
          status: 'pending',
          systems: 0,
          actors: 0,
          relationships: 0
        })),
        filename: filename,
        model: model
      };
      broadcastProgress();

      // Initialize retry session storage
      lastAnalysisSession = {
        chunks: chunks,
        chunkAnalyses: new Array(chunks.length).fill(null),
        chunkEntities: new Array(chunks.length).fill(null),
        model: model,
        template: template,
        customInstructions: customInstructions,
        filename: filename
      };

      const chunkResults = [];

      for (let i = 0; i < chunks.length; i++) {
        console.log(`[Analyze] Processing chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)`);
        
        // Update progress: mark current chunk as in-progress
        analysisProgress.currentChunk = i + 1;
        analysisProgress.chunkResults[i].status = 'processing';
        broadcastProgress();
        
        const chunkPrompt = `${template.prompt}

Dit is DEEL ${i + 1} van ${chunks.length} van een groot document.
Focus op het extraheren van alle systemen, actoren en relaties uit dit deel.

${customInstructions ? `Aanvullende instructies: ${customInstructions}\n` : ''}
---
DOCUMENT DEEL ${i + 1}/${chunks.length}:
${chunks[i]}`;

        const chunkResult = await callOllama(model, chunkPrompt);
        if (chunkResult.error) {
          console.error(`[Analyze] Chunk ${i + 1} failed:`, chunkResult.error);
          // Update progress: mark as failed
          analysisProgress.chunkResults[i].status = 'failed';
          broadcastProgress();
          continue;
        }

        chunkResults.push({
          part: i + 1,
          analysis: chunkResult.response
        });

        // Extract entities from this chunk
        const chunkEntities = extractEntitiesFromAnalysis(chunkResult.response, template.entityTypes);
        mergeEntities(allEntities, chunkEntities);
        
        // Store for retry functionality
        lastAnalysisSession.chunkAnalyses[i] = chunkResult.response;
        lastAnalysisSession.chunkEntities[i] = chunkEntities;
        
        // Update progress: mark as done with entity counts
        analysisProgress.chunkResults[i].status = 'done';
        analysisProgress.chunkResults[i].systems = chunkEntities.systems?.length || 0;
        analysisProgress.chunkResults[i].actors = chunkEntities.actors?.length || 0;
        analysisProgress.chunkResults[i].relationships = chunkEntities.relationships?.length || 0;
        broadcastProgress();
      }

      // Combine chunk results
      if (chunkResults.length > 0) {
        // Create a merged analysis with clear sections
        finalAnalysis = `# Analyse van ${filename || 'Document'}\n\n`;
        finalAnalysis += `*Document geanalyseerd in ${chunks.length} delen*\n\n`;
        
        // If we have more than 2 chunks, create a summary first
        if (chunkResults.length > 2) {
          console.log(`[Analyze] Creating summary from ${chunkResults.length} chunk analyses`);
          const summaryPrompt = `Je hebt een groot document geanalyseerd in ${chunkResults.length} delen.
Hier zijn de analyses van elk deel. Maak een samenhangende samenvatting met:

## Samenvatting
(Belangrijkste punten uit het hele document)

## Alle Systemen & Componenten
(Verzamel alle systemen uit alle delen, verwijder duplicaten)

## Alle Actoren
(Verzamel alle actoren uit alle delen, verwijder duplicaten)

## Alle Relaties
(Verzamel alle relaties/koppelingen uit alle delen)

## Belangrijkste Beslissingen

## Risico's

---
DEELANALYSES:

${chunkResults.map(r => `### Deel ${r.part}\n${r.analysis}`).join('\n\n---\n\n')}`;

          const summaryResult = await callOllama(model, summaryPrompt);
          if (!summaryResult.error) {
            finalAnalysis = summaryResult.response;
            // Keep the merged chunk entities - don't re-extract from summary
            // (summary is condensed narrative, loses entity details)
          } else {
            // Fallback: just concatenate
            finalAnalysis += chunkResults.map(r => 
              `## Deel ${r.part}\n\n${r.analysis}`
            ).join('\n\n---\n\n');
          }
        } else {
          // Just 1-2 chunks, combine directly
          finalAnalysis += chunkResults.map(r => r.analysis).join('\n\n---\n\n');
        }
      }
    } else {
      // Small document - analyze in one go
      let fullPrompt = template.prompt;
      
      if (customInstructions.trim()) {
        fullPrompt += `\n\nAanvullende instructies van gebruiker:\n${customInstructions}`;
      }
      
      fullPrompt += `\n\n---\nDOCUMENT:\n${content}`;

      console.log(`[Analyze] Starting ${analysisType} analysis with ${model} (${content.length} chars)`);

      const result = await callOllama(model, fullPrompt);
      
      if (result.error) {
        return res.status(500).json({ 
          error: `Model ${model} failed. Is it installed? Try: ollama pull ${model}`,
          details: result.error
        });
      }

      finalAnalysis = result.response;
      allEntities = extractEntitiesFromAnalysis(finalAnalysis, template.entityTypes);
    }

    const processingTime = Date.now() - startTime;

    // Mark analysis as complete
    analysisProgress.active = false;
    broadcastProgress();

    console.log(`[Analyze] Complete in ${processingTime}ms (${chunkCount} chunks)`);
    console.log(`[Analyze] Response length: ${finalAnalysis.length} chars`);
    console.log(`[Analyze] Extracted: ${allEntities.systems.length} systems, ${allEntities.actors.length} actors, ${allEntities.relationships.length} relationships`);

    // Auto-save results to disk (in case of network issues)
    const resultData = {
      success: true,
      analysis: finalAnalysis,
      metadata: {
        model,
        analysisType,
        processingTimeMs: processingTime,
        inputLength: content.length,
        outputLength: finalAnalysis.length,
        chunks: chunkCount,
        timestamp: new Date().toISOString()
      },
      entities: allEntities,
      filename
    };
    
    try {
      const fs = require('fs');
      const path = require('path');
      const resultsDir = path.join(__dirname, '..', 'data', 'analysis-results');
      if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir, { recursive: true });
      }
      const resultFile = path.join(resultsDir, `analysis-${Date.now()}.json`);
      fs.writeFileSync(resultFile, JSON.stringify(resultData, null, 2));
      console.log(`[Analyze] Results saved to ${resultFile}`);
    } catch (saveErr) {
      console.error('[Analyze] Failed to save results:', saveErr.message);
    }

    res.json(resultData);

  } catch (error) {
    console.error('[Analyze] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Helper: Call Ollama API
 */
async function callOllama(model, prompt) {
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature: 0.2,
          num_predict: 4000,
          num_ctx: 8192
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { error: errorText };
    }

    const data = await response.json();
    return { response: data.response || '' };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Split document into chunks, trying to respect paragraph boundaries
 */
function splitDocumentIntoChunks(content, maxChunkSize) {
  const chunks = [];
  
  // If content is small enough, return as-is
  if (content.length <= maxChunkSize) {
    return [content];
  }
  
  // Split by double newlines (paragraphs) or single newlines
  const paragraphs = content.split(/\n\n+/);
  
  let currentChunk = '';
  
  for (const para of paragraphs) {
    // If adding this paragraph would exceed max, save current chunk
    if (currentChunk.length + para.length + 2 > maxChunkSize) {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      
      // If single paragraph is too large, split by sentences or just force split
      if (para.length > maxChunkSize) {
        // Try to split by sentences
        const sentences = para.split(/(?<=[.!?])\s+/);
        let subChunk = '';
        for (const sentence of sentences) {
          if (subChunk.length + sentence.length > maxChunkSize) {
            if (subChunk.trim()) chunks.push(subChunk.trim());
            // If single sentence is too long, force split
            if (sentence.length > maxChunkSize) {
              for (let i = 0; i < sentence.length; i += maxChunkSize) {
                chunks.push(sentence.substring(i, i + maxChunkSize));
              }
              subChunk = '';
            } else {
              subChunk = sentence;
            }
          } else {
            subChunk += (subChunk ? ' ' : '') + sentence;
          }
        }
        if (subChunk.trim()) chunks.push(subChunk.trim());
        currentChunk = '';
      } else {
        currentChunk = para;
      }
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + para;
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  console.log(`[Analyze] Split ${content.length} chars into ${chunks.length} chunks (avg ${Math.round(content.length / chunks.length)} chars each)`);
  
  return chunks.length > 0 ? chunks : [content];
}

/**
 * Merge entities from multiple chunks, avoiding duplicates
 */
function mergeEntities(target, source) {
  // Merge systems
  for (const sys of source.systems) {
    if (!target.systems.find(s => s.name.toLowerCase() === sys.name.toLowerCase())) {
      target.systems.push(sys);
    }
  }
  
  // Merge actors
  for (const actor of source.actors) {
    if (!target.actors.find(a => a.name.toLowerCase() === actor.name.toLowerCase())) {
      target.actors.push(actor);
    }
  }
  
  // Merge relationships (check both from and to)
  for (const rel of source.relationships) {
    const exists = target.relationships.find(r => 
      r.from.toLowerCase() === rel.from.toLowerCase() && 
      r.to.toLowerCase() === rel.to.toLowerCase()
    );
    if (!exists) {
      target.relationships.push(rel);
    }
  }
  
  // Merge decisions (simple dedup by first 50 chars)
  for (const dec of source.decisions) {
    const prefix = dec.substring(0, 50).toLowerCase();
    if (!target.decisions.find(d => d.substring(0, 50).toLowerCase() === prefix)) {
      target.decisions.push(dec);
    }
  }
  
  // Merge actions
  for (const action of source.actions) {
    const prefix = action.substring(0, 50).toLowerCase();
    if (!target.actions.find(a => a.substring(0, 50).toLowerCase() === prefix)) {
      target.actions.push(action);
    }
  }
}

/**
 * Extract structured entities from the analysis text
 * This is a simple extraction - could be enhanced with another LLM call
 */
function extractEntitiesFromAnalysis(analysis, entityTypes) {
  const entities = {
    systems: [],
    actors: [],
    relationships: [],
    decisions: [],
    actions: []
  };

  // Simple pattern matching for common structures
  const lines = analysis.split('\n');
  let currentSection = null;

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Detect sections (## Header or **Header**)
    if (trimmed.startsWith('## ')) {
      currentSection = trimmed.substring(3).toLowerCase();
      continue;
    }
    if (trimmed.startsWith('**') && trimmed.endsWith('**') && !trimmed.includes(':')) {
      currentSection = trimmed.replace(/\*\*/g, '').toLowerCase();
      continue;
    }

    // Extract bullet points
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || /^\d+\.\s/.test(trimmed)) {
      const item = trimmed.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').trim();
      
      // Categorize based on current section
      const isSystemSection = currentSection?.includes('systeem') || currentSection?.includes('system') || 
                              currentSection?.includes('component') || currentSection?.includes('applicat');
      const isActorSection = currentSection?.includes('actor') || currentSection?.includes('team') || 
                             currentSection?.includes('aanwezig') || currentSection?.includes('stakeholder') ||
                             currentSection?.includes('partij') || currentSection?.includes('organisat');
      const isRelationSection = currentSection?.includes('relat') || currentSection?.includes('koppel') ||
                                currentSection?.includes('integratie') || currentSection?.includes('interface');
      
      if (isSystemSection) {
        // Extract system name (bold or before colon)
        const boldMatch = item.match(/\*\*([^*]+)\*\*/);
        const colonMatch = item.match(/^([^:]+):\s*(.+)/);
        if (boldMatch) {
          entities.systems.push({
            name: boldMatch[1].trim(),
            description: item.replace(/\*\*[^*]+\*\*:?\s*/, '').trim()
          });
        } else if (colonMatch) {
          entities.systems.push({
            name: colonMatch[1].trim(),
            description: colonMatch[2].trim()
          });
        }
      } else if (isActorSection) {
        const boldMatch = item.match(/\*\*([^*]+)\*\*/);
        const colonMatch = item.match(/^([^:]+):\s*(.+)/);
        if (boldMatch) {
          entities.actors.push({
            name: boldMatch[1].trim(),
            description: item.replace(/\*\*[^*]+\*\*:?\s*/, '').trim()
          });
        } else if (colonMatch) {
          entities.actors.push({
            name: colonMatch[1].trim(),
            description: colonMatch[2].trim()
          });
        } else if (item.length > 2 && item.length < 100) {
          // Just a name without description
          entities.actors.push({ name: item, description: '' });
        }
      } else if (isRelationSection) {
        // Look for arrow patterns: A → B or A -> B or A - B
        const arrowMatch = item.match(/\*?\*?([^*→>\-]+)\*?\*?\s*(?:→|->|–)\s*\*?\*?([^*:]+)\*?\*?:?\s*(.*)/);
        if (arrowMatch) {
          entities.relationships.push({
            from: arrowMatch[1].replace(/\*\*/g, '').trim(),
            to: arrowMatch[2].replace(/\*\*/g, '').trim(),
            type: arrowMatch[3].trim() || 'verbinding'
          });
        }
      } else if (currentSection?.includes('besliss') || currentSection?.includes('decision')) {
        if (item.length > 5) {
          entities.decisions.push(item);
        }
      } else if (currentSection?.includes('actie') || currentSection?.includes('action') || trimmed.includes('[ ]')) {
        entities.actions.push(item.replace(/^\[[ x]\]\s*/, ''));
      }
    }
  }

  console.log(`[Analyze] Extracted: ${entities.systems.length} systems, ${entities.actors.length} actors, ${entities.relationships.length} relationships`);
  
  return entities;
}

/**
 * POST /api/analyze/import
 * Import extracted entities into PO AI database
 */
router.post('/import', (req, res) => {
  const { entities, rteId, sourceFilename } = req.body;
  const db = getDb();

  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  if (!entities || !rteId) {
    return res.status(400).json({ error: 'entities and rteId required' });
  }

  try {
    const imported = {
      actors: 0,
      relationships: 0
    };

    // Import actors (systems and people)
    const insertActor = db.prepare(`
      INSERT OR IGNORE INTO rte_actors (rte_id, name, actor_type, description, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `);

    // Import systems
    for (const system of entities.systems || []) {
      try {
        insertActor.run(rteId, system.name, 'system', system.description || null);
        imported.actors++;
      } catch (e) {
        // Duplicate - ignore
      }
    }

    // Import actors/people
    for (const actor of entities.actors || []) {
      try {
        insertActor.run(rteId, actor.name, 'person', actor.description || null);
        imported.actors++;
      } catch (e) {
        // Duplicate - ignore
      }
    }

    // Import relationships (need to resolve actor IDs first)
    const findActor = db.prepare(`SELECT id FROM rte_actors WHERE rte_id = ? AND name = ?`);
    const insertRel = db.prepare(`
      INSERT OR IGNORE INTO rte_relationships (rte_id, source_actor_id, target_actor_id, relationship_type, context, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `);

    for (const rel of entities.relationships || []) {
      const fromActor = findActor.get(rteId, rel.from);
      const toActor = findActor.get(rteId, rel.to);
      
      if (fromActor && toActor) {
        try {
          insertRel.run(rteId, fromActor.id, toActor.id, rel.type, null);
          imported.relationships++;
        } catch (e) {
          // Duplicate - ignore
        }
      }
    }

    console.log(`[Analyze] Imported to RTE ${rteId}:`, imported);

    res.json({
      success: true,
      imported,
      message: `Imported ${imported.actors} actors and ${imported.relationships} relationships`
    });

  } catch (error) {
    console.error('[Analyze] Import error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
