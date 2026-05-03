import {
    bindEventHandlers,
    buildThemeVariableCss,
    buildEventList,
    collectThemeVariables,
    formatLatestAssistantMessage,
    getLauncherTargets,
    getTextareaRowCount,
    normalizeFloatingPosition,
    readBooleanSetting,
    readGenerationState,
    sendDraftToSillyTavern,
    shouldClosePipWindow,
    triggerRegenerate,
    writeBooleanSetting,
} from './core.js';

const EXTENSION_NAME = 'pip-mini-chat';
const PIP_WIDTH = 380;
const PIP_HEIGHT = 360;
const LAUNCHER_RETRY_LIMIT = 20;
const FLOATING_POSITION_KEY = 'pip-mini-chat-floating-position';
const COMPATIBLE_SEND_MODE_KEY = 'pip-mini-chat-compatible-send-mode';
const FLOATING_DRAG_MARGIN = 8;

let pipWindow = null;
let pipElements = null;
let sendTextareaMessage = null;
let sillyTavernIsGenerating = null;
let isGenerating = false;
let cleanupPipEventListeners = null;
let launcherRetryCount = 0;
let launcherRetryTimer = null;
let compatibleSendMode = readBooleanSetting({
    storage: globalThis.localStorage,
    key: COMPATIBLE_SEND_MODE_KEY,
    fallback: false,
});

function getContext() {
    return globalThis.SillyTavern?.getContext?.();
}

function getEventTypes(context) {
    return context?.eventTypes ?? context?.event_types ?? {};
}

function notifyError(message, error = null) {
    console.error(`[${EXTENSION_NAME}] ${message}`, error ?? '');
    if (globalThis.toastr?.error) {
        globalThis.toastr.error(message, '小窗模式');
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

    syncGenerationState();
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

    syncGenerationState();
    const hasText = pipElements.input.value.trim().length > 0;
    pipElements.send.disabled = isGenerating || !hasText;
    pipElements.regenerate.disabled = isGenerating || !getContext()?.chat?.length;
    pipElements.stop.disabled = !isGenerating;

    if (isGenerating) {
        setStatus('Generating', 'generating');
    } else if (pipElements.status.dataset.state !== 'error') {
        setStatus('Idle', 'idle');
    }
}

async function loadSendTextareaMessage() {
    if (sendTextareaMessage) {
        return sendTextareaMessage;
    }

    const module = await import('/script.js');
    sendTextareaMessage = module.sendTextareaMessage;
    sillyTavernIsGenerating = module.isGenerating;
    return sendTextareaMessage;
}

async function loadSillyTavernStatusHelpers() {
    if (sillyTavernIsGenerating) {
        return;
    }

    try {
        const module = await import('/script.js');
        sillyTavernIsGenerating = module.isGenerating;
    } catch (error) {
        console.debug(`[${EXTENSION_NAME}] Could not load SillyTavern status helper`, error);
    }
}

function syncGenerationState() {
    isGenerating = readGenerationState({
        localState: isGenerating,
        isGeneratingFn: sillyTavernIsGenerating,
    });
}

async function sendDraft() {
    if (!pipElements) {
        return;
    }

    try {
        const sendMessage = await loadSendTextareaMessage();
        const textarea = document.querySelector('#send_textarea');
        const sendButton = compatibleSendMode ? document.querySelector('#send_but') : null;
        await sendDraftToSillyTavern({
            text: pipElements.input.value,
            textarea,
            inputEventFactory: () => new Event('input', { bubbles: true }),
            sendTextareaMessage: sendMessage,
            compatibleIntentTarget: sendButton,
            compatibleIntentEventFactory: createCompatibleSendIntentEvent,
        });
        pipElements.input.value = '';
        resizePipInput();
        setStatus('Sent', 'idle');
        updateControls();
    } catch (error) {
        notifyError(error?.message ?? 'Send failed', error);
    }
}

function createCompatibleSendIntentEvent() {
    const options = {
        bubbles: true,
        cancelable: true,
        pointerType: 'mouse',
        button: 0,
    };

    if (typeof PointerEvent === 'function') {
        return new PointerEvent('pointerup', options);
    }

    return new Event('pointerup', {
        bubbles: true,
        cancelable: true,
    });
}

function stopGeneration() {
    try {
        const context = getContext();
        context?.stopGeneration?.();
    } catch (error) {
        notifyError(error?.message ?? 'Stop failed', error);
    }
}

async function regenerateLastMessage() {
    try {
        isGenerating = true;
        updateControls();
        await triggerRegenerate(getContext());
    } catch (error) {
        isGenerating = false;
        updateControls();
        notifyError(error?.message ?? 'Regenerate failed', error);
    }
}

function getPipStyles() {
    return `
        :root {
            color-scheme: light dark;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background: var(--SmartThemeBlurTintColor, #171717);
            color: var(--SmartThemeBodyColor, #f4f4f5);
            font-size: var(--mainFontSize, 14px);
        }
        * { box-sizing: border-box; }
        * {
            scrollbar-color: var(--grey7070a, var(--SmartThemeBorderColor, #8aa5bb)) color-mix(in srgb, var(--SmartThemeBlurTintColor, #171717) 70%, transparent);
            scrollbar-width: thin;
        }
        *::-webkit-scrollbar {
            width: 9px;
            height: 9px;
        }
        *::-webkit-scrollbar-track {
            background: color-mix(in srgb, var(--SmartThemeBlurTintColor, #171717) 72%, transparent);
            border-radius: 999px;
        }
        *::-webkit-scrollbar-thumb {
            background: color-mix(in srgb, var(--grey7070a, var(--SmartThemeBorderColor, #8aa5bb)) 82%, var(--SmartThemeBodyColor, #f4f4f5) 18%);
            border: 2px solid color-mix(in srgb, var(--SmartThemeBlurTintColor, #171717) 72%, transparent);
            border-radius: 999px;
        }
        *::-webkit-scrollbar-thumb:hover {
            background: var(--SmartThemeUnderlineColor, var(--grey7070a, #8aa5bb));
        }
        body {
            margin: 0;
            min-height: 100vh;
            background: var(--SmartThemeBlurTintColor, #171717);
            color: var(--SmartThemeBodyColor, #f4f4f5);
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
            border-bottom: 1px solid var(--SmartThemeBorderColor, #303036);
            background: linear-gradient(
                180deg,
                color-mix(in srgb, var(--SmartThemeBlurTintColor, #202024) 94%, var(--SmartThemeBodyColor, #f4f4f5) 6%),
                color-mix(in srgb, var(--SmartThemeBlurTintColor, #202024) 82%, var(--SmartThemeChatTintColor, #202024) 18%)
            );
            box-shadow: 0 1px 0 var(--SmartThemeBorderColor, #303036);
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
            color: var(--SmartThemeQuoteColor, #a1a1aa);
        }
        .pip-mini-chat__status[data-state="generating"] {
            color: #67e8f9;
        }
        .pip-mini-chat__status[data-state="error"] {
            color: #d33;
        }
        .pip-mini-chat__output {
            overflow: auto;
            padding: 12px;
            font-size: 14px;
            line-height: 1.55;
            overflow-wrap: anywhere;
        }
        .pip-mini-chat-empty {
            color: var(--SmartThemeQuoteColor, #a1a1aa);
        }
        .pip-mini-chat__input {
            display: block;
            width: calc(100% - 24px);
            height: 36px;
            min-height: 36px;
            max-height: 76px;
            margin: 0 12px 10px;
            resize: none;
            border: 1px solid var(--SmartThemeBorderColor, #3f3f46);
            border-radius: 8px;
            padding: 7px 10px;
            background: var(--black30a, rgba(36, 36, 41, 0.92));
            color: var(--SmartThemeBodyColor, #fafafa);
            font: inherit;
            line-height: 20px;
            overflow-y: hidden;
        }
        .pip-mini-chat__input:focus {
            border-color: var(--SmartThemeUnderlineColor, #22d3ee);
            outline: none;
        }
        .pip-mini-chat__actions {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 8px;
            padding: 0 12px 12px;
        }
        .pip-mini-chat__button {
            min-height: 36px;
            border: 1px solid var(--SmartThemeBorderColor, #3f3f46);
            border-radius: 8px;
            background: color-mix(in srgb, var(--SmartThemeBlurTintColor, #27272a) 76%, var(--SmartThemeBodyColor, #fafafa) 24%);
            color: var(--SmartThemeBodyColor, #fafafa);
            font: inherit;
            font-weight: 700;
            cursor: pointer;
        }
        .pip-mini-chat__button:hover:not(:disabled) {
            filter: brightness(1.08);
        }
        .pip-mini-chat__button:disabled {
            cursor: not-allowed;
            opacity: 0.5;
        }
        .pip-mini-chat__button--send {
            border-color: var(--SmartThemeUnderlineColor, #0891b2);
            background: color-mix(in srgb, var(--SmartThemeUnderlineColor, #0e7490) 45%, var(--SmartThemeBlurTintColor, #202024) 55%);
        }
        .pip-mini-chat__button--stop {
            border-color: #b44;
            background: color-mix(in srgb, #b44 38%, var(--SmartThemeBlurTintColor, #202024) 62%);
        }
        .pip-mini-chat__button--regenerate {
            border-color: var(--SmartThemeQuoteColor, #52525b);
            background: color-mix(in srgb, var(--SmartThemeQuoteColor, #3f3f46) 38%, var(--SmartThemeBlurTintColor, #202024) 62%);
        }
    `;
}

function copyThemeToPipDocument(targetDocument) {
    const themeVariables = collectThemeVariables(getComputedStyle(document.documentElement));
    const css = buildThemeVariableCss(themeVariables);

    if (!css) {
        return;
    }

    const style = targetDocument.createElement('style');
    style.dataset.pipMiniChatTheme = 'true';
    style.textContent = css;
    targetDocument.head.append(style);
}

function buildPipDocument(targetWindow) {
    const doc = targetWindow.document;
    doc.title = 'PiP Mini Chat';
    doc.body.innerHTML = `
        <main class="pip-mini-chat">
            <header class="pip-mini-chat__header">
                <div class="pip-mini-chat__title"></div>
                <div class="pip-mini-chat__status" data-state="idle">Idle</div>
            </header>
            <section class="pip-mini-chat__output" aria-live="polite"></section>
            <textarea class="pip-mini-chat__input" rows="1" placeholder="Message"></textarea>
            <div class="pip-mini-chat__actions">
                <button class="pip-mini-chat__button pip-mini-chat__button--send" type="button">Send</button>
                <button class="pip-mini-chat__button pip-mini-chat__button--regenerate" type="button">Retry</button>
                <button class="pip-mini-chat__button pip-mini-chat__button--stop" type="button">Stop</button>
            </div>
        </main>
    `;

    const style = doc.createElement('style');
    copyThemeToPipDocument(doc);
    style.textContent = getPipStyles();
    doc.head.append(style);

    pipElements = {
        title: doc.querySelector('.pip-mini-chat__title'),
        status: doc.querySelector('.pip-mini-chat__status'),
        output: doc.querySelector('.pip-mini-chat__output'),
        input: doc.querySelector('.pip-mini-chat__input'),
        send: doc.querySelector('.pip-mini-chat__button--send'),
        regenerate: doc.querySelector('.pip-mini-chat__button--regenerate'),
        stop: doc.querySelector('.pip-mini-chat__button--stop'),
    };

    resizePipInput();
    pipElements.input.addEventListener('input', () => {
        resizePipInput();
        updateControls();
    });
    pipElements.input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            void sendDraft();
        }
    });
    pipElements.send.addEventListener('click', () => void sendDraft());
    pipElements.regenerate.addEventListener('click', () => void regenerateLastMessage());
    pipElements.stop.addEventListener('click', stopGeneration);
}

function resizePipInput() {
    if (!pipElements?.input) {
        return;
    }

    const rawLineCount = String(pipElements.input.value ?? '').split('\n').length;
    const rowCount = getTextareaRowCount(pipElements.input.value);
    const height = 16 + (rowCount * 20);

    pipElements.input.rows = rowCount;
    pipElements.input.style.height = `${height}px`;
    pipElements.input.style.overflowY = rawLineCount > 3 ? 'auto' : 'hidden';
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
        notifyError('Document Picture-in-Picture is unavailable. Please use Chrome or Edge.');
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
        isGenerating = false;
        buildPipDocument(pipWindow);
        void loadSillyTavernStatusHelpers().then(() => {
            syncGenerationState();
            refreshPip();
        });
        registerPipEventListeners();
        pipWindow.addEventListener('pagehide', cleanupPip, { once: true });
        refreshPip();
        pipElements.input.focus();
    } catch (error) {
        cleanupPip();
        notifyError(error?.message ?? 'Could not open PiP window', error);
    }
}

function closePipWindow() {
    if (!shouldClosePipWindow(pipWindow)) {
        cleanupPip();
        return;
    }

    const windowToClose = pipWindow;
    cleanupPip();
    windowToClose.close();
}

async function togglePipWindow() {
    if (shouldClosePipWindow(pipWindow)) {
        closePipWindow();
        return;
    }

    await openPipWindow();
}

function createLauncherButton({ id, variant }) {
    const button = document.createElement('div');
    button.id = id;
    button.className = variant === 'menu'
        ? 'list-group-item flex-container flexGap5 interactable pip-mini-chat-menu-launcher'
        : 'pip-mini-chat-floating-launcher interactable';
    button.tabIndex = 0;
    button.role = 'button';
    button.title = 'Open small window mode';
    button.innerHTML = variant === 'menu'
        ? `${getLauncherIcon()}<span>小窗模式</span>`
        : getLauncherIcon();
    button.addEventListener('click', event => {
        if (button.dataset.dragMoved === 'true') {
            event.preventDefault();
            button.dataset.dragMoved = 'false';
            return;
        }

        void togglePipWindow();
    });
    button.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            void togglePipWindow();
        }
    });

    if (variant === 'floating') {
        restoreFloatingLauncherPosition(button);
        enableFloatingLauncherDrag(button);
    }

    return button;
}

function getLauncherIcon() {
    return `
        <svg class="pip-mini-chat-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="3" y="5" width="18" height="14" rx="2"></rect>
            <rect x="12" y="11" width="6" height="4" rx="1"></rect>
        </svg>
    `;
}

function getStoredFloatingPosition() {
    try {
        const raw = localStorage.getItem(FLOATING_POSITION_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function storeFloatingPosition(position) {
    try {
        localStorage.setItem(FLOATING_POSITION_KEY, JSON.stringify(position));
    } catch {
        // Position persistence is a convenience only.
    }
}

function getFloatingLauncherSize(button) {
    const rect = button.getBoundingClientRect();
    return {
        width: rect.width || 44,
        height: rect.height || 36,
    };
}

function applyFloatingLauncherPosition(button, position) {
    button.style.left = `${position.left}px`;
    button.style.top = `${position.top}px`;
    button.style.right = 'auto';
    button.style.bottom = 'auto';
}

function restoreFloatingLauncherPosition(button) {
    const stored = getStoredFloatingPosition();
    if (!stored || !Number.isFinite(stored.left) || !Number.isFinite(stored.top)) {
        return;
    }

    const size = getFloatingLauncherSize(button);
    applyFloatingLauncherPosition(button, normalizeFloatingPosition({
        left: stored.left,
        top: stored.top,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        elementWidth: size.width,
        elementHeight: size.height,
        margin: FLOATING_DRAG_MARGIN,
    }));
}

function enableFloatingLauncherDrag(button) {
    let dragState = null;

    button.addEventListener('pointerdown', event => {
        if (event.button !== 0) {
            return;
        }

        const rect = button.getBoundingClientRect();
        dragState = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            left: rect.left,
            top: rect.top,
            moved: false,
        };
        button.setPointerCapture?.(event.pointerId);
    });

    button.addEventListener('pointermove', event => {
        if (!dragState || event.pointerId !== dragState.pointerId) {
            return;
        }

        const deltaX = event.clientX - dragState.startX;
        const deltaY = event.clientY - dragState.startY;
        if (Math.abs(deltaX) + Math.abs(deltaY) > 4) {
            dragState.moved = true;
        }

        const size = getFloatingLauncherSize(button);
        const position = normalizeFloatingPosition({
            left: dragState.left + deltaX,
            top: dragState.top + deltaY,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            elementWidth: size.width,
            elementHeight: size.height,
            margin: FLOATING_DRAG_MARGIN,
        });
        applyFloatingLauncherPosition(button, position);
    });

    button.addEventListener('pointerup', event => {
        if (!dragState || event.pointerId !== dragState.pointerId) {
            return;
        }

        button.releasePointerCapture?.(event.pointerId);
        const position = {
            left: button.getBoundingClientRect().left,
            top: button.getBoundingClientRect().top,
        };
        storeFloatingPosition(position);

        if (dragState.moved) {
            button.dataset.dragMoved = 'true';
            window.setTimeout(() => {
                button.dataset.dragMoved = 'false';
            }, 150);
        }

        dragState = null;
    });

    window.addEventListener('resize', () => restoreFloatingLauncherPosition(button));
}

function registerLauncher() {
    for (const target of getLauncherTargets(document)) {
        if (document.getElementById(target.id)) {
            continue;
        }

        target.host.append(createLauncherButton(target));
    }
}

function setCompatibleSendMode(enabled) {
    compatibleSendMode = Boolean(enabled);
    writeBooleanSetting({
        storage: globalThis.localStorage,
        key: COMPATIBLE_SEND_MODE_KEY,
        value: compatibleSendMode,
    });
}

function registerSettingsPanel() {
    if (document.getElementById('pip-mini-chat-settings')) {
        return;
    }

    const host = document.querySelector('#extensions_settings');
    if (!host) {
        return;
    }

    const panel = document.createElement('div');
    panel.id = 'pip-mini-chat-settings';
    panel.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>
                    ${getLauncherIcon()}
                    <span>小窗模式</span>
                </b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label pip-mini-chat-settings__row" for="pip-mini-chat-compatible-send-mode">
                    <input id="pip-mini-chat-compatible-send-mode" type="checkbox" class="checkbox">
                    <span>兼容发送拦截插件</span>
                </label>
                <small class="pip-mini-chat-settings__hint">
                    开启后，小窗发送前会向主页面发送按钮发出一次发送意图信号，用于兼容数据库、剧情规划等拦截脚本。
                </small>
            </div>
        </div>
    `;

    const checkbox = panel.querySelector('#pip-mini-chat-compatible-send-mode');
    checkbox.checked = compatibleSendMode;
    checkbox.addEventListener('change', () => {
        setCompatibleSendMode(checkbox.checked);
    });

    host.append(panel);
}

function startLauncherRetry() {
    if (launcherRetryTimer) {
        return;
    }

    launcherRetryTimer = window.setInterval(() => {
        registerSettingsPanel();
        registerLauncher();
        launcherRetryCount += 1;

        if (
            (document.getElementById('pip-mini-chat-menu-open') && document.getElementById('pip-mini-chat-settings')) ||
            launcherRetryCount >= LAUNCHER_RETRY_LIMIT
        ) {
            window.clearInterval(launcherRetryTimer);
            launcherRetryTimer = null;
        }
    }, 500);
}

function handleEvent(eventName) {
    if (eventName === 'generation_started') {
        isGenerating = true;
    }

    if (eventName === 'generation_stopped' || eventName === 'generation_ended') {
        isGenerating = false;
    }

    syncGenerationState();
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
    registerSettingsPanel();
    registerLauncher();
    startLauncherRetry();
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
