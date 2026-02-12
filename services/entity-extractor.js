/**
 * Entity Extractor Service
 * Uses Ollama (mistral/aya) to extract people, roles, teams, relationships
 * Improved patterns for Dutch names and confidence scoring
 */

const OLLAMA_URL = 'http://localhost:11434/api/generate';

// Try multiple models in order of preference
const MODELS = ['mistral', 'aya:8b', 'llama3.2'];

class EntityExtractor {
  constructor() {
    this.currentModel = MODELS[0];
    
    // Dutch-aware stopwords and patterns
    this.stopwords = new Set([
      // English
      'The', 'This', 'That', 'These', 'Those', 'When', 'What', 'Where', 'How', 'Why', 'Which',
      'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
      'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
      'Sprint', 'Epic', 'Story', 'Task', 'Bug', 'Feature', 'Release', 'Version',
      'Meeting', 'Review', 'Retro', 'Planning', 'Standup', 'Demo',
      'TODO', 'DONE', 'BLOCKED', 'IN', 'PROGRESS',
      // Dutch
      'De', 'Het', 'Een', 'Dit', 'Dat', 'Deze', 'Die', 'Wanneer', 'Wat', 'Waar', 'Hoe', 'Waarom',
      'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag',
      'Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni', 'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December',
      // Common markdown/technical
      'Status', 'Update', 'Notes', 'Summary', 'Overview', 'Context', 'Background',
      'Issue', 'Problem', 'Solution', 'Action', 'Next', 'Steps', 'Follow', 'Up',
      'SAP', 'Matcher', 'POV'
    ]);
    
    // Dutch name patterns (common prefixes and suffixes)
    this.dutchNamePrefixes = ['van', 'de', 'den', 'der', 'het', 'ter', 'ten', 'op', 'in'];
    this.dutchNamePattern = /\b([A-Z][a-z]+(?:\s+(?:van|de|den|der|het|ter|ten|op|in)\s+)?(?:(?:van|de|den|der|het|ter|ten|op|in)\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;
  }

  /**
   * Extract entities from user input
   * @param {string} text - User's input text
   * @param {object} options - Extraction options
   * @returns {Promise<{entities: Array, relationships: Array, sections: Array, confidence: number}>}
   */
  async extract(text, options = {}) {
    const { rteId, documentId, skipLLM = false } = options;
    
    if (skipLLM) {
      const result = this.patternExtract(text);
      result.source = 'pattern';
      return result;
    }

    // Try LLM extraction with fallback chain
    for (const model of MODELS) {
      try {
        const result = await this.llmExtract(text, model);
        if (result.entities.length > 0 || result.relationships.length > 0) {
          result.source = 'llm';
          result.model = model;
          return result;
        }
      } catch (error) {
        console.error(`[EntityExtractor] ${model} failed:`, error.message);
      }
    }

    // Final fallback: pattern-based
    console.log('[EntityExtractor] All LLMs failed, using pattern fallback');
    const result = this.patternExtract(text);
    result.source = 'pattern';
    return result;
  }

  async llmExtract(text, model) {
    const prompt = this.buildExtractionPrompt(text);

    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        stream: false,
        options: { temperature: 0.1, num_predict: 2000 }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status}`);
    }

    const data = await response.json();
    return this.parseExtractionResult(data.response, text);
  }

  buildExtractionPrompt(text) {
    return `You are an entity extraction expert. Extract ALL mentioned entities from this text about product development and agile work.

TEXT:
"""
${text}
"""

EXTRACT AND CLASSIFY:
1. PERSON: Names of individuals (first name, full name, Dutch names with prefixes like "van de")
2. ROLE: Job titles (Product Owner, Scrum Master, Developer, Manager, Tech Lead, etc.)
3. TEAM: Team names (Backend team, Team Alpha, etc.)
4. SYSTEM: Software, tools, APIs, databases (Jira, API, Confluence, SAP, etc.)
5. ORGANIZATION: Companies, departments, clients
6. PROJECT: Project or epic names

Also extract RELATIONSHIPS:
- works_with: People who collaborate
- member_of: Person belongs to team
- owns: Person responsible for something
- depends_on: System/project dependencies
- reports_to: Reporting relationships
- blocks: Blockers between items

Return ONLY valid JSON:
{
  "entities": [
    {"name": "Jan van der Berg", "type": "person", "role": "Developer", "confidence": 0.95},
    {"name": "Product Owner", "type": "role", "confidence": 1.0},
    {"name": "Matcher API", "type": "system", "confidence": 0.9}
  ],
  "relationships": [
    {"source": "Jan", "target": "Backend Team", "type": "member_of", "context": "mentioned in standup", "confidence": 0.85}
  ],
  "sections": []
}

RULES:
- Extract EVERY person mentioned by name
- Confidence: 0.0-1.0 based on how explicit the mention is
- Keep original names exactly as written (including Dutch prefixes)
- Distinguish between person names and system/project names
- If no entities found, return empty arrays
- Return ONLY JSON, no explanations`;
  }

  parseExtractionResult(llmResponse, originalText) {
    try {
      // Clean up response - find JSON block
      let jsonStr = llmResponse.trim();
      
      // Extract JSON from markdown code blocks
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      } else {
        // Try to find raw JSON object
        const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (objectMatch) {
          jsonStr = objectMatch[0];
        }
      }

      const parsed = JSON.parse(jsonStr);

      // Add default confidence if not provided
      const entities = (parsed.entities || []).map(e => ({
        ...e,
        confidence: e.confidence || 0.8,
        actor_type: this.mapTypeToActorType(e.type)
      }));

      const relationships = (parsed.relationships || []).map(r => ({
        ...r,
        confidence: r.confidence || 0.7
      }));

      // Calculate overall confidence
      const avgConfidence = entities.length > 0 
        ? entities.reduce((sum, e) => sum + e.confidence, 0) / entities.length
        : 0;

      return {
        entities,
        relationships,
        sections: parsed.sections || [],
        confidence: avgConfidence
      };
    } catch (error) {
      console.error('[EntityExtractor] Parse error:', error.message);
      console.error('[EntityExtractor] Raw response:', llmResponse.substring(0, 200));
      return this.patternExtract(originalText);
    }
  }

  /**
   * Map old 'type' values to new 'actor_type' column values
   */
  mapTypeToActorType(type) {
    const mapping = {
      'person': 'person',
      'people': 'person',
      'role': 'role',
      'team': 'team',
      'system': 'system',
      'tool': 'system',
      'software': 'system',
      'organization': 'organization',
      'company': 'organization',
      'project': 'project',
      'epic': 'project'
    };
    return mapping[type?.toLowerCase()] || type || 'unknown';
  }

  /**
   * Improved pattern-based extraction with Dutch name support
   */
  patternExtract(text) {
    const entities = [];
    const relationships = [];
    const sections = [];
    const seenNames = new Set();

    // 1. Extract Dutch-style names (e.g., "Jan van der Berg", "Pieter de Vries")
    let match;
    while ((match = this.dutchNamePattern.exec(text)) !== null) {
      const name = match[1].trim();
      if (!this.isStopword(name) && !seenNames.has(name.toLowerCase())) {
        seenNames.add(name.toLowerCase());
        entities.push({ 
          name, 
          type: 'person', 
          actor_type: 'person',
          confidence: 0.7 
        });
      }
    }

    // 2. Extract simple capitalized names (2+ letters, not all caps)
    const simpleNamePattern = /\b([A-Z][a-z]{2,})\b/g;
    while ((match = simpleNamePattern.exec(text)) !== null) {
      const name = match[1];
      if (!this.isStopword(name) && !seenNames.has(name.toLowerCase()) && name.length > 2) {
        // Check if it looks like a name (not a common word)
        if (this.looksLikeName(name, text)) {
          seenNames.add(name.toLowerCase());
          entities.push({ 
            name, 
            type: 'person', 
            actor_type: 'person',
            confidence: 0.5  // Lower confidence for single names
          });
        }
      }
    }

    // 3. Extract roles with high confidence
    const rolePatterns = [
      // English roles
      /\b(Product\s*Owner|PO|Scrum\s*Master|SM|Tech\s*Lead|Team\s*Lead|Developer|Senior\s+Developer|Junior\s+Developer|Architect|Solution\s+Architect|Designer|UX\s+Designer|QA|QA\s+Engineer|Tester|Test\s+Engineer|Analyst|Business\s+Analyst|Manager|Project\s+Manager|Program\s+Manager|Director|VP|CEO|CTO|CFO|COO|DevOps|DevOps\s+Engineer|SRE)\b/gi,
      // Dutch roles
      /\b(Productowner|Projectleider|Teamleider|Ontwikkelaar|Ontwerper|Analist|Tester|Beheerder|Directeur)\b/gi
    ];

    for (const pattern of rolePatterns) {
      while ((match = pattern.exec(text)) !== null) {
        const role = match[1];
        if (!seenNames.has(role.toLowerCase())) {
          seenNames.add(role.toLowerCase());
          entities.push({ 
            name: role, 
            type: 'role', 
            actor_type: 'role',
            confidence: 0.9 
          });
        }
      }
    }

    // 4. Extract systems and tools
    const systemPatterns = [
      /\b(Jira|Confluence|GitHub|GitLab|Jenkins|Docker|Kubernetes|AWS|Azure|GCP|Slack|Teams|API|REST\s+API|GraphQL|Redis|PostgreSQL|MySQL|MongoDB|Elasticsearch)\b/gi,
      /\b([A-Z][a-z]+(?:API|Service|System|Platform|App|Tool|Database|DB))\b/g
    ];

    for (const pattern of systemPatterns) {
      while ((match = pattern.exec(text)) !== null) {
        const system = match[1];
        if (!seenNames.has(system.toLowerCase())) {
          seenNames.add(system.toLowerCase());
          entities.push({ 
            name: system, 
            type: 'system', 
            actor_type: 'system',
            confidence: 0.85 
          });
        }
      }
    }

    // 5. Extract sections from markdown headers
    const headerPattern = /^(#{1,3})\s+(.+)$/gm;
    while ((match = headerPattern.exec(text)) !== null) {
      const level = match[1].length;
      const title = match[2].trim();
      sections.push({
        title,
        level,
        start: match.index,
        summary: ''
      });
    }

    // Calculate overall confidence
    const avgConfidence = entities.length > 0 
      ? entities.reduce((sum, e) => sum + e.confidence, 0) / entities.length
      : 0;

    return { 
      entities, 
      relationships, 
      sections, 
      confidence: avgConfidence 
    };
  }

  /**
   * Check if a word is a stopword or common non-name
   */
  isStopword(word) {
    return this.stopwords.has(word);
  }

  /**
   * Heuristic to determine if a capitalized word is likely a name
   */
  looksLikeName(word, context) {
    // Single word heuristics
    if (word.length < 3) return false;
    if (word.toUpperCase() === word) return false; // All caps = likely acronym
    
    // Check if followed by role indicators
    const roleIndicators = /\b(is|as|our|the)\s+(a\s+)?(Product Owner|PO|Developer|Manager|Lead|Scrum Master)/i;
    const afterWord = context.substring(context.indexOf(word) + word.length, context.indexOf(word) + word.length + 50);
    if (roleIndicators.test(afterWord)) {
      return true;
    }

    // Check if preceded by name indicators
    const nameIndicators = /(met|with|by|from|to|@|Hi|Hello|Dear|Thanks|Bedankt|Groet)\s+$/i;
    const beforeWord = context.substring(Math.max(0, context.indexOf(word) - 30), context.indexOf(word));
    if (nameIndicators.test(beforeWord)) {
      return true;
    }

    // Default: require at least 4 characters
    return word.length >= 4;
  }

  /**
   * Extract entities from a specific text with document context
   */
  async extractFromDocument(text, documentId, rteId) {
    const result = await this.extract(text, { documentId, rteId });
    
    // Add document source to entities and relationships
    result.entities = result.entities.map(e => ({
      ...e,
      source_document_id: documentId
    }));
    
    result.relationships = result.relationships.map(r => ({
      ...r,
      source_document_id: documentId
    }));
    
    return result;
  }
}

module.exports = new EntityExtractor();
