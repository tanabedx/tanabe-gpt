# Chat System Documentation

## Overview
Complete ChatGPT integration system for WhatsApp bot providing intelligent conversation management with memory, context fetching from message history, automatic/manual web search capabilities, and native image analysis.

## Core Features
- **Conversation Management**: Persistent conversations with memory across messages, automatic model selection based on context size
- **Initial Chat Context**: Automatically injects the last N messages from the chat history into the initial prompt for immediate context awareness.
- **Context System**: On-demand WhatsApp message history fetching when ChatGPT requests context
- **Web Search Integration**: Automatic search with content extraction when relevant
- **Image Analysis**: Native GPT-5 image analysis for visual content understanding and text extraction
- **Multi-Model Support**: Dynamic GPT model selection based on centralized tiers (LOW/MEDIUM/HIGH) and search requirements
  - Reasoning effort is automatically applied for MEDIUM (low) and HIGH (medium) tiers with a safe fallback retry if unsupported.

## Usage Examples
```
#pergunta sobre programação                    # Basic chat
#!conte uma piada                             # Humor mode  
#qual foi a primeira mensagem do João hoje?   # Context-aware (triggers context fetch)
#pesquise informações atuais sobre ChatGPT    # Automatic web search
# Image creation and editing (use dedicated commands):
#desenho um gato sentado                      # Create images with #desenho command
#desenhoedit mude a cor para preto            # Edit images with #desenhoedit command

# Multi-modal attachment processing and analysis
[Send image] #descreva essa imagem            # Direct GPT-5 image analysis
[Quote message with image] #descreva essa imagem  # Quoted message image analysis
[Send voice note] #transcreva esse áudio     # Audio transcription with Whisper
[Send PDF] #resuma este documento            # Document analysis using resumo functionality
[Send multiple attachments] #analise tudo    # Multi-modal analysis (images + docs + audio)
```

## Architecture Overview

### Core Design Pattern
Event-driven message processing pipeline with modular handlers for different request types (context, search, images, conversation). Uses centralized configuration for behavior control and persistent conversation state management.

### Processing Flow
1. **Message Reception** → `chat.js` (command detection + routing)
2. **Conversation Initialization** → `conversationManager.js` fetches the last N messages from the chat and constructs the initial system prompt, including chat history and personality.
3. **Request Type Detection** → Parallel handlers for context/search/image requests
4. **Content Processing** → AI model selection and API calls, image generation when requested
5. **Response Delivery** → Sends an initial placeholder message (e.g., '🤖') and then uses an ultra-fast streaming effect to "type out" the final response with 25ms intervals and 50-100 character chunks for almost live typing experience.

## File Structure & Roles

### Core Processing Files
- **`chat.js`**: Main command processor, message routing, WhatsApp integration
- **`conversationManager.js`**: Conversation state management, initial history fetching, OpenAI API calls, model selection logic
- **`contextManager.js`**: On-demand and initial WhatsApp message history fetching, chunk-based context loading
- **`promptUtils.js`**: Message formatting, system prompt construction, conversation serialization

### Request Handler Files  
- **`contextRequestHandler.js`**: Parses `REQUEST_CONTEXT: [details]` from AI responses, manages context limits

- **`attachmentHandler.js`**: Processes multi-modal attachments (images, documents, audio) for ChatGPT analysis
- **`webSearchUtils.js`**: DuckDuckGo/Google search execution, content scraping, result formatting

### Configuration Files
- **`chat.config.js`**: Model selection rules, web search settings, context management limits, conversation settings
- **`chatgpt.prompt.js`**: System prompts, conversation templates, personality definitions

## Core Components

### Conversation Management (`conversationManager.js`)
```javascript
// On conversation initialization, the system can fetch recent history
initialHistory: {
    enabled: true,
    messageCount: 10 // Fetches the last 10 messages
}

// Central conversation state with automatic cleanup
conversationState = {
    groupId: { 
        messages: [
            // The first message is a detailed system prompt including:
            // 1. Base instructions
            // 2. Group-specific personality
            // 3. Recent chat history (e.g., last 10 messages)
            // 4. Image memory context (when available)
            { role: 'system', content: '...' } 
        ],
        lastActivity: timestamp,
        currentModel: config.SYSTEM.AI_MODELS.MEDIUM,
        imageMemory: [
            // Generated images with metadata for conversation reference
            {
                id: 'img_1234567890_abc123',
                originalPrompt: 'create a sunset',
                enhancedPrompt: 'photorealistic sunset...',
                generationMethod: 'openai|getimg|edit',
                timestamp: '2024-08-11T20:18:00Z',
                description: 'Generated image: sunset',
                isEdit: false
            }
        ]
    }
}
```

### Context System (`contextManager.js` + `contextRequestHandler.js`)
```javascript
// Context request detection and processing
contextRequest = {
    chunkSize: 100,                      // Messages per chunk
    maxTotalChatHistoryMessages: 1000,   // Hard limit
    maxContextRequests: 10               // Per conversation turn
}

// WhatsApp history fetching with message formatting
fetchContext(groupName, messageCount) → {
    messages: [...],     // Formatted WhatsApp messages
    totalFetched: number // Actual count retrieved
}
```

### Web Search System (`webSearchUtils.js`)
```javascript
// Automatic web search configuration
webSearch: {
    // Automatic web search using OpenAI web_search tool
    useOpenAITool: true,
    toolChoice: 'auto', // 'auto' | 'required'
    country: 'br',
    locale: 'pt_BR',
    enforceCitations: true,
    maxResults: 5,
    timeout: 10000
}

// Search execution flow
searchExecution: DuckDuckGo → Google(fallback) → ContentScraping → ModelProcessing → ContextInjection
```

### Image Analysis System (Vision-Only)
```javascript
// Image analysis capabilities (no generation)
imageAnalysis = {
    nativeSupport: true,                  // GPT-5 native multi-modal support
    capabilities: [
        'Visual content description',     // Describe what's in images
        'Text extraction (OCR)',          // Extract text from images
        'Scene understanding',            // Understand image context
        'Multi-image analysis'            // Analyze multiple images together
    ]
}

// Image creation/editing routing (external commands)
imageCommands: {
    creation: '#desenho [description] → desenho/desenho.js',
    editing: '#desenhoedit [instructions] → desenho/desenho.js'
}

// GPT-5 Multi-Modal Integration
multiModalProcessing: {
    inputFormat: 'input_text + input_image content arrays',
    directAnalysis: 'No separate Vision API calls needed',
    quotedMessageSupport: 'Processes images from main and quoted messages'
}
```

### Attachment Processing System (`attachmentHandler.js`)
```javascript
// Multi-modal attachment processing for ChatGPT
attachmentProcessing = {
    supportedTypes: {
        images: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
        documents: ['application/pdf', 'application/msword', 'text/plain', 'application/rtf'],
        audio: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/opus', 'audio/m4a', 'audio/mp4', 'audio/aac', 'audio/webm']
    },
    processing: {
        images: 'Direct GPT-5 integration (native multi-modal support)',
        documents: 'Resumo module (pdf-parse + docx extraction)', 
        audio: 'OpenAI Whisper (speech-to-text with enhanced format support)'
    },
    specialFeatures: {
        quotedMessages: 'Processes attachments from both main and quoted messages',
        audioFormat: 'Smart WhatsApp OGG format detection with fallback',
        imageIntegration: 'GPT-5 native image analysis without separate Vision API calls',
        cleanup: 'Automatic temporary file cleanup for all attachment types'
    }
}

// Attachment processing workflow (supports main message + quoted message attachments)
processAttachments(message, config) → {
    hasAttachments: boolean,              // Whether message has processable attachments
    images: [ImageResult],                // Processed image data
    pdfs: [DocumentResult],               // Processed document data  
    audio: [AudioResult],                 // Processed audio data
    textContent: string,                  // Combined extracted text content (with "[Da mensagem citada]:" prefix for quoted)
    summary: string                       // Human-readable summary of attachments
}

// Individual processor results
ImageResult = {
    textContent: string,                  // Placeholder text (GPT-5 analyzes directly)
    description: string,                  // Placeholder description
    imageData: string,                    // Base64 data (passed directly to GPT-5)
    mimeType: string,                     // Original MIME type for GPT-5 formatting
    processed: boolean                    // Always true for images
}

DocumentResult = {
    textContent: string,                  // Full document text (uses resumo functionality)
    filename: string,                     // Original filename
    processed: boolean                    // Processing success status
}

AudioResult = {
    transcription: string,                // Speech-to-text transcription (Portuguese optimized)
    filename: string,                     // Original filename
    mimeType: string,                     // Original audio format
    processed: boolean                    // Processing success status
}

// Context integration
createAttachmentContext(attachmentData) → string  // Formatted for ChatGPT prompts

// Reuses existing infrastructure
infrastructure: {
    documents: 'resumos/documentUtils.js (pdf-parse, docx extraction)',
    images: 'Direct GPT-5 multi-modal API (input_text + input_image format)',
    audio: 'OpenAI Whisper API (enhanced MIME type mapping, automatic cleanup)',
    integration: 'chat/promptUtils.js (context formatting)',
    conversation: 'conversationManager.js (addUserMessageWithImages for multi-modal)',
    cleanup: 'desenho/desenhoUtils.js (cleanupTempFiles utility)'
}
```

## Data Flows

### Standard Chat Flow
```
WhatsApp Message → chat.js → conversationManager.js (fetches initial history) → OpenAI API → Ultra-Fast Streaming (25ms intervals) → WhatsApp
```

### Context-Aware Chat Flow  
```
WhatsApp Message → chat.js → conversationManager.js → OpenAI API → 
  ↓ (AI returns REQUEST_CONTEXT)
contextRequestHandler.js → contextManager.js → WhatsApp History Fetch →
  ↓ (context injected)
conversationManager.js → OpenAI API → Response with Context → Ultra-Fast Streaming → WhatsApp
```

### Web Search Flow
```
WhatsApp Message → conversationManager.js → OpenAI API (with web_search tool) → 
  ↓ (automatic search when relevant)
Search APIs → Content Scraping → Response with Search Data → Ultra-Fast Streaming → WhatsApp
```

### Image Analysis Flow  
```
WhatsApp Message with Image → chat.js → attachmentHandler.js →
  ↓ (detect image attachments from main + quoted messages)
processAttachments() → Store Image Data →
  ↓ (create GPT-5 multi-modal input: input_text + input_image)
conversationManager.js → addUserMessageWithImages() → OpenAI API (GPT-5 Multi-Modal) →
  ↓ (native image analysis and understanding)
ChatGPT Response with Image Analysis → Ultra-Fast Streaming → WhatsApp

Image Creation/Editing Flow (External Commands):
WhatsApp Message → #desenho OR #desenhoedit → desenho/desenho.js → API Routing → Image Generation
```

### Attachment Processing Flow
```
WhatsApp Message with Attachment OR Quoted Message with Attachment → chat.js → attachmentHandler.js →
  ↓ (auto-detection based on MIME type from main message AND quoted message)
processAttachments() → Route by Type →
  ↓ (images: direct storage | documents: resumos/documentUtils | audio: Whisper with format enhancement)
Content Processing → Context Integration →
  ↓ (images: direct GPT-5 input | documents/audio: text extraction with "[Da mensagem citada]:" prefix)
conversationManager.js → Multi-Modal Message Assembly →
  ↓ (text messages OR input_text + input_image arrays for GPT-5)
OpenAI API (GPT-5 Multi-Modal OR Standard Chat) → Intelligent Response with Native Attachment Understanding
```

## Multi-Modal GPT-5 Integration

### Direct Image Analysis (`conversationManager.js`)
The system now supports native GPT-5 multi-modal capabilities, allowing direct image analysis without separate Vision API calls.

```javascript
// GPT-5 Message Format for Images
multiModalMessage = {
    role: 'user',
    content: [
        {
            type: "input_text",
            text: "[12/08/25, 22:08] Daniel pergunta: descreva essa imagem\n\n📎 ANEXOS PROCESSADOS:\nAnexos processados: 1 imagem(ns)\n\n[Imagem será analisada diretamente pelo ChatGPT]"
        },
        {
            type: "input_image", 
            image_url: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD..."
        }
    ]
}

// Standard Text-Only Message
textOnlyMessage = {
    role: 'user',
    content: "Standard text message content"
}
```

### Image Processing Workflow
```javascript
// Smart routing between text-only and multi-modal conversations
chatProcessing: {
    detectImages: 'Scan main message + quoted messages for image attachments',
    routeByType: {
        hasImages: 'conversationManager.addUserMessageWithImages() → GPT-5 multi-modal',
        textOnly: 'conversationManager.addUserMessage() → Standard chat API'
    },
    formatGPT5: {
        textContent: 'input_text type with full message context',
        imageContent: 'input_image type with data URI (data:mimeType;base64,data)',
        preservation: 'Maintains original image quality and format information'
    }
}
```

### Enhanced Audio Processing
```javascript
// WhatsApp Audio Support with Enhanced Format Detection
audioProcessing = {
    formatDetection: {
        primary: 'Smart MIME type mapping with WhatsApp OGG preference',
        fallback: 'Default to .ogg extension for unknown formats',
        supportedTypes: [
            'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 
            'audio/ogg; codecs=opus', 'audio/opus', 'audio/m4a', 
            'audio/mp4', 'audio/aac', 'audio/webm', 'audio/x-wav'
        ]
    },
    transcription: {
        api: 'OpenAI Whisper',
        language: 'pt (Portuguese optimized)',
        responseFormat: 'text',
        integration: 'Automatic injection into ChatGPT context'
    },
    cleanup: {
        temporaryFiles: 'Automatic deletion of temp audio files',
        errorHandling: 'Graceful cleanup even on processing failures'
    }
}
```

### Quoted Message Support
```javascript
// Enhanced attachment processing for quoted messages
quotedMessageSupport = {
    detection: 'Processes attachments from both main message AND quoted messages',
    merging: {
        images: 'Combines image arrays from both sources',
        documents: 'Merges document content with [Da mensagem citada] prefix',
        audio: 'Processes audio from quoted messages with source labeling'
    },
    contextIntegration: 'Seamless integration into ChatGPT conversation context'
}
```

## Configuration Schema

### Conversation Configuration (`chat.config.js`)
```javascript
conversation: {
    maxTurns: number,           // Maximum conversation turns before reset
    timeoutMinutes: number,     // Conversation timeout
    maintainMemory: boolean,
    initialHistory: {
        enabled: boolean,       // Toggle for initial history feature
        messageCount: number    // Number of messages to fetch
    }
}
```

### Model Selection Rules (`chat.config.js`)
```javascript
modelSelection: {
    rules: [
        { maxMessages: number, model: string }  // Size-based model selection
    ],
    default: string                            // Fallback model
}
```

### Web Search Configuration
```javascript
webSearch: {
    enabled: boolean,                    // Master toggle
    model: string,                      // Model for processing web results
    maxResults: number,                 // Search results to process
    timeout: number                     // Request timeout (ms)
}
```

### Context Management Configuration
```javascript
contextManagement: {
    chunkSize: number,                      // Messages per context request
    maxTotalChatHistoryMessages: number,    // Total message limit
    maxContextRequests: number,             // Max requests per conversation
    enabled: boolean                        // Context system toggle
}
```

### Image Analysis Configuration  
```javascript
imageAnalysis: {
    enabled: true,                          // Image analysis always enabled
    nativeSupport: true,                    // Uses GPT-5 native multi-modal capabilities
    multiModalModel: string,                // Model used for image analysis conversations
    quotedMessageSupport: true,             // Process images from quoted messages
    directProcessing: true                  // No separate Vision API calls needed
}

// Note: Image generation is handled by separate #desenho and #desenhoedit commands
```

## External Dependencies

### WhatsApp Integration
- **`global.client`**: WhatsApp Web.js client instance for message sending/receiving
- **`chat.getMessages()`**: Message history fetching for context system
- **`message.reply()`**: Used to send the initial response message.
- **`sendStreamingResponse()`**: Ultra-fast streaming utility with 25ms intervals and 50-100 character chunks for almost live typing effect.

### OpenAI API Integration
- **Models Used**: Selected via centralized tiers `config.SYSTEM.AI_MODELS` (LOW/MEDIUM/HIGH), with module overrides as needed
- **API Endpoints**: Chat completions for all conversational AI processing
- **Token Management**: Automatic model switching based on context size to optimize costs

### Web Search APIs
- **DuckDuckGo**: Primary search engine via duckduckgo-search npm package
- **Google**: Fallback search engine for redundancy
- **Cheerio**: HTML parsing for content extraction from search results

## Internal Dependencies

### Configuration Dependencies
- **`../configs`**: Core bot configuration access
- **`../utils/logger`**: Centralized logging system for debugging and monitoring

### Cross-Module Dependencies  
- **`conversationManager.js`** ← imports ← `contextRequestHandler.js`, `attachmentHandler.js`, `promptUtils.js`
  - **NEW**: `addUserMessageWithImages()` function for GPT-5 multi-modal support
- **`contextManager.js`** ← imports ← `contextRequestHandler.js`, `conversationManager.js`
- **`webSearchUtils.js`** ← imports ← `conversationManager.js`

- **`attachmentHandler.js`** ← imports ← `resumos/documentUtils.js`, `utils/openaiUtils.js`, WhatsApp `MessageMedia`
  - **NEW**: Enhanced audio format mapping, automatic temp file cleanup
- **`chat.js`** ← imports ← `attachmentHandler.js` (processAttachments, createAttachmentContext, generateAttachmentSummary)
  - **NEW**: Multi-modal message routing based on attachment detection
- **`desenho/desenhoUtils.js`** ← provides ← `cleanupTempFiles()` utility for system-wide temp file management
- **`chat.config.js`** ← imports ← All processing modules for behavior configuration

### Data Sharing Patterns
- **Conversation State**: Centralized in `conversationManager.js`, accessed by all handlers
- **Image Analysis**: Direct GPT-5 processing without separate memory management
- **Attachment Processing**: Reuses existing resumo infrastructure for document processing
  - **NEW**: Direct GPT-5 integration for images, enhanced audio processing
- **Multi-Modal Support**: GPT-5 native image analysis with `input_text` + `input_image` format
- **Quoted Message Processing**: Seamless attachment detection from both main and quoted messages
- **Configuration**: Single source of truth in `chat.config.js`, imported by processing modules
- **Request Parsing**: Shared regex patterns and limits across context/search/image handlers
- **WhatsApp Integration**: Shared client instance and message formatting utilities
- **Media Delivery**: Consistent `MessageMedia` creation for images and other media types
- **Temporary File Management**: System-wide cleanup utilities for all attachment types