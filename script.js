document.addEventListener("DOMContentLoaded", () => {
    // DOM Elements
    const chatBox = document.getElementById("chat-box");
    const userInput = document.getElementById("user-input");
    const sendBtn = document.getElementById("send-btn");
    const stopBtn = document.getElementById("stop-btn");
    const newChatBtn = document.getElementById("new-chat-btn");
    const welcomeScreen = document.getElementById("welcome-screen");
    const chatHistoryList = document.getElementById("chat-history-list");
    const themeToggleBtn = document.getElementById("theme-toggle-btn");
    const imageUploadBtn = document.getElementById("image-upload-btn");
    const imageUploadInput = document.getElementById("image-upload-input");
    const imagePreviewContainer = document.getElementById("image-preview-container");
    const imagePreview = document.getElementById("image-preview");
    const removeImageBtn = document.getElementById("remove-image-btn");
    const settingsModal = document.getElementById("settings-modal");
    const confirmModal = document.getElementById("custom-confirm-modal");
    const promptModal = document.getElementById("custom-prompt-modal");

    // API & State
    const API_URL = '/api/generate';
    let allConversations = [];
    let activeConversationId = null;
    let abortController = null;
    let uploadedImage = null;

    // --- Modal Functions (Promise-based) ---
    const showModal = (modal, title, text, inputDefault = '') => {
        modal.classList.remove("hidden");
        modal.querySelector('h2').textContent = title;
        if (modal.querySelector('p')) modal.querySelector('p').textContent = text;
        
        return new Promise(resolve => {
            const okBtn = modal.querySelector('.modal-action-btn:not(.secondary)');
            const cancelBtn = modal.querySelector('.secondary');
            const input = modal.querySelector('input');
            if (input) { input.value = inputDefault; input.focus(); }
            
            const handleOk = () => { cleanup(); resolve(input ? input.value : true); };
            const handleCancel = () => { cleanup(); resolve(input ? null : false); };
            const handleKeydown = (e) => { if (e.key === 'Enter') handleOk(); };

            const cleanup = () => {
                okBtn.removeEventListener('click', handleOk);
                cancelBtn.removeEventListener('click', handleCancel);
                if (input) input.removeEventListener('keydown', handleKeydown);
                modal.classList.add("hidden");
            };

            okBtn.addEventListener('click', handleOk);
            cancelBtn.addEventListener('click', handleCancel);
            if (input) input.addEventListener('keydown', handleKeydown);
        });
    };
    const showConfirm = (title, text) => showModal(confirmModal, title, text);
    const showPrompt = (title, text, def) => showModal(promptModal, title, text, def);
    
    // --- Theme Functions ---
    const applyTheme = (theme) => {
        document.body.classList.toggle('light-mode', theme === 'light');
        themeToggleBtn.querySelector('i').className = theme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
    };
    const toggleTheme = () => {
        const newTheme = document.body.classList.contains('light-mode') ? 'dark' : 'light';
        applyTheme(newTheme); localStorage.setItem('cortex_theme', newTheme);
    };
    const loadTheme = () => applyTheme(localStorage.getItem('cortex_theme') || 'dark');

    // --- Core Data Functions ---
    const loadConversations = () => {
        allConversations = JSON.parse(localStorage.getItem('cortex_code_chats') || '[]');
        renderChatHistory();
        settingsModal.querySelector('textarea').value = localStorage.getItem('cortex_code_instructions') || '';
    };
    const saveConversations = () => localStorage.setItem('cortex_code_chats', JSON.stringify(allConversations));

    // --- UI Rendering ---
    const renderChatHistory = () => {
        chatHistoryList.innerHTML = '';
        allConversations.forEach(convo => {
            const wrapper = document.createElement('div'); wrapper.className = `history-item-wrapper ${convo.id === activeConversationId ? 'active' : ''}`;
            const item = document.createElement('button'); item.className = 'history-item'; item.textContent = convo.title;
            item.onclick = () => { loadConversation(convo.id); document.getElementById('sidebar').classList.remove('open'); };
            const actions = document.createElement('div'); actions.className = 'history-item-actions';
            const editBtn = createActionButton('pen-to-square', 'تعديل العنوان', () => editConversationTitle(convo.id));
            const deleteBtn = createActionButton('trash-can', 'حذف المحادثة', () => deleteConversation(convo.id));
            actions.appendChild(editBtn); actions.appendChild(deleteBtn);
            wrapper.appendChild(item); wrapper.appendChild(actions);
            chatHistoryList.appendChild(wrapper);
        });
    };

    const loadConversation = (id) => {
        const conversation = allConversations.find(c => c.id === id);
        if (!conversation) return;
        activeConversationId = id; chatBox.innerHTML = '';
        conversation.messages.forEach((msg, index) => appendMessage(msg, false, index));
        welcomeScreen.classList.add("hidden"); chatBox.classList.remove("hidden");
        renderChatHistory();
    };

    // --- Message Sending Logic ---
    const sendMessage = async (messageObject, isRegenerating = false) => {
        const messageText = messageObject.text || '';
        const imageInfo = messageObject.imageInfo || (isRegenerating ? messageObject.imageInfo : uploadedImage);

        if (messageText.trim() === "" && !imageInfo) return;

        let currentConversation = allConversations.find(c => c.id === activeConversationId);
        if (!currentConversation) {
            activeConversationId = Date.now().toString();
            const title = messageText.substring(0, 30) || 'تحليل الصورة';
            currentConversation = { id: activeConversationId, title: title, messages: [] };
            allConversations.unshift(currentConversation); renderChatHistory();
        }

        if (!isRegenerating) {
            const userMessage = { sender: 'U', text: messageText };
            if (imageInfo) { userMessage.image = imageInfo.dataURL; userMessage.imageInfo = imageInfo; }
            appendMessage(userMessage, true, currentConversation.messages.length);
            currentConversation.messages.push(userMessage);
            userInput.value = ""; userInput.style.height = 'auto';
            resetImageUpload();
        }
        
        welcomeScreen.classList.add("hidden"); chatBox.classList.remove("hidden");
        userInput.disabled = true; sendBtn.classList.add('hidden'); stopBtn.classList.remove('hidden');
        abortController = new AbortController();

        const thinkingIndicator = showThinkingIndicator();
        let firstChunkReceived = false;

        try {
            const apiHistory = currentConversation.messages.slice(0, -1).map(msg => ({
                role: msg.sender === 'U' ? 'user' : 'model', parts: [{ text: msg.text }] 
            }));
            const customInstructions = localStorage.getItem('cortex_code_instructions') || '';

            const response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ history: apiHistory, message: messageText, instructions: customInstructions, image: imageInfo }),
                signal: abortController.signal
            });

            if (!response.ok) {
                const errorData = await response.json();
                if (errorData.error === 'RATE_LIMIT_EXCEEDED') {
                    appendMessage({ sender: 'AI', text: '**لقد وصلت إلى حد الاستخدام المجاني.**\n\nيرجى المحاولة مرة أخرى لاحقًا.' }, true);
                } else {
                    appendMessage({ sender: 'AI', text: 'عذرًا، حدث خطأ غير متوقع من الخادم.' }, true);
                }
                throw new Error(errorData.message || 'Server error');
            }

            let botMessageContainer;
            const contentDivs = new Map();
            const reader = response.body.getReader(); const decoder = new TextDecoder();
            let fullResponse = "";

            while (true) {
                const { value, done } = await reader.read(); if (done) break;
                decoder.decode(value).split('\n').forEach(line => {
                    if (line.startsWith('data: ')) {
                        try {
                            const chunkText = JSON.parse(line.substring(6)).candidates?.[0]?.content?.parts?.[0]?.text;
                            if (chunkText) {
                                if (!firstChunkReceived) {
                                    thinkingIndicator.remove();
                                    const botMessageIndex = currentConversation.messages.length;
                                    botMessageContainer = appendMessage({ sender: 'AI', text: '' }, true, botMessageIndex);
                                    contentDivs.set('main', botMessageContainer.querySelector('.message-content'));
                                    const cursor = document.createElement('span'); cursor.className = 'blinking-cursor';
                                    contentDivs.get('main').appendChild(cursor);
                                    contentDivs.set('cursor', cursor);
                                    firstChunkReceived = true;
                                }
                                fullResponse += chunkText;
                                contentDivs.get('main').insertBefore(document.createTextNode(chunkText), contentDivs.get('cursor'));
                            }
                        } catch (e) { /* Ignore */ }
                    }
                });
                chatBox.scrollTop = chatBox.scrollHeight;
            }
            
            if (firstChunkReceived) {
                contentDivs.get('cursor').remove();
                contentDivs.get('main').innerHTML = marked.parse(fullResponse);
                renderCodeBlocks(contentDivs.get('main'));
                currentConversation.messages.push({ sender: 'AI', text: fullResponse });
                saveConversations();
            } else {
                thinkingIndicator.remove();
                appendMessage({ sender: 'AI', text: 'عذرًا، لم يتم استلام رد.' }, true);
            }

        } catch (error) {
            thinkingIndicator.remove();
            if (error.name !== 'AbortError') {
                console.error("Error:", error.message);
            }
        } finally {
            userInput.disabled = false; stopBtn.classList.add('hidden');
            sendBtn.classList.remove('hidden'); abortController = null;
            userInput.focus();
        }
    };
    
    // --- UI and Actions Functions ---
    function appendMessage(message, animate = true, messageIndex) {
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${message.sender === 'U' ? 'user' : 'bot'}-message-wrapper`;
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${message.sender === 'U' ? 'user' : 'bot'}-message`;
        if (!animate) messageDiv.style.animation = 'none';
        
        const avatar = document.createElement('div'); avatar.className = 'message-avatar';
        avatar.innerHTML = `<i class="fas ${message.sender === 'U' ? 'fa-user' : 'fa-robot'}"></i>`;
        const contentDiv = document.createElement('div'); contentDiv.className = 'message-content';
        
        if (message.image) {
            const img = document.createElement('img');
            img.src = message.image;
            img.style.cssText = 'max-width: 200px; border-radius: 8px; margin-bottom: 10px; display: block;';
            contentDiv.appendChild(img);
        }
        contentDiv.innerHTML += marked.parse(message.text || '');

        messageDiv.appendChild(avatar); messageDiv.appendChild(contentDiv);
        wrapper.appendChild(messageDiv); chatBox.appendChild(wrapper);
        renderCodeBlocks(contentDiv);
        
        if (messageIndex !== undefined) {
            if (message.sender === 'AI') addBotMessageActions(wrapper, messageIndex);
            else if (message.sender === 'U') addUserMessageActions(wrapper, messageIndex);
        }

        chatBox.scrollTop = chatBox.scrollHeight;
        return wrapper;
    }
    
    function showThinkingIndicator() {
        const wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper bot-message-wrapper';
        wrapper.innerHTML = `
            <div class="message bot-message">
                <div class="message-avatar"><i class="fas fa-robot"></i></div>
                <div class="message-content">
                    <div class="typing-indicator">
                        <span></span><span></span><span></span>
                    </div>
                </div>
            </div>`;
        chatBox.appendChild(wrapper);
        chatBox.scrollTop = chatBox.scrollHeight;
        return wrapper;
    }

    function createActionButton(icon, title, onClick) {
        const btn = document.createElement('button');
        btn.innerHTML = `<i class="fas fa-${icon}"></i>`; btn.title = title;
        btn.onclick = (e) => { e.stopPropagation(); onClick(); };
        return btn;
    }

    function addBotMessageActions(wrapper, botMessageIndex) {
        const actionsDiv = document.createElement('div'); actionsDiv.className = 'response-actions';
        const regenBtn = createActionButton('sync-alt', 'إعادة توليد الإجابة', async () => {
            if (await showConfirm("إعادة توليد الإجابة", "سيتم حذف هذه الإجابة وكل الرسائل التالية. هل تريد المتابعة؟")) {
                const convo = allConversations.find(c => c.id === activeConversationId);
                const userMessage = convo.messages[botMessageIndex - 1];
                // ***!!! السطر التالي هو الذي تم تعديله !!!***
                // يمسح رسالة الذكاء الاصطناعي فقط بدلاً من رسالة المستخدم معها
                convo.messages = convo.messages.slice(0, botMessageIndex);
                saveConversations(); 
                loadConversation(activeConversationId);
                sendMessage(userMessage, true);
            }
        });
        actionsDiv.appendChild(regenBtn);
        wrapper.appendChild(actionsDiv);
    }

    function addUserMessageActions(wrapper, userMessageIndex) {
        const actionsDiv = document.createElement('div'); actionsDiv.className = 'response-actions';
        const editBtn = createActionButton('pencil-alt', 'تعديل', async () => {
            const convo = allConversations.find(c => c.id === activeConversationId);
            const originalMessage = convo.messages[userMessageIndex];
            const newText = await showPrompt("تعديل الرسالة", "أدخل النص الجديد:", originalMessage.text);
            if (newText && newText.trim() !== '' && newText !== originalMessage.text) {
                convo.messages.splice(userMessageIndex);
                originalMessage.text = newText;
                saveConversations();
                loadConversation(activeConversationId);
                sendMessage(originalMessage, false);
            }
        });
        const deleteBtn = createActionButton('trash-can', 'حذف', async () => {
            if (await showConfirm("حذف الرسالة", "هل أنت متأكد من حذف هذه الرسالة ورد الذكاء الاصطناعي عليها؟")) {
                const convo = allConversations.find(c => c.id === activeConversationId);
                const nextMsgIsBot = convo.messages[userMessageIndex + 1]?.sender === 'AI';
                convo.messages.splice(userMessageIndex, nextMsgIsBot ? 2 : 1);
                saveConversations();
                loadConversation(activeConversationId);
            }
        });
        actionsDiv.appendChild(editBtn); actionsDiv.appendChild(deleteBtn);
        wrapper.appendChild(actionsDiv);
    }
    
    function renderCodeBlocks(element) {
        element.querySelectorAll('pre code').forEach(codeBlock => {
            hljs.highlightElement(codeBlock);
            const pre = codeBlock.parentElement;
            if (pre.querySelector('.code-header')) return;
            const header = document.createElement('div'); header.className = 'code-header';
            const lang = codeBlock.className.replace('hljs', '').replace('language-', '').trim() || 'code';
            header.innerHTML = `<span>${lang}</span><button class="copy-btn"><i class="far fa-copy"></i><span>نسخ</span></button>`;
            header.querySelector('.copy-btn').onclick = (e) => {
                const btn = e.currentTarget;
                navigator.clipboard.writeText(codeBlock.textContent);
                btn.innerHTML = '<i class="fas fa-check"></i><span>تم النسخ!</span>';
                setTimeout(() => { btn.innerHTML = '<i class="far fa-copy"></i><span>نسخ</span>'; }, 2000);
            };
            pre.prepend(header);
        });
    }

    // --- Event Handlers & Initial Load ---
    const handleImageUpload = (event) => {
        const file = event.target.files[0]; if (!file || !file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onloadend = () => {
            uploadedImage = { mimeType: file.type, data: reader.result.split(',')[1], dataURL: reader.result };
            imagePreview.src = reader.result;
            imagePreviewContainer.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    };
    const resetImageUpload = () => { uploadedImage = null; imageUploadInput.value = ''; imagePreviewContainer.classList.add('hidden'); };
    const startNewChat = () => { activeConversationId = null; chatBox.innerHTML = ''; welcomeScreen.classList.remove("hidden"); chatBox.classList.add("hidden"); renderChatHistory(); resetImageUpload(); };
    const editConversationTitle = async (id) => {
        const convo = allConversations.find(c => c.id === id);
        const newTitle = await showPrompt("تعديل العنوان", "أدخل العنوان الجديد:", convo.title);
        if (newTitle && newTitle.trim()) {
            convo.title = newTitle.trim();
            saveConversations(); renderChatHistory();
        }
    };
    const deleteConversation = async (id) => {
        if (await showConfirm("حذف المحادثة", "هل أنت متأكد؟ سيتم حذف هذه المحادثة بالكامل.")) {
            allConversations = allConversations.filter(c => c.id !== id);
            saveConversations();
            if (activeConversationId === id) startNewChat();
            else renderChatHistory();
        }
    };

    sendBtn.addEventListener('click', () => sendMessage({ text: userInput.value }));
    userInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage({ text: userInput.value }); } });
    stopBtn.addEventListener('click', () => { if (abortController) abortController.abort(); });
    newChatBtn.addEventListener('click', startNewChat);
    themeToggleBtn.addEventListener('click', toggleTheme);
    imageUploadBtn.addEventListener('click', () => imageUploadInput.click());
    imageUploadInput.addEventListener('change', handleImageUpload);
    removeImageBtn.addEventListener('click', resetImageUpload);
    document.getElementById('settings-btn').addEventListener('click', () => showModal(settingsModal, "تعليمات مخصصة", "..."));
    settingsModal.querySelector('.modal-close-btn').onclick = () => settingsModal.classList.add("hidden");
    settingsModal.querySelector('#save-instructions-btn').onclick = () => {
        localStorage.setItem('cortex_code_instructions', settingsModal.querySelector('textarea').value);
        settingsModal.classList.add("hidden");
    };
    document.getElementById('sidebar-toggle-btn').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
    document.getElementById('overlay').addEventListener('click', () => document.getElementById('sidebar').classList.remove('open'));

    loadTheme();
    loadConversations();
});
