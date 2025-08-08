## AI Models Tiering Recommendations

### Executive Summary
- **Three-tier system**: `LOW`, `MEDIUM`, `HIGH` centralizes model selection for clarity, portability, and cost control.
- **Benefits**: Consistent behavior across modules, simplified upgrades by changing tier→model mapping once, and predictable spend.
- **Status**: Tiers are implemented in `config.SYSTEM.AI_MODELS` and referenced across modules with fallback logic in `utils/openaiUtils.js`.

### Current Tier Assignments Analysis
- **newsMonitor**:
  - **Batch evaluation**: `HIGH` for complex reasoning across multiple items.
  - **Content processing/extraction**: `MEDIUM` for balanced accuracy and cost.
  - **Summarization**: `LOW` for speed and efficiency.
- **chat**:
  - **Context-size based**: `LOW` for small contexts, `MEDIUM` for medium contexts, `HIGH` for long/complex threads.
- **audio**:
  - Uses voice/ASR models (e.g., `OPENAI_MODELS.VOICE`). When text post-processing is required (e.g., transcript summarization), prefer `LOW`.
- **news**:
  - Headlines/brief summaries: `LOW`. Aggregation or extraction passes: `MEDIUM`.
- **resumos**:
  - Document summarization: `LOW` by default; escalate to `MEDIUM` for noisy OCR or extraction-heavy tasks.
- **desenho**:
  - Prompt expansion or guidance: `MEDIUM`. Image model selection remains module-specific.
- **tags**:
  - Tag extraction/classification: `MEDIUM` for accuracy; can drop to `LOW` for high-volume, low-risk workloads.

### Optimization Recommendations
- **Prefer LOW by default** for summaries, short replies, and routine utility tasks. Escalate only when quality gaps are observed.
- **Use MEDIUM** for structured extraction, tagging, and typical chat sessions under moderate context sizes.
- **Reserve HIGH** for long-context conversations, complex reasoning, and batch evaluations where accuracy materially impacts outcomes.
- **Context thresholds**: As a rule of thumb, `<2k tokens → LOW`, `2k–8k → MEDIUM`, `>8k → HIGH`.
- **Batch strategies**: For evaluations across many items, test small pilot batches at `MEDIUM` before committing `HIGH` broadly.
- **Cost controls**: Periodically sample traffic and compare outcomes across tiers to validate that higher tiers deliver measurable value.

### Migration Guidelines
1. **Use tier references**: Replace hard-coded model names with `config.SYSTEM.AI_MODELS.{LOW|MEDIUM|HIGH}`.
2. **Keep fallbacks**: Maintain compatibility with `SYSTEM.models.OPENAI_MODELS` for voice/vision and legacy references.
3. **Gradual rollout**: Switch non-critical paths first; monitor latency, error rates, and quality metrics.
4. **Testing**: Create golden test prompts per module and compare outputs across tiers before and after migration.
5. **Observability**: Log tier and token counts on AI calls to inform future tuning.

### Future Model Updates
- **Stable semantics**: Keep the meaning of `LOW/MEDIUM/HIGH` stable; only remap underlying models in `config.SYSTEM.AI_MODELS`.
- **Evaluation criteria**: Consider context length support, reasoning quality, cost, and latency before promoting a model into a tier.
- **Rollout process**: A/B test new tier mappings on a subset of traffic before full adoption.
- **Deprecations**: When models are sunset, remap tiers and verify behavior via golden tests.

### Best Practices
- **Tier-first development**: Reference `AI_MODELS` tiers instead of concrete model names in module code.
- **Context-aware selection**: Choose tiers based on task complexity and token counts, not just feature availability.
- **Avoid overfitting**: Do not special-case models per feature unless strictly necessary; prefer centralized mapping.
- **Periodic review**: Revisit tier assignments quarterly or when OpenAI pricing/capabilities change.


