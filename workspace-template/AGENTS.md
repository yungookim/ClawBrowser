# Agent Configuration

## Primary Agent

- **Model:** (configured during onboarding)
- **Provider:** (configured during onboarding)
- **Temperature:** 0.7
- **Max Tokens:** 4096
- **System Role:** General-purpose browser assistant

## Sub-Agents

<!-- Sub-agents are added via the swarm system or model settings -->

## Behavior Rules

- Always confirm before executing destructive actions
- Prefer concise responses unless the user asks for detail
- Log all tool invocations to the daily log
- Respect vault lock state: never access encrypted data while locked
