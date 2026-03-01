//! JavaScript bridge for capturing webview state
//!
//! This module generates JavaScript code that gets injected into the webview
//! to capture console logs, errors, network requests, and custom events.

/// Returns the JavaScript code to inject into the webview
/// This creates the __TEST_BRIDGE__ global object
pub fn get_bridge_script() -> &'static str {
    r#"
(function() {
    // Prevent double initialization
    if (window.__TEST_BRIDGE__) {
        console.log('[TestBridge] Already initialized');
        return;
    }

    console.log('[TestBridge] Initializing...');

    // Storage for captured data
    const consoleLogs = [];
    const errors = [];
    const networkRequests = [];
    const events = [];

    // Maximum entries to keep (prevent memory issues)
    const MAX_ENTRIES = 1000;

    function trimArray(arr) {
        while (arr.length > MAX_ENTRIES) {
            arr.shift();
        }
    }

    function now() {
        return Date.now();
    }

    // ============================================================================
    // Console Capture
    // ============================================================================
    const originalConsole = {
        log: console.log.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        info: console.info.bind(console),
        debug: console.debug.bind(console),
    };

    function captureConsole(level, args) {
        const entry = {
            level,
            message: args.map(arg => {
                try {
                    return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
                } catch {
                    return String(arg);
                }
            }).join(' '),
            timestamp: now(),
            args: args.map(arg => {
                try {
                    return JSON.parse(JSON.stringify(arg));
                } catch {
                    return String(arg);
                }
            }),
        };
        consoleLogs.push(entry);
        trimArray(consoleLogs);
    }

    console.log = function(...args) {
        captureConsole('log', args);
        originalConsole.log(...args);
    };

    console.warn = function(...args) {
        captureConsole('warn', args);
        originalConsole.warn(...args);
    };

    console.error = function(...args) {
        captureConsole('error', args);
        originalConsole.error(...args);
    };

    console.info = function(...args) {
        captureConsole('info', args);
        originalConsole.info(...args);
    };

    console.debug = function(...args) {
        captureConsole('debug', args);
        originalConsole.debug(...args);
    };

    // ============================================================================
    // Error Capture
    // ============================================================================
    window.addEventListener('error', function(event) {
        const entry = {
            message: event.message || 'Unknown error',
            source: event.filename || null,
            lineno: event.lineno || null,
            colno: event.colno || null,
            stack: event.error?.stack || null,
            timestamp: now(),
        };
        errors.push(entry);
        trimArray(errors);
    });

    window.addEventListener('unhandledrejection', function(event) {
        const reason = event.reason;
        const entry = {
            message: reason?.message || String(reason) || 'Unhandled Promise rejection',
            source: null,
            lineno: null,
            colno: null,
            stack: reason?.stack || null,
            timestamp: now(),
        };
        errors.push(entry);
        trimArray(errors);
    });

    // ============================================================================
    // Network Capture (fetch interception)
    // ============================================================================
    const originalFetch = window.fetch.bind(window);

    window.fetch = async function(input, init) {
        const url = typeof input === 'string' ? input : input.url;
        const method = init?.method || (typeof input === 'object' ? input.method : 'GET') || 'GET';
        const startTime = now();

        const entry = {
            method: method.toUpperCase(),
            url,
            status: null,
            duration_ms: null,
            request_headers: {},
            response_headers: {},
            timestamp: startTime,
        };

        // Capture request headers
        if (init?.headers) {
            const headers = new Headers(init.headers);
            headers.forEach((value, key) => {
                entry.request_headers[key] = value;
            });
        }

        try {
            const response = await originalFetch(input, init);
            entry.status = response.status;
            entry.duration_ms = now() - startTime;

            // Capture response headers
            response.headers.forEach((value, key) => {
                entry.response_headers[key] = value;
            });

            networkRequests.push(entry);
            trimArray(networkRequests);

            return response;
        } catch (error) {
            entry.duration_ms = now() - startTime;
            entry.status = 0; // Network error
            networkRequests.push(entry);
            trimArray(networkRequests);
            throw error;
        }
    };

    // Also capture XMLHttpRequest
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this.__testBridge = {
            method: method.toUpperCase(),
            url: String(url),
            startTime: null,
            request_headers: {},
        };
        return originalXHROpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function(body) {
        if (this.__testBridge) {
            this.__testBridge.startTime = now();

            this.addEventListener('loadend', () => {
                const entry = {
                    method: this.__testBridge.method,
                    url: this.__testBridge.url,
                    status: this.status,
                    duration_ms: now() - this.__testBridge.startTime,
                    request_headers: this.__testBridge.request_headers,
                    response_headers: {},
                    timestamp: this.__testBridge.startTime,
                };

                // Parse response headers
                const headerStr = this.getAllResponseHeaders();
                if (headerStr) {
                    headerStr.split('\r\n').forEach(line => {
                        const parts = line.split(': ');
                        if (parts.length === 2) {
                            entry.response_headers[parts[0]] = parts[1];
                        }
                    });
                }

                networkRequests.push(entry);
                trimArray(networkRequests);
            });
        }
        return originalXHRSend.call(this, body);
    };

    // ============================================================================
    // Custom Event Capture
    // ============================================================================
    function emitEvent(name, detail) {
        const entry = {
            name,
            detail: detail || {},
            timestamp: now(),
        };
        events.push(entry);
        trimArray(events);
    }

    // ============================================================================
    // Query Helpers
    // ============================================================================
    function queryElements(selector) {
        const elements = document.querySelectorAll(selector);
        return Array.from(elements).map(el => ({
            tag: el.tagName.toLowerCase(),
            id: el.id || null,
            classes: Array.from(el.classList),
            text: el.textContent?.trim()?.substring(0, 200) || null,
            attributes: Object.fromEntries(
                Array.from(el.attributes).map(attr => [attr.name, attr.value])
            ),
        }));
    }

    function getComputedStyles(selector, properties) {
        const el = document.querySelector(selector);
        if (!el) {
            return { found: false, styles: {} };
        }
        const computed = window.getComputedStyle(el);
        const styles = {};
        properties.forEach(prop => {
            styles[prop] = computed.getPropertyValue(prop);
        });
        return { found: true, styles };
    }

    function getDomSnapshot() {
        return {
            html: document.documentElement.outerHTML,
            title: document.title,
            url: window.location.href,
        };
    }

    // ============================================================================
    // Tauri Invoke Helper
    // ============================================================================
    async function sendCallback(requestId, result) {
        try {
            if (window.__TAURI__ && window.__TAURI__.core) {
                await window.__TAURI__.core.invoke('test_server_callback', {
                    requestId: requestId,
                    result: result
                });
            }
        } catch (e) {
            originalConsole.error('[TestBridge] Failed to send callback:', e);
        }
    }

    // ============================================================================
    // Bridge API
    // ============================================================================
    window.__TEST_BRIDGE__ = {
        // Data access
        getConsoleLogs: () => [...consoleLogs],
        getErrors: () => [...errors],
        getNetworkRequests: () => [...networkRequests],
        getEvents: () => [...events],

        // Clear data
        clearConsoleLogs: () => { consoleLogs.length = 0; },
        clearErrors: () => { errors.length = 0; },
        clearNetworkRequests: () => { networkRequests.length = 0; },
        clearEvents: () => { events.length = 0; },
        clearAll: () => {
            consoleLogs.length = 0;
            errors.length = 0;
            networkRequests.length = 0;
            events.length = 0;
        },

        // DOM helpers
        query: queryElements,
        getStyles: getComputedStyles,
        getDom: getDomSnapshot,

        // Event emission
        emit: emitEvent,

        // Execute arbitrary JS and return result
        execute: (code) => {
            try {
                const result = eval(code);
                return { success: true, result, error: null };
            } catch (e) {
                return { success: false, result: null, error: e.message };
            }
        },

        // Async execute with callback to Rust
        executeWithCallback: async (requestId, code) => {
            try {
                let result = eval(code);
                // If result is a Promise, await it
                if (result && typeof result.then === 'function') {
                    result = await result;
                }
                await sendCallback(requestId, { success: true, result, error: null });
            } catch (e) {
                await sendCallback(requestId, { success: false, result: null, error: e.message });
            }
        },

        // Send data back to Rust
        sendCallback: sendCallback,

        // Health check
        isConnected: true,
        version: '1.0.0',

        // Extension management helpers
        refreshExtensions: async () => {
            try {
                // Try to access the extension manager and refresh it
                if (window.__EXTENSION_MANAGER__ && window.__EXTENSION_MANAGER__.refresh) {
                    await window.__EXTENSION_MANAGER__.refresh();
                    return { success: true, message: 'Extensions refreshed' };
                }
                // Alternative: try via the services
                const services = window.__BLINK_SERVICES__;
                if (services && services.extensionManager && services.extensionManager.refresh) {
                    await services.extensionManager.refresh();
                    return { success: true, message: 'Extensions refreshed via services' };
                }
                // Last resort: try importing the module dynamically
                try {
                    const { getExtensionManager } = await import('/src/services/extensions/extensionManager.ts');
                    const manager = getExtensionManager();
                    await manager.refresh();
                    return { success: true, message: 'Extensions refreshed via dynamic import' };
                } catch (e) {
                    return { success: false, error: 'Extension manager not accessible: ' + e.message };
                }
            } catch (e) {
                return { success: false, error: e.message };
            }
        },

        // Get extension list from UI
        getExtensionsFromUI: () => {
            try {
                const extensionCards = document.querySelectorAll('.extension-card, [data-extension-id]');
                return Array.from(extensionCards).map(card => ({
                    id: card.getAttribute('data-extension-id') || card.querySelector('.extension-name')?.textContent,
                    name: card.querySelector('.extension-name, .name')?.textContent,
                    version: card.querySelector('.extension-version, .version')?.textContent,
                })).filter(e => e.id || e.name);
            } catch (e) {
                return [];
            }
        },
    };

    originalConsole.log('[TestBridge] Initialized successfully');
})();
"#
}
