# Search reads a derived index, filled after each push and repaired only by a human-triggered Reindex

Agents and humans can search artifacts by meaning or wording (epic spec #118). Search reads a **search index**: one SQLite file inside the artifacts directory (`.index/search.db`) holding each artifact's readable text for keyword matching and, when the operator configures an embedding endpoint, embedding vectors for semantic matching. The index is derived data: the snapshots stay the only source of truth (ADR-0002), and deleting the file loses nothing but indexing time. Indexing never happens inside a push. An in-process indexer listens to the live bus and indexes each artifact after its push returns, so push latency and reliability do not depend on search or on the embedding endpoint. There is no startup reconcile and no automatic retry: **Reindex**, a store-wide incremental pass a human starts from the session list, is the single repair path for first backfill, failed embeds, pruned or deleted artifacts, and a changed embedding model.

Retrieval is hybrid. A keyword list (SQLite FTS5) and a vector list are merged by reciprocal rank fusion, and a response declares its mode: `hybrid`, or `keyword` with a reason when the endpoint is not configured, is unreachable, or nothing is embedded yet. Embedding is configured only by dedicated `AURORA_EMBEDDING_*` environment variables read at startup and speaks one OpenAI-compatible request shape, which covers both OpenRouter and Ollama. Image artifacts can be embedded from their bytes by a multimodal model, as a separate opt-in. Audio and video are not indexed.

## Considered options

- **Scan the store on every query, no index** — rejected: fast enough for keywords at today's size (14–23 ms over 102 artifacts, measured 2026-11-25), but it cannot serve semantic search, which needs stored vectors.
- **Embed inside the push** — rejected: every push would inherit the embedding endpoint's latency and failures, including daily channel briefings.
- **Reconcile the index at startup or on a timer** — rejected by the owner in favour of an explicit Reindex button. Do not add one.
- **Retry failed embeds automatically** — rejected by the owner: it is a second repair path, and one a restart silently drops.
- **Maintain the index from live-bus events alone** — rejected: deletes and channel prunes are not broadcast, so search also checks every hit against the store and Reindex removes orphans.
- **A vector database or a SQLite vector extension** — rejected: Bun on macOS uses Apple's SQLite, which cannot load extensions (Bun SQLite docs, read 2026-11-25), and a few megabytes of vectors are compared in process.
- **Store the index beside the job registry, outside the artifacts directory** — rejected: only the artifacts directory is a mounted volume, so the index would be lost on every container recreation.
- **Reuse `OPENROUTER_API_KEY` to enable embedding** — rejected: enabling image generation would silently start sending artifact text to a provider.
- **Vector-only retrieval** — rejected: it misses exact strings such as ids and ticket numbers, and leaves no search at all when the endpoint is down.
- **Index raw snapshots** — rejected: UI programs and chart JSON would match on component names and keys. Each type is reduced to its readable text first.
- **Agent-supplied image descriptions, or a captioning model** — rejected by the owner in favour of embedding image bytes.

## Consequences

- After an upgrade, or after embedding is first configured, existing artifacts are keyword-only or unindexed until a human clicks Reindex. The session list shows indexed, embedded and pending counts so the drift is visible.
- With embedding configured, artifact text, and image bytes when image embedding is enabled, are sent to the operator's endpoint. Nothing is sent when the variables are unset.
- Vectors are tagged with the model that produced them. Vectors from another model are ignored at query time and replaced by Reindex, so changing the model needs no manual cleanup.
- Search state is derived and process-level, while the MCP surface stays stateless: the index, indexer and search service are built once at server creation and handed to each request.
- Reindex and index status are browser-only, like delete; they are not MCP tools.
- Evidence anchors (verified 2026-11-25, re-verify before changing the embedding client): OpenRouter embeddings docs; live calls to OpenRouter `google/gemini-embedding-2-preview` and `cohere/embed-5-fast` accepting a base64 `data:` image URL; one request mixing text and image inputs returns HTTP 400; an image sent to a text-only model returns HTTP 404; Ollama `/v1/embeddings` with `bge-m3` accepts the same text request. Image input on Ollama is unverified.
