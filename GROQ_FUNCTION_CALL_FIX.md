# Groq Function Call Error Fix

## Problem
Random `APIError: 400 Failed to call a function` errors occurring during chat streaming with error message:
```
failed_generation: '<function=get_university_recommendations>{"reason": "User profile update"}'
```

The model was generating malformed function calls as text content instead of using proper tool calling format.

## Root Causes
1. **Confusing system prompt** - Instructions like "Simply describe what action you want to take" caused the model to output text-based function calls
2. **Incomplete JSON generation** - Tool call arguments were being cut off mid-generation
3. **No validation** - No checks for malformed or incomplete tool calls
4. **Token limits** - No max_tokens set, potentially causing truncation

## Solutions Implemented

### 1. Improved System Prompts
- Clearer instructions to NEVER write function calls as text
- Explicit rules against patterns like `<function=...>` or `tool_name(...)`
- Simplified and more direct language
- Applied to both streaming and non-streaming endpoints

### 2. Content Filtering
Added regex filters to remove any text-based function calls that leak through:
```javascript
cleanContent = cleanContent.replace(/<function=[^>]*>/g, '');
cleanContent = cleanContent.replace(/\b(tool_names)\s*\([^)]*\)/g, '');
```

### 3. Tool Call Validation
- Validate tool calls have complete data before processing
- Check JSON is parseable with error recovery
- Attempt to fix malformed JSON by adding closing braces
- Skip invalid tool calls gracefully with logging

### 4. Stream Error Handling
- Wrapped stream iteration in try-catch
- Check for `finish_reason === 'length'` to detect truncation
- Validate final tool call before adding to queue
- Continue processing even if stream errors occur

### 5. Token Limits
Added `max_tokens: 2000` to ensure enough space for complete tool calls

## Testing
To test the fix:
1. Start the server
2. Make multiple chat requests that trigger tool calls
3. Verify no `400 Failed to call a function` errors occur
4. Check logs for any "Incomplete tool call" or "Discarding invalid tool call" warnings

## Files Modified
- `server/src/controllers/aiController.js`
  - `chatWithCounsellor()` - Non-streaming endpoint
  - `streamChatWithCounsellor()` - Streaming endpoint (main fix)

## Prevention
The fix prevents the error by:
1. Training the model better through improved prompts
2. Filtering out text-based function calls from content
3. Validating and recovering from malformed tool calls
4. Providing enough tokens for complete generation
5. Graceful degradation when issues occur
