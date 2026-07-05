# OMP RPC model discovery

Date: 2026-07-05

## Status

Design approved in conversation. Awaiting final review before implementation planning.

## Objective

Expose every model returned by OMP's `get_available_models` RPC command through Craft's existing model refresh and selection UI. Preserve the OMP provider/model pair so selecting a model can drive the existing `set_model` integration without ambiguity.

## Scope

This increment adds model discovery only. It does not add login UI, credential management, periodic polling, OMP extension UI, or a long-lived discovery daemon.

## Decision

Use a short-lived OMP RPC subprocess for each discovery request:

```text
Craft ModelRefreshService
  -> OmpModelFetcher
    -> ompDriver.fetchModels
      -> spawn omp --mode rpc
        -> wait for ready
        -> get_available_models
        -> get_state
        -> normalize models
        -> terminate subprocess
```

This keeps discovery independent of active chat sessions. Reusing a session subprocess would couple settings and refresh behavior to session lifecycle, while a static model snapshot would become stale and would not reflect OMP configuration.

## Components

### Pure model normalizer

Add an OMP-specific normalizer under the shared backend boundary. It accepts unknown RPC model values and returns Craft `ModelDefinition` values. The normalizer owns validation, provider-qualified IDs, capability mapping, and deduplication. It performs no process or filesystem work.

### RPC discovery probe

Add a small RPC probe used by the OMP provider driver. It resolves the configured OMP command, starts `omp --mode rpc`, waits for the `ready` frame, requests `get_available_models` and `get_state`, correlates responses by ID, and terminates the process after both requests resolve.

The probe is deliberately separate from `OmpRpcBackend`. Chat sessions remain long-lived; discovery probes are short-lived and have their own timeout and cleanup semantics.

### Craft model fetcher registration

Add `OmpModelFetcher` in server-core, register it in `MODEL_FETCHERS`, and restore `omp` to `FetchableProvider`. The fetcher delegates to the existing provider-driver `fetchBackendModels` path.

The refresh interval is zero. Craft may fetch on connection setup, startup, or explicit refresh, but it will not periodically spawn OMP in the background.

## Model mapping

Each valid OMP model maps as follows:

| OMP field | Craft field | Rule |
| --- | --- | --- |
| `provider`, `id` | `id` | `${provider}/${id}` |
| `name`, `provider` | `name` | `${name} · ${provider}` |
| `name` | `shortName` | Use the OMP name |
| constant | `provider` | `omp` |
| `contextWindow` | `contextWindow` | Positive finite integer, otherwise `128000` |
| `reasoning`, `thinking` | `supportsThinking` | True when `reasoning` is true or `thinking` is present |
| `input` | `supportsImages` | True when the input array contains `image` |

Entries without a non-empty `provider` and `id` are ignored. Entries are deduplicated by the provider-qualified Craft ID while retaining OMP's response order.

Using a provider-qualified ID is required because OMP can return the same raw model ID from multiple providers. The existing OMP backend already translates this representation back into `set_model(provider, modelId)`.

## Default model

The probe also requests `get_state`. If the current state contains a model whose provider-qualified ID is present in the normalized list, that ID becomes `serverDefault`. Otherwise the first normalized model is used. An empty normalized list is treated as a discovery failure rather than replacing the cached list with no models.

## Error handling

- Startup, response, and overall discovery share a 15-second deadline.
- Malformed non-JSON stdout is ignored and retained only as diagnostic context.
- Unexpected process exit rejects the discovery request.
- The probe retains a bounded stderr tail and includes it in actionable errors.
- Pending requests are rejected during failure and cleanup.
- The subprocess is terminated on success, error, or timeout.
- Discovery errors propagate to Craft's existing model refresh fallback, so previously cached models are preserved.

## Tests

Add focused tests for:

- Provider-qualified ID and display-name mapping.
- Duplicate raw IDs from different OMP providers.
- Deduplication of identical provider/model pairs.
- Invalid entries and context-window fallback.
- Thinking and image capability mapping.
- Current-state default selection and first-model fallback.
- RPC timeout, child exit, malformed stdout, and stderr diagnostics using an injectable or fake subprocess boundary.
- OMP fetcher registration and delegation through `fetchBackendModels`.

Run a final real OMP smoke test that asserts the discovered list is non-empty and includes the exact provider-qualified models returned by the local OMP installation, including `deepseek/deepseek-v4-flash` when present.

## Acceptance criteria

- Craft receives all valid models returned by local OMP, not a hardcoded subset.
- Models with identical raw IDs but different providers remain separately selectable.
- Selecting a discovered model uses the existing OMP `set_model` path successfully.
- Discovery failure does not erase an existing cached model list.
- No discovery subprocess remains alive after completion or failure.
- Shared typecheck and focused model-discovery tests pass.

## Deferred work

- Periodic refresh.
- OMP login-provider UI and authentication workflows.
- Rich provider grouping or badges in the model picker.
- Reusing a live chat subprocess for discovery.
