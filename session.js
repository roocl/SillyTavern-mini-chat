export function createDraftSender() {
    let pending = false;
    const sender = {
        get pending() { return pending; },
        async run(submit) {
            if (pending) return false;
            pending = true;
            try {
                await submit();
                return true;
            } finally {
                pending = false;
            }
        },
        async send(input, submit) {
            if (!input.value.trim()) return false;
            const draft = input.value;
            return sender.run(async () => {
                await submit(draft);
                if (input.value === draft) input.value = '';
            });
        },
    };
    return sender;
}

export function measureInputHeight(scrollHeight, lineHeight, chromeHeight) {
    const maximum = lineHeight * 3 + chromeHeight;
    const height = Math.min(maximum, Math.max(lineHeight + chromeHeight, scrollHeight + 2));
    return { height, overflow: scrollHeight + 2 > maximum ? 'auto' : 'hidden' };
}
