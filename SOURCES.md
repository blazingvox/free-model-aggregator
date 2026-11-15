# Official references

- [Bounty brief and requirements](https://make.fun/bounty/free-model-aggregator-01)
- [Public competition skill](https://make.fun/skill.md)
- [Structured requirements endpoint](https://make.fun/api/competitions/free-model-aggregator-01/requirements)
- [Public kit manifest](https://make.fun/api/competitions/free-model-aggregator-01/kit)
- [Public dev-kit archive](https://make.fun/c/free-model-aggregator-01/kit?phase=dev)
- [Public OpenAPI document](https://make.fun/api/openapi.public.json)

The official kit's `RULES.txt` says that submissions must include authentic transcripts of coding-agent sessions that built the code. Its transcript gate can reject an entry before grading; a handed-over transcript is marked as such and is not eligible for a paid place under the current rules. See the README and test report for this project's present transcript status. No transcript was fabricated, and this solution remains local and unpublished.


For the authorized Codex session, the official [OpenAI model catalog](https://developers.openai.com/api/docs/models) recommends GPT-6 Luna for cost-sensitive workloads and states current models are available through the Responses API. The official [API pricing page](https://developers.openai.com/api/docs/pricing) lists GPT-6 Luna at $0.10 per million input tokens and $0.50 per million output tokens at standard rates. This is the price basis for the minimal Codex call; actual usage still depends on tokens and will be checked before any further call.
