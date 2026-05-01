import test from 'node:test';
import assert from 'node:assert/strict';

import {
    EVENT_NAMES,
    buildEventList,
    bindEventHandlers,
    findLatestAssistantMessage,
    formatLatestAssistantMessage,
    getLauncherTargets,
    sendDraftToSillyTavern,
} from '../core.js';

test('findLatestAssistantMessage returns the newest non-user non-system message', () => {
    const chat = [
        { name: 'User', is_user: true, mes: 'hello' },
        { name: 'Alice', is_user: false, mes: 'first' },
        { name: 'System', is_system: true, mes: 'system note' },
        { name: 'Bob', is_user: false, mes: 'latest' },
        { name: 'User', is_user: true, mes: 'reply' },
    ];

    assert.deepEqual(findLatestAssistantMessage(chat), {
        message: chat[3],
        index: 3,
    });
});

test('formatLatestAssistantMessage uses SillyTavern formatter when available', () => {
    const chat = [{ name: 'Alice', is_user: false, mes: '**hello**' }];
    const html = formatLatestAssistantMessage({
        chat,
        formatter: (text, name, isSystem, isUser, index) => {
            assert.equal(text, '**hello**');
            assert.equal(name, 'Alice');
            assert.equal(isSystem, false);
            assert.equal(isUser, false);
            assert.equal(index, 0);
            return '<strong>hello</strong>';
        },
    });

    assert.equal(html, '<strong>hello</strong>');
});

test('formatLatestAssistantMessage escapes text when formatter is unavailable', () => {
    const chat = [{ name: 'Alice', is_user: false, mes: '<script>alert(1)</script>\nhello' }];

    assert.equal(
        formatLatestAssistantMessage({ chat }),
        '&lt;script&gt;alert(1)&lt;/script&gt;<br>hello',
    );
});

test('sendDraftToSillyTavern writes text into the main textarea and calls sendTextareaMessage', async () => {
    const events = [];
    const textarea = {
        value: '',
        dispatchEvent(event) {
            events.push(event.type);
            return true;
        },
    };
    let sent = false;

    await sendDraftToSillyTavern({
        text: '  hi there  ',
        textarea,
        inputEventFactory: () => ({ type: 'input' }),
        sendTextareaMessage: async () => {
            sent = true;
        },
    });

    assert.equal(textarea.value, 'hi there');
    assert.deepEqual(events, ['input']);
    assert.equal(sent, true);
});

test('sendDraftToSillyTavern rejects empty input without sending', async () => {
    let sent = false;

    await assert.rejects(
        () => sendDraftToSillyTavern({
            text: '   ',
            textarea: { value: '', dispatchEvent() {} },
            inputEventFactory: () => ({ type: 'input' }),
            sendTextareaMessage: async () => {
                sent = true;
            },
        }),
        /empty/i,
    );

    assert.equal(sent, false);
});

test('buildEventList supports current and legacy event type keys', () => {
    const eventTypes = {
        CHAT_CHANGED: 'chat_id_changed',
        MESSAGE_RECEIVED: 'message_received',
        GENERATION_ENDED: 'generation_ended',
    };

    assert.deepEqual(buildEventList({ eventTypes }), [
        'chat_id_changed',
        'message_received',
        'generation_ended',
        EVENT_NAMES.CHARACTER_MESSAGE_RENDERED,
        EVENT_NAMES.MESSAGE_SENT,
        EVENT_NAMES.STREAM_TOKEN_RECEIVED,
        EVENT_NAMES.GENERATION_STARTED,
        EVENT_NAMES.GENERATION_STOPPED,
    ]);
});

test('bindEventHandlers registers handlers and returns a cleanup function', () => {
    const registered = [];
    const removed = [];
    const eventSource = {
        on(eventName, handler) {
            registered.push([eventName, handler]);
        },
        removeListener(eventName, handler) {
            removed.push([eventName, handler]);
        },
    };

    const cleanup = bindEventHandlers({
        eventSource,
        eventNames: ['a', 'b'],
        onEvent: () => {},
    });

    assert.equal(registered.length, 2);
    cleanup();
    assert.deepEqual(removed, registered);
});

test('getLauncherTargets includes menu and body targets when available', () => {
    const menu = { id: 'extensionsMenu' };
    const body = { id: 'body' };
    const doc = {
        body,
        querySelector(selector) {
            return selector === '#extensionsMenu' ? menu : null;
        },
    };

    assert.deepEqual(getLauncherTargets(doc), [
        { id: 'pip-mini-chat-menu-open', host: menu, variant: 'menu' },
        { id: 'pip-mini-chat-floating-open', host: body, variant: 'floating' },
    ]);
});

test('getLauncherTargets falls back to body when the extensions menu is unavailable', () => {
    const body = { id: 'body' };
    const doc = {
        body,
        querySelector() {
            return null;
        },
    };

    assert.deepEqual(getLauncherTargets(doc), [
        { id: 'pip-mini-chat-floating-open', host: body, variant: 'floating' },
    ]);
});
