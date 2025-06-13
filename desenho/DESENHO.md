# Desenho Module Documentation

## Overview

AI-powered image generation system that creates high-quality images from text descriptions. The system automatically enhances user prompts using OpenAI's language models and generates images via GetImg.ai's Essential V2 API. Features Portuguese language interface with automatic prompt optimization and error handling.

## Core Features

- **AI Image Generation**: Creates photorealistic images from text descriptions using GetImg.ai API
- **Prompt Enhancement**: Automatically improves user prompts using OpenAI for better image quality
- **Portuguese Interface**: User-friendly Portuguese language commands and error messages
- **Auto-Deletion**: Configurable automatic deletion of error messages and responses
- **Error Handling**: Comprehensive error management with fallback mechanisms
- **Media Integration**: Direct image delivery through WhatsApp Web.js MessageMedia

## Usage Examples

### Basic Image Generation
```javascript
// User command
#desenho uma paisagem montanhosa ao pôr do sol

// System automatically enhances prompt and generates image
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

## Architecture Overview

The desenho module implements a **Two-Stage AI Pipeline Pattern**:

1. **Prompt Enhancement Stage**: Uses OpenAI to transform basic user input into detailed, optimized prompts
2. **Image Generation Stage**: Processes enhanced prompts through GetImg.ai's photorealism model

**Processing Flow**:
```
User Input → Prompt Validation → AI Enhancement → Image Generation → Media Delivery → Auto-Cleanup
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
- **Service**: Essential V2 Text-to-Image API
- **Endpoint**: `https://api.getimg.ai/v1/essential-v2/text-to-image`
- **Authentication**: Bearer token via API key
- **Output**: Base64-encoded PNG images
- **Configuration**: Photorealism style, 1:1 aspect ratio, CFG scale 7

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