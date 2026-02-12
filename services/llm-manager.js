/**
 * LLM Manager - Flexible model selection with fallback
 * Supports: Ollama (local models), OpenAI-compatible APIs
 */

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../config/llm-config.json');

class LLMManager {
  constructor() {
    this.config = null;
    this.availableModels = [];
    this.loadConfig();
  }

  /**
   * Load LLM configuration
   */
  loadConfig() {
    try {
      const configData = fs.readFileSync(CONFIG_PATH, 'utf-8');
      this.config = JSON.parse(configData);
      this.availableModels = this.config.models
        .filter(m => m.active)
        .sort((a, b) => a.priority - b.priority);
      
      console.log(`[LLM] Loaded ${this.availableModels.length} active models`);
    } catch (error) {
      console.error('[LLM] Config load failed:', error.message);
      this.config = { models: [], fallbackStrategy: 'sequential' };
    }
  }

  /**
   * Get best model for task
   */
  getModel(capability = 'generation', language = 'en') {
    const suitable = this.availableModels.filter(m => 
      m.capabilities.includes(capability) &&
      (m.languages.includes(language) || m.languages.includes('all'))
    );

    if (suitable.length === 0) {
      // Fallback to first available
      return this.availableModels[0] || null;
    }

    return suitable[0];
  }

  /**
   * Call LLM with automatic fallback
   */
  async generate(prompt, options = {}) {
    const {
      capability = 'generation',
      language = 'en',
      model = null,
      temperature = null,
      maxTokens = null
    } = options;

    // Use specific model or get best match
    const targetModel = model ? 
      this.availableModels.find(m => m.name === model) :
      this.getModel(capability, language);

    if (!targetModel) {
      throw new Error('No suitable LLM available');
    }

    // Try models in priority order
    const modelsToTry = this.config.fallbackStrategy === 'sequential' ?
      this.availableModels :
      [targetModel];

    let lastError = null;

    for (const modelConfig of modelsToTry) {
      try {
        console.log(`[LLM] Trying ${modelConfig.name}...`);
        
        if (modelConfig.type === 'ollama') {
          return await this.callOllama(modelConfig, prompt, {
            temperature: temperature || modelConfig.temperature,
            maxTokens: maxTokens || modelConfig.maxTokens
          });
        } else if (modelConfig.type === 'api') {
          return await this.callAPI(modelConfig, prompt, {
            temperature: temperature || modelConfig.temperature,
            maxTokens: maxTokens || modelConfig.maxTokens
          });
        }
      } catch (error) {
        console.error(`[LLM] ${modelConfig.name} failed:`, error.message);
        lastError = error;
        continue;
      }
    }

    throw new Error(`All LLMs failed. Last error: ${lastError?.message}`);
  }

  /**
   * Call Ollama model
   */
  async callOllama(modelConfig, prompt, options) {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelConfig.model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: options.temperature,
          num_predict: options.maxTokens
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama ${modelConfig.name} failed: ${response.status}`);
    }

    const data = await response.json();
    return {
      text: data.response,
      model: modelConfig.name,
      tokens: data.eval_count || 0
    };
  }

  /**
   * Call external OpenAI-compatible API
   */
  async callAPI(modelConfig, prompt, options) {
    const endpoint = modelConfig.endpoint;
    const tokenEnvVar = modelConfig.tokenEnvVar || 'LLM_API_TOKEN';
    const token = process.env[tokenEnvVar];

    if (!endpoint) {
      throw new Error(`No endpoint configured for API model: ${modelConfig.name}`);
    }

    if (!token) {
      throw new Error(`API token not configured (set ${tokenEnvVar} in .env)`);
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: modelConfig.model,
        messages: [{
          role: 'user',
          content: prompt
        }],
        temperature: options.temperature,
        max_tokens: options.maxTokens
      })
    });

    if (!response.ok) {
      throw new Error(`API ${modelConfig.name} failed: ${response.status}`);
    }

    const data = await response.json();
    return {
      text: data.choices[0].message.content,
      model: modelConfig.name,
      tokens: data.usage?.total_tokens || 0
    };
  }

  /**
   * Check which models are available
   */
  async checkAvailability() {
    const results = [];

    for (const model of this.config.models) {
      let available = false;

      try {
        if (model.type === 'ollama') {
          const response = await fetch('http://localhost:11434/api/tags');
          if (response.ok) {
            const data = await response.json();
            available = data.models?.some(m => m.name === model.model);
          }
        } else if (model.type === 'api') {
          const tokenEnvVar = model.tokenEnvVar || 'LLM_API_TOKEN';
          available = !!process.env[tokenEnvVar];
        }
      } catch (error) {
        available = false;
      }

      results.push({
        name: model.name,
        type: model.type,
        available,
        priority: model.priority,
        capabilities: model.capabilities
      });
    }

    return results;
  }

  /**
   * List all configured models
   */
  listModels() {
    return this.availableModels.map(m => ({
      name: m.name,
      type: m.type,
      capabilities: m.capabilities,
      languages: m.languages,
      priority: m.priority
    }));
  }
}

// Singleton instance
let instance = null;

module.exports = {
  getInstance: () => {
    if (!instance) {
      instance = new LLMManager();
    }
    return instance;
  },
  LLMManager
};
