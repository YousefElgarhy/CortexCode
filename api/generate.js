const fetch = require('node-fetch');

// Vercel handles environment variables automatically
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:streamGenerateContent?key=${GEMINI_API_KEY}&alt=sse`;

// This is the function Vercel will run
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    if (!GEMINI_API_KEY) {
        return res.status(500).json({ error: 'لم يتم العثور على مفتاح API في الخادم.' });
    }

    try {
        // We now expect "images" (plural) which is an array
        const { history, message, instructions, images } = req.body;

        const systemPrompt = `You are Cortex Code, an elite AI programming assistant. Your responses must be clear, expertly formatted in Markdown, and use code blocks for all snippets. ${instructions || ''}`;
        
        const userMessageParts = [];
        // *** MODIFICATION START ***
        // If there are images, loop through them and add each one
        if (images && images.length > 0) {
            images.forEach(image => {
                userMessageParts.push({ 
                    inline_data: { 
                        mime_type: image.mimeType, 
                        data: image.data 
                    } 
                });
            });
        }
        // *** MODIFICATION END ***

        // Always add the text part last
        userMessageParts.push({ text: message });

        const finalContents = [ ...history, { role: 'user', parts: userMessageParts } ];

        const payload = {
            contents: finalContents,
            system_instruction: { parts: [{ text: systemPrompt }] },
            safetySettings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
            ]
        };

        const response = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
             const errorData = await response.json();
             console.error('Google API Error:', JSON.stringify(errorData, null, 2));
             if (response.status === 429) {
                return res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED', message: 'You have exceeded your current quota.' });
             }
             throw new Error('An error occurred with the Google API.');
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        response.body.pipe(res);

    } catch (error) {
        console.error('Server error:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'SERVER_ERROR', message: error.message });
        }
    }
}
