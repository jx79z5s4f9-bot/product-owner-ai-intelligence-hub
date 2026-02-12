# Contributing to PO AI

Thank you for your interest in contributing to PO AI! This document provides guidelines for contributing.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/product-owner-ai-intelligence-hub.git
   cd product-owner-ai-intelligence-hub
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Start the development server**:
   ```bash
   npm start
   ```

## Development Setup

### Prerequisites
- Node.js >= 18
- Ollama (optional, for LLM features)
- On Windows: Visual Studio Build Tools with "Desktop development with C++"

### Project Structure
```
├── local-app.js          # Express server entry point
├── db/
│   ├── connection.js     # SQLite connection + migrations
│   └── migrations/       # Database schema migrations
├── routes/               # API route handlers
├── services/             # Business logic (LLM, search, extraction)
├── views/                # EJS templates
├── public/               # Static assets (CSS, JS)
└── scripts/              # Utility scripts
```

## Making Changes

### Code Style
- Use 2-space indentation
- Use single quotes for strings
- Add JSDoc comments to functions
- Keep functions small and focused

### Database Changes
If your change requires a database schema modification:

1. Create a new migration file in `db/migrations/`:
   ```
   v{N}_{description}.js
   ```
2. Follow the existing migration pattern:
   ```javascript
   module.exports = {
     isApplied: (db) => { /* check if applied */ },
     migrate: (db) => { /* apply changes */ }
   };
   ```
3. Register the migration in `db/connection.js`

### Adding a New Route
1. Create a new file in `routes/` (e.g., `routes/my-feature.js`)
2. Export an Express router
3. Mount it in `local-app.js`:
   ```javascript
   const myFeatureRoutes = require('./routes/my-feature');
   app.use('/api/my-feature', myFeatureRoutes);
   ```

### Adding a New Page
1. Create an EJS template in `views/`
2. Add a route in `local-app.js`:
   ```javascript
   app.get('/my-page', (req, res) => res.render('my-page'));
   ```
3. Add CSS in `public/css/` if needed
4. Add the page to the home tile grid if it's a major feature

## Submitting Changes

### Pull Request Process

1. **Create a feature branch**:
   ```bash
   git checkout -b feature/my-new-feature
   ```

2. **Make your changes** and commit with clear messages:
   ```bash
   git commit -m "Add: new feature description"
   ```

   Commit message prefixes:
   - `Add:` for new features
   - `Fix:` for bug fixes
   - `Update:` for changes to existing features
   - `Docs:` for documentation only
   - `Refactor:` for code restructuring

3. **Push to your fork**:
   ```bash
   git push origin feature/my-new-feature
   ```

4. **Open a Pull Request** with:
   - Clear description of the change
   - Screenshots if it's a UI change
   - Any migration notes if database changes are involved

### What We Look For
- Code follows existing patterns
- No breaking changes to existing features
- Database migrations are reversible or clearly documented
- UI changes match the existing dark theme design system

## Reporting Issues

### Bug Reports
Please include:
- Steps to reproduce
- Expected vs actual behavior
- OS and Node.js version
- Ollama model being used (if relevant)
- Any error messages from the console

### Feature Requests
Please include:
- Clear description of the problem it solves
- Example use case
- Any existing workarounds you're using

## Security

If you discover a security vulnerability, please **do not** open a public issue. Instead, email the maintainers directly or use GitHub's private vulnerability reporting.

## Questions?

Open a [Discussion](https://github.com/jx79z5s4f9-bot/product-owner-ai-intelligence-hub/discussions) on GitHub for questions not covered here.

---

Thank you for contributing!
