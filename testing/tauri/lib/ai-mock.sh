#!/bin/bash
# AI Mock Infrastructure
#
# Provides mock/interceptor for AI API calls to enable reliable testing
# without requiring actual authentication or network access.
#
# Usage:
#   source ./lib/ai-mock.sh
#   ai_mock_install             # Install mock interceptor
#   ai_mock_set_response "..."  # Set mock response
#   ai_mock_uninstall           # Remove mock and restore real API

# Mock configuration
OCA_MOCK_ENABLED="${OCA_MOCK_ENABLED:-1}"
OCA_MOCK_DELAY="${OCA_MOCK_DELAY:-100}"  # Simulated network delay in ms

# ============================================================================
# Mock Response Templates
# ============================================================================

AI_MOCK_RESPONSE_HELLO="Hello! I am Blink Code Assist. How can I help you today?"
OCA_MOCK_RESPONSE_CODE='Here is a simple function:\n\n```javascript\nfunction greet(name) {\n  return `Hello, ${name}!`;\n}\n```'
OCA_MOCK_RESPONSE_PLAN='## Implementation Plan\n\n1. **CREATE** `src/components/Button.tsx`\n   - Add button component with props\n\n2. **MODIFY** `src/App.tsx`\n   - Import and use new Button\n\nType `/approve` to execute this plan.'
OCA_MOCK_RESPONSE_RUN='```bash\nls -la\n```\n\nThis command lists all files including hidden ones.'

# ============================================================================
# Install Mock Interceptor
# ============================================================================

# Install the AI mock interceptor in the browser
# This intercepts fetch calls to the AI endpoint and returns mock responses
# Usage: ai_mock_install [window]
ai_mock_install() {
    local window="${1:-main}"

    if [ "$OCA_MOCK_ENABLED" != "1" ]; then
        echo -e "${YELLOW}AI Mock disabled (OCA_MOCK_ENABLED=$OCA_MOCK_ENABLED)${NC}" >&2
        return 0
    fi

    echo -e "${CYAN}Installing AI mock interceptor...${NC}" >&2

    test_js "(function() {
        // Store original fetch
        if (!window.__ORIGINAL_FETCH__) {
            window.__ORIGINAL_FETCH__ = window.fetch;
        }

        // Mock state
        window.__OCA_MOCK__ = {
            enabled: true,
            delay: ${OCA_MOCK_DELAY},
            callCount: 0,
            lastRequest: null,
            customResponse: null,
            errorMode: null,
            conversationHistory: [],
            authState: 'authenticated'  // 'authenticated', 'expired', 'none'
        };

        // Mock response generator
        window.__OCA_MOCK__.generateResponse = function(messages) {
            const lastMessage = messages[messages.length - 1];
            const content = lastMessage?.content?.toLowerCase() || '';

            // Store in conversation history
            this.conversationHistory.push(lastMessage);

            // Check for custom response
            if (this.customResponse) {
                return this.customResponse;
            }

            // Generate contextual response
            if (content.includes('/run') || content.includes('command')) {
                return '${OCA_MOCK_RESPONSE_RUN}';
            }
            if (content.includes('/plan') || content.includes('implement') || content.includes('create')) {
                return '${OCA_MOCK_RESPONSE_PLAN}';
            }
            if (content.includes('code') || content.includes('function') || content.includes('write')) {
                return '${OCA_MOCK_RESPONSE_CODE}';
            }
            if (content.includes('hello') || content.includes('hi') || content.includes('help')) {
                return '${OCA_MOCK_RESPONSE_HELLO}';
            }

            // Default response with context awareness
            const turnCount = this.conversationHistory.length;
            if (turnCount > 1) {
                return 'Based on our conversation, I understand you want to ' + content.substring(0, 50) + '. Let me help with that.';
            }
            return 'I received your message: \"' + content.substring(0, 100) + '\". How can I assist further?';
        };

        // Create streaming response
        window.__OCA_MOCK__.createStreamingResponse = function(text) {
            const encoder = new TextEncoder();
            const words = text.split(' ');
            let wordIndex = 0;

            return new ReadableStream({
                start(controller) {
                    function pushWord() {
                        if (wordIndex < words.length) {
                            const word = words[wordIndex] + (wordIndex < words.length - 1 ? ' ' : '');
                            const chunk = {
                                choices: [{
                                    delta: { content: word },
                                    index: 0
                                }]
                            };
                            controller.enqueue(encoder.encode('data: ' + JSON.stringify(chunk) + '\\n\\n'));
                            wordIndex++;
                            setTimeout(pushWord, 20); // 20ms between words for realistic streaming
                        } else {
                            controller.enqueue(encoder.encode('data: [DONE]\\n\\n'));
                            controller.close();
                        }
                    }
                    pushWord();
                }
            });
        };

        // Override fetch
        window.fetch = async function(url, options) {
            const mock = window.__OCA_MOCK__;

            // Only intercept AI API calls
            const isOCACall = typeof url === 'string' && (
                url.includes('aiservice') ||
                url.includes('code-internal') ||
                url.includes('litellm')
            );

            if (!isOCACall || !mock.enabled) {
                return window.__ORIGINAL_FETCH__.apply(this, arguments);
            }

            mock.callCount++;
            mock.lastRequest = { url, options, timestamp: Date.now() };

            // Simulate network delay
            await new Promise(r => setTimeout(r, mock.delay));

            // Handle error modes
            if (mock.errorMode === 'network') {
                throw new Error('Network error: Failed to fetch');
            }
            if (mock.errorMode === 'timeout') {
                await new Promise(r => setTimeout(r, 30000));
                throw new Error('Request timeout');
            }
            if (mock.errorMode === '401' || mock.authState === 'expired') {
                return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            if (mock.errorMode === '429') {
                return new Response(JSON.stringify({ error: 'Rate limited' }), {
                    status: 429,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            if (mock.errorMode === '500') {
                return new Response(JSON.stringify({ error: 'Internal server error' }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Check auth state
            if (mock.authState === 'none') {
                return new Response(JSON.stringify({ error: 'No token' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Parse request body to get messages
            let messages = [];
            try {
                const body = JSON.parse(options?.body || '{}');
                messages = body.messages || [];
            } catch (e) {}

            // Generate response
            const responseText = mock.generateResponse(messages);

            // Return streaming response
            return new Response(mock.createStreamingResponse(responseText), {
                status: 200,
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive'
                }
            });
        };

        // Also mock token state for unauthenticated testing
        if (window.__AI_SERVICE__) {
            window.__OCA_MOCK__.originalHasValidToken = window.__AI_SERVICE__.hasValidToken.bind(window.__AI_SERVICE__);
            window.__AI_SERVICE__.hasValidToken = function() {
                if (window.__OCA_MOCK__.authState === 'authenticated') {
                    return true;
                }
                return false;
            };
        }

        return 'mock-installed';
    })()" "$window"
}

# Uninstall the mock and restore original fetch
# Usage: ai_mock_uninstall [window]
ai_mock_uninstall() {
    local window="${1:-main}"

    test_js "(function() {
        if (window.__ORIGINAL_FETCH__) {
            window.fetch = window.__ORIGINAL_FETCH__;
            delete window.__ORIGINAL_FETCH__;
        }
        if (window.__OCA_MOCK__?.originalHasValidToken && window.__AI_SERVICE__) {
            window.__AI_SERVICE__.hasValidToken = window.__OCA_MOCK__.originalHasValidToken;
        }
        if (window.__OCA_MOCK__) {
            delete window.__OCA_MOCK__;
        }
        return 'mock-uninstalled';
    })()" "$window"
}

# ============================================================================
# Mock Control Functions
# ============================================================================

# Set a custom response for the next API call
# Usage: ai_mock_set_response "Custom response text" [window]
ai_mock_set_response() {
    local response="$1"
    local window="${2:-main}"

    test_js "(function() {
        if (window.__OCA_MOCK__) {
            window.__OCA_MOCK__.customResponse = '$response';
            return 'response-set';
        }
        return 'no-mock';
    })()" "$window"
}

# Clear custom response (return to auto-generated responses)
# Usage: ai_mock_clear_response [window]
ai_mock_clear_response() {
    local window="${1:-main}"

    test_js "(function() {
        if (window.__OCA_MOCK__) {
            window.__OCA_MOCK__.customResponse = null;
            return 'response-cleared';
        }
        return 'no-mock';
    })()" "$window"
}

# Set error mode for testing error handling
# Usage: ai_mock_set_error "network|timeout|401|429|500|none" [window]
ai_mock_set_error() {
    local error_mode="$1"
    local window="${2:-main}"

    test_js "(function() {
        if (window.__OCA_MOCK__) {
            window.__OCA_MOCK__.errorMode = '$error_mode' === 'none' ? null : '$error_mode';
            return 'error-mode-set';
        }
        return 'no-mock';
    })()" "$window"
}

# Set auth state for testing auth flows
# Usage: ai_mock_set_auth "authenticated|expired|none" [window]
ai_mock_set_auth() {
    local auth_state="$1"
    local window="${2:-main}"

    test_js "(function() {
        if (window.__OCA_MOCK__) {
            window.__OCA_MOCK__.authState = '$auth_state';
            return 'auth-state-set';
        }
        return 'no-mock';
    })()" "$window"
}

# Get mock statistics
# Usage: stats=$(ai_mock_get_stats [window])
ai_mock_get_stats() {
    local window="${1:-main}"

    test_js "(function() {
        if (window.__OCA_MOCK__) {
            return JSON.stringify({
                callCount: window.__OCA_MOCK__.callCount,
                conversationTurns: window.__OCA_MOCK__.conversationHistory.length,
                lastRequest: window.__OCA_MOCK__.lastRequest,
                errorMode: window.__OCA_MOCK__.errorMode,
                authState: window.__OCA_MOCK__.authState
            });
        }
        return '{}';
    })()" "$window"
}

# Clear conversation history
# Usage: ai_mock_clear_history [window]
ai_mock_clear_history() {
    local window="${1:-main}"

    test_js "(function() {
        if (window.__OCA_MOCK__) {
            window.__OCA_MOCK__.conversationHistory = [];
            window.__OCA_MOCK__.callCount = 0;
            return 'history-cleared';
        }
        return 'no-mock';
    })()" "$window"
}

# Set network delay for simulating slow connections
# Usage: ai_mock_set_delay 2000 [window]  # 2 second delay
ai_mock_set_delay() {
    local delay="$1"
    local window="${2:-main}"

    test_js "(function() {
        if (window.__OCA_MOCK__) {
            window.__OCA_MOCK__.delay = $delay;
            return 'delay-set';
        }
        return 'no-mock';
    })()" "$window"
}

# ============================================================================
# Chat Interaction Helpers
# ============================================================================

# Send a chat message and wait for response
# Usage: response=$(oca_send_message "Hello" [wait_ms] [window])
oca_send_message() {
    local message="$1"
    local wait_time="${2:-3000}"
    local window="${3:-main}"

    # Escape message for JavaScript
    local escaped_message=$(echo "$message" | sed 's/\\/\\\\/g' | sed "s/'/\\\\'/g" | sed 's/"/\\"/g')

    test_js "(async function() {
        try {
            // First, make sure chat panel is open by clicking the Chat tab
            const chatTab = document.querySelector('[aria-label*=\"Chat\"][aria-label*=\"⌃⌘I\"], [aria-label=\"Chat\"]');
            if (chatTab) {
                chatTab.click();
                await new Promise(r => setTimeout(r, 300));
            }

            // Try multiple selectors for the chat input
            const inputSelectors = [
                '.chat-editor-container textarea.inputarea',
                '.interactive-input-editor textarea.inputarea',
                '.interactive-input-part textarea.inputarea',
                'textarea.inputarea.monaco-mouse-cursor-text'
            ];

            let textarea = null;
            for (const sel of inputSelectors) {
                textarea = document.querySelector(sel);
                if (textarea) break;
            }

            if (!textarea) {
                // Try clicking the chat editor container to ensure focus
                const container = document.querySelector('.chat-editor-container, .interactive-input-editor');
                if (container) {
                    container.click();
                    await new Promise(r => setTimeout(r, 200));
                    textarea = container.querySelector('textarea.inputarea');
                }
            }

            if (!textarea) {
                return { success: false, error: 'no-textarea-found' };
            }

            // Focus the textarea
            textarea.focus();
            await new Promise(r => setTimeout(r, 100));

            // Type the message
            document.execCommand('selectAll');
            document.execCommand('insertText', false, '$escaped_message');
            await new Promise(r => setTimeout(r, 200));

            // Count current responses before sending
            const responseSelectors = '.chat-response, .interactive-item-container, .chat-message-role-assistant';
            const beforeCount = document.querySelectorAll(responseSelectors).length;

            // Find and click send button with multiple selectors
            const sendSelectors = [
                '[aria-label*=\"Send\"][aria-label*=\"⇧⌘Enter\"]',
                '[aria-label*=\"Send\"]',
                '.codicon-send',
                '.chat-input-toolbars button:last-child'
            ];

            let sent = false;
            for (const sel of sendSelectors) {
                const btn = document.querySelector(sel);
                if (btn && btn.offsetParent !== null) {
                    btn.click();
                    sent = true;
                    break;
                }
            }

            if (!sent) {
                // Try Ctrl+Enter or Enter on the textarea
                textarea.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    ctrlKey: true,
                    bubbles: true
                }));
            }

            // Wait for response
            await new Promise(r => setTimeout(r, $wait_time));

            // Get the response using multiple selectors
            const responses = document.querySelectorAll(responseSelectors);
            const afterCount = responses.length;

            // Get latest response content
            let responseText = '';
            let responseHtml = '';
            if (afterCount > beforeCount) {
                const lastResponse = responses[responses.length - 1];
                responseText = lastResponse.textContent?.trim() || '';
                responseHtml = lastResponse.innerHTML || '';
            }

            return {
                success: true,
                messageSent: '$escaped_message',
                responseCount: afterCount,
                newResponses: afterCount - beforeCount,
                responseText: responseText.substring(0, 1000),
                hasMarkdown: responseHtml.includes('rendered-markdown') || responseHtml.includes('<code'),
                hasCodeBlock: responseHtml.includes('<pre') || responseHtml.includes('code-block')
            };
        } catch (e) {
            return { success: false, error: e.message };
        }
    })()" "$window"
}

# Get current chat responses
# Usage: responses=$(oca_get_chat_responses [window])
oca_get_chat_responses() {
    local window="${1:-main}"

    test_js "(function() {
        const responses = document.querySelectorAll('.interactive-item-container');
        return Array.from(responses).map((r, i) => ({
            index: i,
            role: r.classList.contains('user') ? 'user' : 'assistant',
            text: r.textContent?.trim()?.substring(0, 500) || '',
            hasCode: r.querySelector('code, pre') !== null,
            hasMarkdown: r.querySelector('.rendered-markdown') !== null
        }));
    })()" "$window"
}

# Clear the chat
# Usage: oca_clear_chat [window]
oca_clear_chat() {
    local window="${1:-main}"

    test_js "(async function() {
        const vscode = window.require?.('vscode');
        if (vscode) {
            await vscode.commands.executeCommand('workbench.action.chat.clear');
            return 'cleared';
        }
        return 'no-vscode';
    })()" "$window"
}

# Check if chat is showing loading/streaming state
# Usage: is_loading=$(oca_is_chat_loading [window])
oca_is_chat_loading() {
    local window="${1:-main}"

    test_js "(function() {
        const loading = document.querySelector('.interactive-item-container.loading, .chat-progress, [class*=\"typing\"], [class*=\"streaming\"]');
        const throbber = document.querySelector('.monaco-icon-label-container .codicon-loading, .throbber');
        return loading || throbber ? 'loading' : 'idle';
    })()" "$window"
}

# Wait for chat to finish loading
# Usage: oca_wait_for_response [timeout_seconds] [window]
oca_wait_for_response() {
    local timeout="${1:-30}"
    local window="${2:-main}"
    local elapsed=0

    while [ $elapsed -lt $timeout ]; do
        local status=$(oca_is_chat_loading "$window" | jq -r '.result')
        if [ "$status" = "idle" ]; then
            return 0
        fi
        sleep 0.5
        ((elapsed++))
    done
    return 1
}
