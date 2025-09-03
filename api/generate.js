// استيراد الحزمة المطلوبة
const fetch = require('node-fetch');

// Vercel يقرأ متغيرات البيئة من إعدادات الموقع مباشرة
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:streamGenerateContent?key=${GEMINI_API_KEY}&alt=sse`;

// هذه هي الدالة التي سيقوم Vercel بتشغيلها تلقائياً
// عندما يتم استدعاء الرابط /api/generate
export default async function handler(req, res) {
    // نتأكد أن الطلب من نوع POST فقط
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // نتأكد أن مفتاح API موجود
    if (!GEMINI_API_KEY) {
        return res.status(500).json({ error: 'لم يتم العثور على مفتاح API في الخادم.' });
    }

    try {
        // !! تعديل: استقبال مصفوفة الصور "images" بدلاً من "image"
        const { history, message, instructions, images } = req.body;

        const systemPrompt = `You are Cortex Code, an elite AI programming assistant. Your responses must be clear, expertly formatted in Markdown, and use code blocks for all snippets. ${instructions || ''}`;
        
        const userMessageParts = [];
        
        // !! تعديل: معالجة مصفوفة الصور
        if (images && images.length > 0) {
            images.forEach(image => {
                userMessageParts.push({ 
                    inline_data: { mime_type: image.mimeType, data: image.data } 
                });
            });
        }
        
        // إضافة النص دائماً في النهاية
        userMessageParts.push({ text: message || '' });

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

        // إرسال الطلب إلى Gemini API
        const response = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // التعامل مع الأخطاء من Gemini
        if (!response.ok) {
             const errorData = await response.json();
             console.error('Google API Error:', JSON.stringify(errorData, null, 2));
             const errorMessage = errorData?.error?.message || 'An error occurred with the Google API.';
             return res.status(response.status).json({ error: 'API_ERROR', message: errorMessage });
        }

        // إعداد الرؤوس لإرسال رد متدفق (streaming response)
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        // تمرير الرد القادم من Gemini مباشرة إلى واجهة الموقع
        response.body.pipe(res);

    } catch (error) {
        console.error('Server error:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'SERVER_ERROR', message: error.message });
        }
    }
}
