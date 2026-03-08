require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const Groq = require('groq-sdk');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const upload = multer({ dest: 'uploads/' });
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database connection
const db = new Database(path.join(__dirname, 'dial112.db'), { readonly: false });
db.pragma('journal_mode = WAL');

// Groq AI setup
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Get database schema for context
function getDbSchema() {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    let schema = '';
    for (const table of tables) {
        const info = db.prepare(`PRAGMA table_info(${table.name})`).all();
        schema += `\nTable: ${table.name}\nColumns:\n`;
        info.forEach(col => {
            schema += `  - ${col.name} (${col.type}${col.notnull ? ', NOT NULL' : ''}${col.pk ? ', PRIMARY KEY' : ''})\n`;
        });

        // Add sample data
        const sample = db.prepare(`SELECT * FROM ${table.name} LIMIT 3`).all();
        if (sample.length > 0) {
            schema += `Sample data: ${JSON.stringify(sample, null, 2)}\n`;
        }
    }
    return schema;
}

// Conversation history store (in-memory for simplicity)
const conversations = new Map();

const SYSTEM_PROMPT = `You are an intelligent database assistant for the Dial 112 Emergency Response System.
You help users query and analyze emergency call data using natural language.

Here is the database schema:
${getDbSchema()}

IMPORTANT RULES:
1. When the user asks a question about the data, generate a valid SQLite query to answer it.
2. Return your response in the following JSON format ONLY (no markdown, no code blocks, just raw JSON):
{
  "sql": "YOUR SQL QUERY HERE",
  "explanation": "Brief explanation of what this query does",
  "visualization": "table" | "bar_chart" | "pie_chart" | "line_chart" | "stat_card" | "map" | "none",
  "chart_config": {
    "title": "Chart or Map title",
    "x_label": "X axis label (for charts)",
    "y_label": "Y axis label (for charts)",
    "label_column": "column name for labels",
    "value_column": "column name for values"
  }
}

3. ONLY use SELECT statements. Never use INSERT, UPDATE, DELETE, DROP, or any data-modifying statements.
4. Choose the best visualization:
   - "stat_card" for single values (counts, averages, etc.)
   - "table" for detailed multi-row, multi-column results
   - "bar_chart" for comparisons across categories
   - "pie_chart" for showing proportions/percentages
   - "line_chart" for time-series data
   - "map" if the user explicitly asks to view data geographically, on a map, or by location.
     * CRITICAL for maps: Your query MUST select the 'latitude' and 'longitude' columns.
     * To cluster nearby incidents (hotspots), use ROUND() on latitude and longitude (e.g. ROUND(latitude, 3) AS latitude, ROUND(longitude, 3) AS longitude), GROUP BY them, and selecting COUNT(*) as total_incidents so the frontend can size the marker.
     * When clustering, also try to provide aggregated context about the hotspot using GROUP_CONCAT(DISTINCT incident_type) AS incident_types, GROUP_CONCAT(DISTINCT severity) AS severities, and MAX(location) AS cluster_location.
     * If NOT clustering, you should just select 'incident_type', 'severity', and 'location' directly to provide detail on the single map markers.
   - "none" for conversational responses
5. If the user is having a general conversation or asks something unrelated to the database, respond with:
{
  "sql": null,
  "explanation": "Your friendly conversational response here",
  "visualization": "none",
  "chart_config": null
}
6. Always limit results to a reasonable number (max 100). For maps, max 500 is allowed.
7. Format dates nicely in queries when possible.
8. Use JOINs when data from multiple tables is needed.
9. For time-based analysis, use strftime() for SQLite date functions.`;

app.post('/api/chat', async (req, res) => {
    try {
        const { message, conversationId } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Get or create conversation history
        if (!conversations.has(conversationId)) {
            conversations.set(conversationId, []);
        }
        const history = conversations.get(conversationId);

        // Build the prompt with conversation context
        let contextPrompt = SYSTEM_PROMPT + '\n\n';

        // Add recent conversation history (last 6 exchanges)
        const recentHistory = history.slice(-6);
        if (recentHistory.length > 0) {
            contextPrompt += 'Recent conversation:\n';
            recentHistory.forEach(h => {
                contextPrompt += `User: ${h.user}\nAssistant: ${h.assistant}\n\n`;
            });
        }

        contextPrompt += `\nUser's new question: ${message}\n\nRespond with valid JSON only:`;

        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: "user",
                    content: contextPrompt
                }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.1,
            response_format: { type: "json_object" },
        });

        const responseText = completion.choices[0]?.message?.content || "";

        // Parse the JSON response
        let parsed;
        try {
            // Try to extract JSON from the response (in case it's wrapped in markdown)
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                parsed = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('No JSON found in response');
            }
        } catch (parseError) {
            console.error('Failed to parse Groq response:', responseText);
            parsed = {
                sql: null,
                explanation: 'I had trouble processing that. Could you rephrase your question?',
                visualization: 'none',
                chart_config: null
            };
        }

        let queryResult = null;
        let error = null;

        if (parsed.sql) {
            try {
                // Safety check: only allow SELECT
                const sanitized = parsed.sql.trim().toUpperCase();
                if (!sanitized.startsWith('SELECT') && !sanitized.startsWith('WITH')) {
                    throw new Error('Only SELECT queries are allowed');
                }

                queryResult = db.prepare(parsed.sql).all();
            } catch (dbError) {
                console.error('SQL Error:', dbError.message);
                error = dbError.message;
                parsed.explanation += `\n\n⚠️ SQL Error: ${dbError.message}`;
                parsed.visualization = 'none';
            }
        }

        // Store in conversation history
        history.push({
            user: message,
            assistant: parsed.explanation
        });

        // Keep history manageable
        if (history.length > 20) {
            history.splice(0, history.length - 20);
        }

        res.json({
            explanation: parsed.explanation,
            sql: parsed.sql,
            data: queryResult,
            visualization: parsed.visualization,
            chart_config: parsed.chart_config,
            error
        });

    } catch (err) {
        console.error('Server error:', err);
        res.status(500).json({
            error: 'Failed to process your request',
            explanation: 'Something went wrong. Please try again.',
            visualization: 'none'
        });
    }
});

// Get database stats for the dashboard
app.get('/api/stats', (req, res) => {
    try {
        const totalCalls = db.prepare('SELECT COUNT(*) as count FROM emergency_calls').get();
        const criticalCalls = db.prepare("SELECT COUNT(*) as count FROM emergency_calls WHERE severity = 'Critical'").get();
        const resolvedCalls = db.prepare("SELECT COUNT(*) as count FROM emergency_calls WHERE status IN ('Resolved', 'Closed')").get();
        const avgResponseTime = db.prepare('SELECT ROUND(AVG(response_time_mins), 1) as avg FROM emergency_calls WHERE response_time_mins IS NOT NULL').get();

        res.json({
            totalCalls: totalCalls.count,
            criticalCalls: criticalCalls.count,
            resolvedCalls: resolvedCalls.count,
            avgResponseTime: avgResponseTime.avg
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Handle Audio Transcription via Groq
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
    let filePath = req.file ? req.file.path : null;

    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No audio file provided' });
        }

        // Groq API requires a valid audio extension (.webm, .mp3, etc.)
        // Multer removes the extension by default, so we rename it
        const newFilePath = filePath + '.webm';
        fs.renameSync(filePath, newFilePath);
        filePath = newFilePath;

        const transcription = await groq.audio.transcriptions.create({
            file: fs.createReadStream(filePath),
            model: "whisper-large-v3",
        });

        // Clean up the temp file
        fs.unlink(filePath, (err) => {
            if (err) console.error("Failed to delete temp audio file:", err);
        });

        res.json({ text: transcription.text });
    } catch (err) {
        console.error('Transcription error:', err);
        if (filePath) {
            fs.unlink(filePath, () => { });
        }
        res.status(500).json({ error: 'Failed to transcribe audio' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Dial 112 Query Assistant running at http://localhost:${PORT}`);
    console.log('📊 Database loaded with emergency call data\n');
});
