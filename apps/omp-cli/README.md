# omp-cli

`omp-cli` is the workspace-local launcher used to keep the desktop integration
honest against the upstream Oh My Pi CLI contract.

Normal OMP arguments are passed through unchanged:

```powershell
bun run omp-cli --help
bun run omp-cli -p "List files in src"
bun run omp-cli models
bun run omp-cli acp
```

The launcher also provides two parity helpers:

```powershell
bun run omp-cli doctor
bun run omp-cli rpc get_state
bun run omp-cli rpc get_available_models
bun run omp-cli commands
bun run omp-cli commands --json
bun run omp-cli check-all
```

`doctor` starts the bundled/configured OMP runtime in RPC mode and checks state,
models, commands, live Skills/MCP/Agents discovery,
models, slash commands, Plan, Goal, Loop, and login providers. `rpc` sends one typed
command to an ephemeral RPC session. `commands` exposes the complete mirrored
command/flag manifest, while `check-all` invokes every upstream subcommand's
`--help` surface and reports failures. Use `OMP_COMMAND` to point at another
OMP binary during development.
