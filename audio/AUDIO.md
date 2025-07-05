# Audio System Documentation

## Overview
Audio transcription system for WhatsApp bot providing automatic speech-to-text conversion using OpenAI's Whisper model. Handles voice messages and audio files with temporary file management and formatted response delivery.

## Core Features
- **Speech-to-Text Conversion**: OpenAI Whisper integration for high-quality Portuguese audio transcription
- **Multi-Source Audio Support**: Direct audio messages and quoted audio message processing
- **Temporary File Management**: Secure audio file download, processing, and automatic cleanup
- **Format Validation**: Audio format verification and error handling for unsupported media types
- **Streaming Responses**: Simulated typing effect for transcription delivery with robot face placeholder

## Usage Examples
```javascript
// Direct audio transcription
#audio                    // Transcribe attached audio message

// Quoted message transcription  
#audio                    // Reply to any message quoting an audio message
// Bot will transcribe the quoted audio automatically

// Supported formats
// - WhatsApp voice messages (ptt)
// - Audio files (audio)
// - OGG format processing
```

## Architecture Overview

### Core Design Pattern
Command-driven audio processing pipeline with temporary file management, external API integration, and automatic resource cleanup. Uses streaming file operations for efficient memory usage and error-resilient processing.

### Processing Flow
1. **Audio Detection** → `audio.js` (message type validation and source identification)
2. **Media Download** → WhatsApp media API (base64 data retrieval)
3. **File Management** → Temporary file creation with unique naming
4. **Transcription** → OpenAI Whisper API integration
5. **Streaming Response** → Simulated typing effect for transcription delivery
6. **Auto-Delete** → Automatic response cleanup after timeout
7. **Cleanup** → Automatic temporary file removal

## File Structure & Roles

### Core Processing Files
- **`audio.js`**: Main command handler, message routing, media download, file management
- **`audioUtils.js`**: OpenAI Whisper integration, transcription processing, error handling
- **`audio.config.js`**: Command configuration, error messages, auto-delete settings

### Processing Components
- **Message Validation**: Audio format detection and quoted message handling
- **Media Management**: Temporary file operations with secure cleanup
- **API Integration**: OpenAI Whisper model interaction with streaming support

## Core Components

### Audio Message Detection (`audio.js`)
```javascript
// Multi-source audio detection
audioDetection = {
    directMessage: {
        mediaCheck: message.hasMedia,
        typeValidation: ['audio', 'ptt'].includes(message.type)
    },
    quotedMessage: {
        quotedCheck: message.hasQuotedMsg,
        quotedMediaValidation: quotedMsg.hasMedia && ['audio', 'ptt'].includes(quotedMsg.type)
    }
}
```

### File Management System (`audio.js`)
```javascript
// Temporary file handling
fileManagement = {
    naming: {
        randomBytes: crypto.randomBytes(16).toString('hex'),
        extension: '.ogg',
        location: path.join(__dirname, '..', `${randomName}.ogg`)
    },
    operations: {
        download: media.data,                    // Base64 audio data
        conversion: Buffer.from(media.data, 'base64'),
        storage: fs.writeFileSync(audioPath, buffer),
        cleanup: fs.unlinkSync(audioPath)        // Automatic removal
    }
}
```

### Transcription Integration (`audioUtils.js`)
```javascript
// OpenAI Whisper API integration
transcriptionProcess = {
    modelConfiguration: {
        model: 'whisper-1',                     // OpenAI Whisper model
        language: 'pt',                         // Portuguese language setting
        fileStream: fs.createReadStream(audioPath)
    },
    apiCall: {
        endpoint: openai.audio.transcriptions.create(),
        parameters: { file, model, language },
        response: transcription.text
    }
}
```

### Configuration Schema (`audio.config.js`)
```javascript
AUDIO_CONFIG = {
    prefixes: ['#audio'],                       // Command triggers
    description: string,                        // Command description
    autoDelete: {
        errorMessages: boolean,                 // Auto-delete error responses
        commandMessages: boolean,               // Auto-delete command messages
        deleteTimeout: number                   // Deletion delay (ms)
    },
    errorMessages: {
        transcriptionError: string,             // Transcription failure message
        downloadError: string,                  // Media download failure message
        invalidFormat: string,                  // Unsupported format message
        notAllowed: string                      // Permission denied message
    },
    useGroupPersonality: boolean,               // Group-specific behavior
    model: string                              // Model specification (empty for Whisper)
}
```

## Data Flows

### Standard Audio Transcription Flow
```
WhatsApp Audio Message → audio.js (validation) → Media Download → 
  ↓ (temporary file creation)
File System Write → audioUtils.js (Whisper API) → Transcription Response → 
  ↓ (streaming response with 🤖 placeholder)
Streaming Response → Auto-Delete → File Cleanup
```

### Quoted Message Processing Flow
```
WhatsApp Message with Quote → audio.js (quote detection) → Quoted Message Analysis →
  ↓ (if quoted message is audio)
Quote Audio Extraction → Standard Transcription Flow
```

### Error Handling Flow
```
Processing Error → Error Classification → Appropriate Error Message →
  ↓ (auto-delete enabled)
Error Response with Auto-Delete → File Cleanup (if applicable)
```

### File Management Flow
```
Audio Detection → Temporary File Creation (random name) → Media Data Write →
  ↓ (processing complete/error)
File Existence Check → File Deletion → Cleanup Confirmation
```

## Configuration Schema

### Command Configuration
```javascript
AUDIO_CONFIG = {
    prefixes: string[],                         // Command trigger prefixes
    description: string,                        // Help text
    autoDelete: {
        errorMessages: boolean,                 // Auto-delete error messages
        commandMessages: boolean,               // Auto-delete command triggers
        deleteTimeout: number                   // Delay before deletion (ms)
    },
    errorMessages: {
        transcriptionError: string,             // Whisper API failure
        downloadError: string,                  // Media download failure
        invalidFormat: string,                  // Unsupported audio format
        notAllowed: string                      // Permission denied
    },
    useGroupPersonality: boolean,               // Group-specific customization
    model: string                              // Model specification
}
```

### File Management Configuration
```javascript
fileConfig = {
    temporaryDirectory: '../',                  // Relative to audio folder
    fileNaming: 'crypto.randomBytes(16).toString("hex")',
    supportedFormats: ['audio', 'ptt'],        // WhatsApp audio types
    outputFormat: '.ogg',                      // Temporary file extension
    autoCleanup: true                          // Automatic file removal
}
```

## External Dependencies

### OpenAI API Integration
- **Model**: `whisper-1` for speech-to-text conversion
- **Language**: Portuguese (`pt`) language specification for improved accuracy
- **Input Format**: Audio file streams via `fs.createReadStream()`
- **Output**: Plain text transcription with confidence-based processing

### WhatsApp Media API
- **`message.downloadMedia()`**: Base64 encoded audio data retrieval
- **`message.hasMedia`**: Media presence validation
- **`message.type`**: Message type classification (`audio`, `ptt`)
- **`message.hasQuotedMsg`**: Quoted message detection for extended functionality

### File System Operations
- **`fs.writeFileSync()`**: Temporary audio file creation from base64 data
- **`fs.createReadStream()`**: Streaming file access for API upload
- **`fs.existsSync()`**: File existence validation for cleanup
- **`fs.unlinkSync()`**: Secure temporary file removal

### Node.js Core Modules
- **`crypto`**: Secure random filename generation to prevent conflicts
- **`path`**: Cross-platform path handling for temporary file placement

## Internal Dependencies

### Utility Dependencies
- **`../utils/logger`**: Centralized logging for debugging and monitoring audio processing
- **`../utils/messageUtils`**: Auto-delete functionality for responses and error messages
- **`../utils/openaiUtils`**: OpenAI client configuration and authentication management

### Configuration Dependencies
- **Command Integration**: Uses standard command configuration pattern for consistency
- **Auto-Delete System**: Integrates with bot-wide message lifecycle management
- **Error Handling**: Follows established error message formatting and delivery patterns

### Cross-Module Dependencies
- **`audio.js`** ← imports ← `audioUtils.js`, utility modules
- **`audioUtils.js`** ← imports ← `../utils/openaiUtils`, `../utils/logger`
- **Configuration Integration**: Follows bot-wide configuration patterns for consistency

### Data Sharing Patterns
- **Temporary File Management**: Isolated file operations with guaranteed cleanup
- **Error Message Standardization**: Consistent error handling across audio processing stages
- **Logging Integration**: Unified logging for audio processing debugging and monitoring
- **Auto-Delete Coordination**: Integration with bot-wide message lifecycle management 