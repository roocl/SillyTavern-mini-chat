export function createMessageView(container, { host, theme, onResize }) {
    const owner = container.ownerDocument.defaultView;
    let frame = null;
    let observer = null;
    const subscriptions = new Set();
    const bridgeName = '__pipMiniChatInitialize';
    const previous = owner[bridgeName];
    const input = owner.document.querySelector('#send_textarea');
    const previousSlash = owner.triggerSlash;
    const hostSlash = host.triggerSlash?.bind(host);
    owner.triggerSlash = command => {
        const match = String(command).match(/^\/setinput(?:\s+([^|]*))?$/i);
        if (match) {
            input.value = match[1] ?? '';
            input.dispatchEvent(new owner.Event('input', { bubbles: true }));
            input.focus();
            return Promise.resolve('');
        }
        return hostSlash?.(command);
    };
    owner[bridgeName] = child => {
        if (child.frameElement !== frame) return;
        child.triggerSlash = owner.triggerSlash;
        child.document.addEventListener('DOMContentLoaded', () => {
            const proxy = child.document.createElement('textarea');
            proxy.id = 'send_textarea';
            proxy.hidden = true;
            proxy.style.setProperty('display', 'none', 'important');
            Object.defineProperty(proxy, 'value', {
                get: () => input.value,
                set: value => { input.value = String(value); },
            });
            proxy.addEventListener('input', () => input.dispatchEvent(new owner.Event('input', { bubbles: true })));
            proxy.focus = () => input.focus();
            child.document.body.append(proxy);
        }, { once: true });
        for (const name of ['_', 'toastr', 'SillyTavern', 'TavernHelper', 'Mvu',
            'getAllVariables', 'waitGlobalInitialized', 'eventOn', 'eventMakeLast',
            'eventSource', 'eventTypes', 'errorCatched']) {
            if (host[name] !== undefined) child[name] = host[name];
        }
        if (typeof host.eventOn === 'function') {
            child.eventOn = (...args) => {
                const subscription = host.eventOn(...args);
                if (typeof subscription?.stop === 'function') subscriptions.add(subscription);
                return subscription;
            };
        }
        const jq = host.jQuery ?? host.$;
        if (typeof jq === 'function') {
            const local = (selector, context) => {
                if (typeof selector === 'function') {
                    if (child.document.readyState === 'loading') {
                        child.document.addEventListener('DOMContentLoaded', () => selector(local), { once: true });
                    } else {
                        child.queueMicrotask(() => selector(local));
                    }
                    return jq(child.document);
                }
                return jq(selector, context ?? child.document);
            };
            Object.assign(local, jq);
            child.$ = child.jQuery = local;
        }
    };
    return {
        render(html) {
            for (const subscription of subscriptions) subscription.stop();
            subscriptions.clear();
            observer?.disconnect();
            frame?.remove();
            frame = owner.document.createElement('iframe');
            frame.title = 'Chat reply';
            frame.style.cssText = 'display:block;width:100%;height:1px;border:0;';
            const current = frame;
            frame.addEventListener('load', () => {
                if (frame !== current) return;
                const doc = current.contentDocument;
                if (!doc?.body) return;
                observer = new owner.ResizeObserver(() => {
                    if (frame !== current) return;
                    const height = Math.ceil(doc.body.getBoundingClientRect().height);
                    current.style.height = Math.max(height, 1) + 'px';
                    onResize();
                });
                observer.observe(doc.body);
            });
            const parsed = new owner.DOMParser().parseFromString(html, 'text/html');
            const base = parsed.createElement('base');
            base.href = host.document.baseURI;
            const style = parsed.createElement('style');
            style.textContent = theme + 'html,body{margin:0;min-height:0;}body{display:flow-root;color:var(--SmartThemeBodyColor,#f4f4f5);font:14px/1.55 system-ui;overflow-wrap:anywhere;}img,video,canvas{max-width:100%;}';
            const bootstrap = parsed.createElement('script');
            bootstrap.textContent = 'parent.' + bridgeName + '(window);';
            parsed.head.prepend(base, style, bootstrap);
            frame.srcdoc = '<!doctype html>' + parsed.documentElement.outerHTML;
            container.replaceChildren(frame);
        },
        dispose() {
            for (const subscription of subscriptions) subscription.stop();
            subscriptions.clear();
            observer?.disconnect();
            frame?.remove();
            frame = null;
            if (previous === undefined) delete owner[bridgeName];
            else owner[bridgeName] = previous;
            if (previousSlash === undefined) delete owner.triggerSlash;
            else owner.triggerSlash = previousSlash;
        },
    };
}
