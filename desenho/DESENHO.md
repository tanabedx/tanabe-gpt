# Desenho Module Documentation

## Overview

AI-powered image generation and editing system with dual interfaces: standalone commands and integrated ChatGPT conversation capabilities.

### **Standalone Commands**
- **`#desenho`**: Direct image generation with routing logic (Public figures→GetImg.ai; others→OpenAI `gpt-5`)
- **`#desenhoedit`**: Direct image editing using OpenAI Images API (`gpt-image-1`)

### **ChatGPT Integration**
- **Natural Conversation**: Request images within normal chat using `REQUEST_IMAGE:` pattern
- **Intelligent Detection**: Automatically distinguishes between new images and modifications
- **Conversation Memory**: Remembers generated images for future reference and edits
- **Smart Enhancement**: Enhances prompts for new images, preserves raw prompts for edits

The system uses gpt-5-nano to classify public figures and intelligently handles prompt enhancement. User-facing replies are in Portuguese; code comments and documentation are in English.

## Core Features

### **Standalone Commands**
- **AI Image Generation (Routed)**: Public figure→GetImg.ai; others→OpenAI `gpt-5`
- **Selective Enhancement**: Generation uses prompt enhancement; editing uses raw input
- **Direct Image Editing**: All edits handled by OpenAI Images API (`gpt-image-1`)
- **Auto-Deletion**: Configurable automatic deletion of error messages and responses

### **ChatGPT Integration Features**
- **Conversational Interface**: Natural image requests within chat conversations
- **Intelligent Request Detection**: Automatically parses `REQUEST_IMAGE:` patterns from ChatGPT
- **Edit vs. New Detection**: Smart keyword analysis distinguishes modifications from new requests
- **Conversation Memory**: Stores up to 5 images per conversation with metadata
- **Context Awareness**: ChatGPT can reference and modify previously generated images
- **Prompt Intelligence**: Enhances prompts for new images, preserves raw prompts for edits

### **Universal Features**
- **Portuguese UX**: User-facing texts in Portuguese; code/docs in English
- **Error Handling**: Comprehensive error management with defensive fallbacks
- **Media Integration**: Delivery via WhatsApp Web.js `MessageMedia`
- **Permission System**: Integrated with existing whitelist authorization

## Usage Examples

### **Standalone Commands**

#### Basic Image Generation
```javascript
// User command
#desenho uma paisagem montanhosa ao pôr do sol

// System automatically enhances prompt and generates image
```

#### Direct Image Editing
```javascript
// User command with attached image
#desenhoedit mude a cor do céu para roxo

// System edits the attached image using raw prompt
```

### **ChatGPT Integration Examples**

#### Natural Conversation Flow
```
User: "Can you create a picture of a sunset over mountains?"
ChatGPT: "I'll create that for you. REQUEST_IMAGE: sunset over mountains"
System: [Generates enhanced image via routing logic]
ChatGPT: "I've created a beautiful sunset mountain scene for you."

User: "Make the sky more purple"
ChatGPT: "REQUEST_IMAGE: make the sky more purple"
System: [Detects edit request, uses raw prompt]
ChatGPT: "I've modified the image to have a more purple sky."
```

#### Memory and Reference
```
User: "Create a cat sitting on a chair"
ChatGPT: "REQUEST_IMAGE: orange tabby cat sitting on wooden chair"
System: [Stores in conversation memory]

User: "Now make the cat black instead"
ChatGPT: "REQUEST_IMAGE: change cat to black"
System: [Detects edit, references previous image context]
```

### Configuration Setup
```javascript
const DESENHO_CONFIG = {
    prefixes: ['#desenho'],
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 60000
    },
    model: '', // Uses default OpenAI model
    prompt: DESENHO_PROMPT
};
```

### Programmatic Usage
```javascript
const { generateImage, improvePrompt } = require('./desenhoUtils');

// Enhance user prompt
const improvedPrompt = await improvePrompt("uma casa moderna");

// Generate image
const imageBase64 = await generateImage(improvedPrompt);
```

### Image Editing
```javascript
// User command (with attached image or quoting an image)
#desenhoedit make the image more cinematic and high contrast

// The system enhances the instruction and performs the edit via OpenAI Images API
```

## Architecture Overview

### **Dual Interface Design**
The desenho module operates through two distinct interfaces sharing core generation logic:

#### **1. Standalone Commands (`#desenho`, `#desenhoedit`)**
Implements a **Two-Stage AI Pipeline Pattern**:
1. **Prompt Enhancement Stage**: Uses OpenAI to transform basic user input into detailed, optimized prompts
2. **Image Generation Stage**: Processes enhanced prompts through GetImg.ai's photorealism model

**Processing Flow**:
```
User Input → Prompt Validation → AI Enhancement → Image Generation → Media Delivery → Auto-Cleanup
```

#### **2. ChatGPT Integration**
Implements an **Intelligent Request Processing Pattern**:
1. **Request Detection**: Parses `REQUEST_IMAGE:` patterns from ChatGPT responses
2. **Edit Analysis**: Distinguishes new images from modifications using keyword detection
3. **Conditional Enhancement**: Enhances prompts for new images, preserves raw prompts for edits
4. **Memory Management**: Stores image metadata for conversation context and future reference

**Integration Flow**:
```
ChatGPT Response → Parse REQUEST_IMAGE → Edit Detection → Conditional Enhancement → 
Generation/Edit → Memory Storage → WhatsApp Delivery → Conversation Update
```

**Design Patterns**:
- **Command Handler Pattern**: Structured command processing with validation
- **Service Layer Pattern**: Separated business logic in utils modules
- **Configuration-Driven**: Centralized settings management
- **Error Boundary Pattern**: Comprehensive error handling with user feedback

## File Structure & Roles

```
desenho/
├── desenho.js              # Main command handler and orchestration
├── desenho.config.js       # Configuration settings and parameters
├── desenho.prompt.js       # AI prompt templates for enhancement
└── desenhoUtils.js         # Core utilities for image generation and prompt processing
```

### File Responsibilities

- **`desenho.js`**: Primary command handler, input validation, workflow orchestration, error management
- **`desenho.config.js`**: Command configuration, error messages, auto-deletion settings, model selection
- **`desenho.prompt.js`**: AI prompt templates for image description enhancement
- **`desenhoUtils.js`**: External API integration (GetImg.ai, OpenAI), image processing utilities

## Core Components

### Command Handler (`desenho.js`)
```javascript
async function handleDesenho(message, command, input = []) {
    // Input validation and array normalization
    const inputArray = Array.isArray(input) ? input : message.body.split(' ');
    const promptInput = inputArray.slice(1).join(' ');
    
    // Two-stage AI processing
    const improvedPrompt = await improvePrompt(promptInput);
    const imageBase64 = await generateImage(improvedPrompt);
    
    // Media delivery with error handling
    const media = new MessageMedia('image/png', imageBase64, 'generated_image.png');
    const response = await message.reply(media);
}
```

### Image Generation Service (`desenhoUtils.js`)
```javascript
async function generateImage(prompt, cfg_scale = 7) {
    const response = await axios.post('https://api.getimg.ai/v1/essential-v2/text-to-image', {
        prompt: prompt,
        style: 'photorealism',
        aspect_ratio: '1:1',
        output_format: 'png',
        cfg_scale: cfg_scale
    }, {
        headers: {
            Authorization: `Bearer ${config.CREDENTIALS.GETIMG_AI_API_KEY}`
        }
    });
}
```

### Image Editing Service (`desenhoUtils.js`)
```javascript
async function editImageWithOpenAI(imageBase64, prompt, options) {
  // Uses OpenAI Images API (gpt-image-1) to edit an image
}
```

### Prompt Enhancement Service
```javascript
async function improvePrompt(prompt) {
    const promptTemplate = DESENHO.IMPROVE_PROMPT.replace('{prompt}', prompt);
    return await runCompletion(promptTemplate, 0.7);
}
```

## Data Flows

### Standard Image Generation Flow
```mermaid
graph TD
    A["User Input: #desenho [description]"] --> B["Input Validation"]
    B --> C["Extract Prompt Text"]
    C --> D["OpenAI Prompt Enhancement"]
    D --> E["GetImg.ai Image Generation"]
    E --> F["Base64 Image Data"]
    F --> G["WhatsApp MessageMedia Creation"]
    G --> H["Image Delivery to User"]
    H --> I["Auto-Delete Management"]
    
    B --> J["Validation Error"] --> K["Error Message + Auto-Delete"]
    D --> L["Enhancement Error"] --> M["Fallback to Original Prompt"]
    E --> N["Generation Error"] --> O["Error Message + Auto-Delete"]
```

### Error Handling Flow
```mermaid
graph TD
    A["Error Detected"] --> B["Error Type Classification"]
    B --> C["Missing Prompt"] --> D["Send Portuguese Error Message"]
    B --> E["API Error"] --> F["Log Error Details"]
    B --> G["Generation Failure"] --> H["Send Generation Error Message"]
    
    D --> I["Auto-Delete Error Message"]
    F --> J["Send Generic Error Message"] --> I
    H --> I
    
    I --> K["Cleanup Complete"]
```

### Image Editing Flow
```mermaid
graph TD
    A["Input: #desenhoedit + image + instruction"] --> B["Validate instruction and image"]
    B --> C["Instruction enhancement (OpenAI)"]
    C --> D["OpenAI Images API (gpt-image-1) edit"]
    D --> E{"Image produced?"}
    E -- No --> F["Error message + Auto-Delete"]
    E -- Yes --> G["Base64 edited image"]
    G --> H["WhatsApp MessageMedia"]
    H --> I["Deliver to user + Auto-Delete"]
```

## Configuration Schema

### Main Configuration (`desenho.config.js`)
```javascript
{
    prefixes: ["#desenho"],                    // Command triggers
    description: "string",                     // Command description
    autoDelete: {
        errorMessages: boolean,                // Auto-delete error messages
        commandMessages: boolean,              // Auto-delete command responses
        deleteTimeout: number                  // Deletion delay in milliseconds
    },
    errorMessages: {
        noPrompt: "string",                   // Missing prompt error (Portuguese)
        generateError: "string",              // Generation failure error
        notAllowed: "string"                  // Permission denied error
    },
    useGroupPersonality: boolean,             // Group context usage
    model: "string",                          // OpenAI model selection
    prompt: "object"                          // Prompt templates
}
```

### Edit Configuration (`desenho.config.js`)
```javascript
{
    prefixes: ["#desenhoedit"],               // Disparo do comando de edição
    description: "string",
    autoDelete: { errorMessages: boolean, commandMessages: boolean, deleteTimeout: number },
    errorMessages: {
        noImage: "string",                    // Missing image
        noInstruction: "string",              // Missing instruction
        editError: "string",                  // Edit failure
        notAllowed: "string"                  // Permission denied
    },
    useGroupPersonality: boolean,
    model: "string",
    prompt: "object"
}
```

### Prompt Configuration (`desenho.prompt.js`)
```javascript
{
    IMPROVE_PROMPT: "string"                  // Template for prompt enhancement
}
```

### API Configuration Requirements
```javascript
// Required environment variables
GETIMG_AI_API_KEY                           // GetImg.ai API access token
OPENAI_API_KEY                              // OpenAI API access (via configs)
```

## External Dependencies

### GetImg.ai Integration
- **Service**: Essential V2 Text-to-Image for public figure requests
- **Endpoint**: `https://api.getimg.ai/v1/essential-v2/text-to-image`
- **Authentication**: Bearer token via API key
- **Output**: Base64 PNG (or `image_url` → fetched and converted)

### OpenAI Images Integration
- **Service**: `gpt-image-1` for non-public figure generation and all edits
- **Endpoints**: Images Generate and Images Edits
- **Output**: Base64 PNG

### OpenAI Integration
- **Service**: Completion API for prompt enhancement
- **Model**: Configurable (defaults to system default)
- **Temperature**: 0.7 for creative prompt generation
- **Purpose**: Transform basic descriptions into detailed image prompts

### WhatsApp Web.js Integration
- **MessageMedia**: Image delivery mechanism
- **Format**: PNG with base64 encoding
- **Filename**: `generated_image.png`

## Internal Dependencies

### Core System Dependencies
```javascript
// Message handling and auto-deletion
const { handleAutoDelete } = require('../utils/messageUtils');

// WhatsApp media handling
const { MessageMedia } = require('whatsapp-web.js');

// Logging system
const logger = require('../utils/logger');

// OpenAI completion utilities
const { runCompletion } = require('../utils/openaiUtils');

// System configuration access
const config = require('../configs');
```

### Cross-Module Relationships
- **Configuration System**: API key management and model selection
- **Logging System**: Debug and error tracking across generation pipeline
- **Message Utilities**: Auto-deletion and response management
- **OpenAI Utilities**: Shared completion infrastructure for prompt enhancement
- **Command System**: Integration with core command handler and registry

### Data Sharing Patterns
- **Credential Management**: Centralized API key access via configs module
- **Error Handling**: Standardized error messages and auto-deletion patterns
- **Logging Integration**: Consistent debug/error reporting across AI pipeline stages
- **Model Configuration**: Shared OpenAI model selection and parameter management

## ChatGPT Integration

### **Integration Architecture**

#### **File Structure**
```
chat/

├── chat.js                   # Main conversation processing
├── conversationManager.js    # Memory and state management
├── chat.config.js           # Configuration settings
└── chatgpt.prompt.js        # AI instructions
```

#### **Request Processing Flow**
```mermaid
graph TD
    A["ChatGPT conversation"] --> B["Vision analysis only (no generation)"]
    B --> C["detectImageEditRequest()"]
    C --> D{Is Edit?}
    
    D -->|Yes| E["Raw prompt + Memory check"]
    D -->|No| F["classifyPublicFigureRequest()"]
    
    F --> G{Public Figure?}
    G -->|Yes| H["GetImg.ai + improvePrompt()"]
    G -->|No| I["OpenAI gpt-5 + improvePrompt()"]
    
    E --> J["OpenAI Images API"]
    H --> K["Store in conversation.imageMemory"]
    I --> K
    J --> K
    
    K --> L["WhatsApp MessageMedia delivery"]
    L --> M["Update conversation context"]
```

### **Conversation Memory Structure**
```javascript
conversationState = {
    messages: [...],
    imageMemory: [
        {
            id: "img_1234567890_abc123",
            originalPrompt: "create a sunset",
            enhancedPrompt: "photorealistic sunset over mountains...",
            generationMethod: "openai|getimg|openai-edit-fallback",
            timestamp: "2024-08-11T20:18:00Z",
            description: "Generated image: sunset over mountains",
            isEdit: false,
            referencedInConversation: true
        }
    ]
}
```

### **Edit Detection Logic**
The system uses intelligent keyword analysis to distinguish between new image requests and modifications:

#### **Edit Keywords**
```javascript
editKeywords = [
    'mude', 'mudança', 'altere', 'alteração', 'modifique', 'modificação',
    'change', 'alter', 'modify', 'edit', 'update',
    'mais', 'menos', 'maior', 'menor', 'different', 'diferente',
    'outro', 'outra', 'other', 'another',
    'cor', 'color', 'style', 'estilo', 'make it', 'faça'
]
```

#### **Reference Keywords**
```javascript
referenceKeywords = [
    'anterior', 'previous', 'last', 'última', 'último',
    'essa', 'esta', 'this', 'that', 'aquela',
    'mesma', 'mesmo', 'same', 'similar'
]
```

### **Configuration Settings** 
```javascript
// chat.config.js
imageGeneration: {
    enabled: true,                      // Master toggle
    maxImageRequests: 3,                // Per conversation turn
    timeout: 30000,                     // Generation timeout (ms)
    conversationMemory: {
        enabled: true,                  // Remember images
        maxImages: 5,                   // Per conversation
        includeInPrompt: true           // Add to system prompts
    },
    useExistingRouting: true,           // Use desenho routing logic
    defaultModel: 'gpt-5'               // High-tier model for conversations
}
```

### **AI Instructions Integration**
The system extends ChatGPT's capabilities through structured prompts:

```javascript
// Added to chatgpt.prompt.js
COMO GERAR IMAGENS:
Quando o usuário solicitar uma imagem, use: REQUEST_IMAGE: [descrição detalhada]

PARA NOVAS IMAGENS:
- REQUEST_IMAGE: um gato laranja sentado em uma cadeira de madeira

PARA MODIFICAÇÕES DE IMAGENS ANTERIORES:  
- REQUEST_IMAGE: mude a cor do gato para preto
- REQUEST_IMAGE: adicione um arco-íris na paisagem

REGRAS PARA GERAÇÃO DE IMAGENS:
- Para NOVAS imagens: use descrições detalhadas e criativas
- Para MODIFICAÇÕES: use instruções simples e diretas
- O sistema detecta automaticamente se é nova imagem ou modificação
```

### **Error Handling and Recovery**
- **Generation Failures**: Graceful degradation with user feedback
- **Memory Limits**: Automatic cleanup of oldest images when limit exceeded
- **Edit Without Context**: Falls back to new image generation when no previous images exist
- **Invalid Requests**: Comprehensive validation with Portuguese error messages

### **Future Enhancements**
- **OpenAI createVariation API**: Planned implementation for true image variations
- **Advanced Memory**: Persistent image storage across conversation sessions
- **Multi-Image Operations**: Batch generation and editing capabilities 