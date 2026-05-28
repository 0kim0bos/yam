# Question

`question` is the smallest yam route: direct Q&A without implementation, broad research, or proof loops.

Use it when:

- The user asks a simple explanation question.
- The answer can be given from stable knowledge or current conversation context.
- A local fact can be checked with one narrow file/command.
- The user wants a quick answer, not a decision memo.

Default behavior:

- Answer first.
- Keep the answer compact.
- Do not change files.
- Do not turn the answer into research unless freshness or uncertainty requires it.
- If comparison, market context, external references, or third-party judgment are needed, switch to `scout`.

Useful output shape:

- Direct answer.
- Why.
- Practical next step.
- Uncertainty, only when relevant.
