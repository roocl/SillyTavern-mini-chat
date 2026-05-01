import {
    bindEventHandlers,
    buildEventList,
    formatLatestAssistantMessage,
    sendDraftToSillyTavern,
} from './core.js';

const EXTENSION_NAME = 'pip-mini-chat';
const BUTTON_ID = 'pip-mini-chat-open';
const PIP_WIDTH = 380;
const PIP_HEIGHT = 360;

let pipWindow = null;
let pipElements = null;
let sendTextareaMessage = null;
let isGenerating = false;
let cleanupPipEventListeners = null;

function getContext() {
    return globalThis.SillyTavern?.getContext?.();
}

function getEventTypes(context) {
    return context?.eventTypes ?? context?.event_types ?? {};
}

function notifyError(message, error = null) {
    console.error(`[${EXTENSION_NAME}] ${message}`, error ?? '');
    if (globalThis.toastr?.error) {
        globalThis.toastr.error(message, 'PiP Mini Chat');
    }
    setStatus(message, 'error');
}

function setStatus(text, type = 'idle') {
    if (!pipElements?.status) {
        return;
    }

    pipElements.status.textContent = text;
    pipElements.status.dataset.state = type;
}

function getTitle(context) {
    if (!context) {
        return 'SillyTavern';
    }

    if (context.groupId) {
        const group = context.groups?.find(item => item.id === context.groupId);
        return group?.name ?? 'Group Chat';
    }

    const character = context.characters?.[context.characterId];
    return character?.name ?? 'SillyTavern';
}

function refreshPip() {
    if (!pipElements || pipWindow?.closed) {
        return;
    }

    const context = getContext();
    pipElements.title.textContent = getTitle(context);
    pipElements.output.innerHTML = formatLatestAssistantMessage({
        chat: context?.chat,
        formatter: context?.messageFormatting,
    });
    updateControls();
}

function updateControls() {
    if (!pipElements) {
        return;
    }

    const hasText = pipElements.input.value.trim().length > 0;
    pipElements.send.disabled = isGenerating || !hasText;
    pipElements.stop.disabled = !isGenerating;

    if (isGenerating) {
        setStatus('生成中', 'generating');
    } else if (pipElements.status.dataset.state !== 'error') {
        setStatus('空闲', 'idle');
    }
}

async function loadSendTextareaMessage() {
    if (sendTextareaMessage) {
        return sendTextareaMessage;
    }

    const module = await import('/script.js');
    sendTextareaMessage = module.sendTextareaMessage;
    return sendTextareaMessage;
}

async function sendDraft() {
    if (!pipElements) {
        return;
    }

    try {
        const sendMessage = await loadSendTextareaMessage();
        const textarea = document.querySelector('#send_textarea');
        await sendDraftToSillyTavern({
            text: pipElements.input.value,
            textarea,
            inputEventFactory: () => new Event('input', { bubbles: true }),
            sendTextareaMessage: sendMessage,
        });
        pipElements.input.value = '';
        setStatus('已发送', 'idle');
        updateControls();
    } catch (error) {
        notifyError(error?.message ?? '发送失败', error);
    }
}

function stopGeneration() {
    try {
        const context = getContext();
        context?.stopGeneration?.();
    } catch (error) {
        notifyError(error?.message ?? '停止生成失败', error);
    }
}

function getPipStyles() {
    return `
        :root {
            color-scheme: dark;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background: #171717;
            color: #f4f4f5;
        }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            min-height: 100vh;
            background: #171717;
        }
        .pip-mini-chat {
            display: grid;
            grid-template-rows: auto 1fr auto auto;
            height: 100vh;
            min-height: 260px;
        }
        .pip-mini-chat__header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 10px 12px;
            border-bottom: 1px solid #303036;
            background: #202024;
        }
        .pip-mini-chat__title {
            overflow: hidden;
            font-size: 14px;
            font-weight: 700;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .pip-mini-chat__status {
            flex: 0 0 auto;
            font-size: 12px;
            color: #a1a1aa;
        }
        .pip-mini-chat__status[data-state="generating"] {
            color: #67e8f9;
        }
        .pip-mini-chat__status[data-state="error"] {
            color: #fca5a5;
        }
        .pip-mini-chat__output {
            overflow: auto;
            padding: 12px;
            font-size: 14px;
            line-height: 1.55;
            overflow-wrap: anywhere;
        }
        .pip-mini-chat-empty {
            color: #a1a1aa;
        }
        .pip-mini-chat__input {
            display: block;
            width: calc(100% - 24px);
            min-height: 72px;
            max-height: 140px;
            margin: 0 12px 10px;
            resize: vertical;
            border: 1px solid #3f3f46;
            border-radius: 8px;
            padding: 9px 10px;
            background: #242429;
            color: #fafafa;
            font: inherit;
            line-height: 1.45;
        }
        .pip-mini-chat__input:focus {
            border-color: #22d3ee;
            outline: none;
        }
        .pip-mini-chat__actions {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            padding: 0 12px 12px;
        }
        .pip-mini-chat__button {
            min-height: 36px;
            border: 1px solid #3f3f46;
            border-radius: 8px;
            background: #27272a;
            color: #fafafa;
            font: inherit;
            font-weight: 700;
            cursor: pointer;
        }
        .pip-mini-chat__button:hover:not(:disabled) {
            background: #33333a;
        }
        .pip-mini-chat__button:disabled {
            cursor: not-allowed;
            opacity: 0.5;
        }
        .pip-mini-chat__button--send {
            border-color: #0891b2;
            background: #0e7490;
        }
        .pip-mini-chat__button--stop {
            border-color: #991b1b;
            background: #7f1d1d;
        }
    `;
}

function buildPipDocument(targetWindow) {
    const doc = targetWindow.document;
    doc.title = 'PiP Mini Chat';
    doc.body.innerHTML = `
        <main class="pip-mini-chat">
            <header class="pip-mini-chat__header">
                <div class="pip-mini-chat__title"></div>
                <div class="pip-mini-chat__status" data-state="idle">空闲</div>
            </header>
            <section class="pip-mini-chat__output" aria-live="polite"></section>
            <textarea class="pip-mini-chat__input" rows="3" placeholder="输入消息，Enter 发送，Shift+Enter 换行"></textarea>
            <div class="pip-mini-chat__actions">
                <button class="pip-mini-chat__button pip-mini-chat__button--send" type="button">发送</button>
                <button class="pip-mini-chat__button pip-mini-chat__button--stop" type="button">停止</button>
            </div>
        </main>
    `;

    const style = doc.createElement('style');
    style.textContent = getPipStyles();
    doc.head.append(style);

    pipElements = {
        title: doc.querySelector('.pip-mini-chat__title'),
        status: doc.querySelector('.pip-mini-chat__status'),
        output: doc.querySelector('.pip-mini-chat__output'),
        input: doc.querySelector('.pip-mini-chat__input'),
        send: doc.querySelector('.pip-mini-chat__button--send'),
        stop: doc.querySelector('.pip-mini-chat__button--stop'),
    };

    pipElements.input.addEventListener('input', updateControls);
    pipElements.input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            void sendDraft();
        }
    });
    pipElements.send.addEventListener('click', () => void sendDraft());
    pipElements.stop.addEventListener('click', stopGeneration);
}

function cleanupPip() {
    cleanupPipEventListeners?.();
    cleanupPipEventListeners = null;
    pipWindow = null;
    pipElements = null;
    isGenerating = false;
}

async function openPipWindow() {
    if (!window.documentPictureInPicture?.requestWindow) {
        notifyError('当前浏览器不支持 Document Picture-in-Picture。请使用 Chrome 或 Edge。');
        return;
    }

    if (pipWindow && !pipWindow.closed) {
        pipWindow.focus();
        return;
    }

    try {
        pipWindow = await window.documentPictureInPicture.requestWindow({
            width: PIP_WIDTH,
            height: PIP_HEIGHT,
        });
        buildPipDocument(pipWindow);
        registerPipEventListeners();
        pipWindow.addEventListener('pagehide', cleanupPip, { once: true });
        refreshPip();
        pipElements.input.focus();
    } catch (error) {
        cleanupPip();
        notifyError(error?.message ?? '无法打开 PiP 小窗', error);
    }
}

function registerLauncher() {
    if (document.getElementById(BUTTON_ID)) {
        return;
    }

    const button = document.createElement('div');
    button.id = BUTTON_ID;
    button.className = 'list-group-item flex-container flexGap5 interactable';
    button.tabIndex = 0;
    button.role = 'button';
    button.innerHTML = '<span class="pip-mini-chat-icon">▣</span><span>打开 PiP 小窗</span>';
    button.addEventListener('click', () => void openPipWindow());
    button.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            void openPipWindow();
        }
    });

    const menu = document.querySelector('#extensionsMenu');
    if (menu) {
        menu.append(button);
    } else {
        document.body.append(button);
    }
}

function handleEvent(eventName) {
    if (eventName === 'generation_started') {
        isGenerating = true;
    }

    if (eventName === 'generation_stopped' || eventName === 'generation_ended') {
        isGenerating = false;
    }

    refreshPip();
}

function registerPipEventListeners() {
    cleanupPipEventListeners?.();

    const context = getContext();
    const eventSource = context?.eventSource;
    if (!eventSource?.on) {
        return;
    }

    cleanupPipEventListeners = bindEventHandlers({
        eventSource,
        eventNames: buildEventList({ eventTypes: getEventTypes(context) }),
        onEvent: handleEvent,
    });
}

function init() {
    registerLauncher();
}

const context = getContext();
const eventTypes = getEventTypes(context);
if (context?.eventSource?.on) {
    context.eventSource.on(eventTypes.APP_READY ?? 'app_ready', init);
} else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
    init();
}
